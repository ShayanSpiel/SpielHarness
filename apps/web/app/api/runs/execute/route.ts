import {
  appendChatMessages,
  appendRunEvents,
  createChat,
  createFile,
  createRun,
  linkRunInputFiles,
  linkRunOutputFile,
  nextRunEventSequence,
  recordUsage,
  updateRun
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../lib/server";
import { resolveExecution, type ExecuteBody } from "../../../../lib/execution-service";
import { generatedFileFolder } from "../../../../lib/workspace-data";
import { streamChatRun, streamRun, type RunCheckpoint, type RunYield } from "@spielos/graph";
import type { Artifact, RunEvent, RunStatus } from "@spielos/core";

function frame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type PendingEvent = {
  event_type: string;
  node_id: string | null;
  node_title: string | null;
  skill_id: string | null;
  skill_name: string | null;
  message: string;
  payload: Record<string, unknown>;
};

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);

    const body = (await request.json()) as ExecuteBody;
    if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey ?? null;
    if (idempotencyKey) {
      const existing = await org.sql<{ id: string; status: string }[]>`
        select id, status from runs
        where org_id = ${org.orgId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      if (existing.length > 0) {
        throw new HttpError(409, `Run already exists (${existing[0].id}, ${existing[0].status}).`);
      }
    }

    const chatId: string | null = body.chatId ?? null;
    const [resolved] = await Promise.all([
      resolveExecution(org, body),
      chatId
        ? createChat(org.sql, org.orgId, chatId, body.prompt.trim().slice(0, 80) || "New chat")
        : Promise.resolve(null)
    ]);

    const run = await createRun(org.sql, org.orgId, {
      chatId,
      workflowId: resolved.target.type === "workflow" ? resolved.target.id : null,
      type: resolved.type,
      prompt: body.prompt,
      inputs: {
        target: resolved.target,
        contextFileIds: resolved.contextFileIds
      },
      definitionSnapshot: {
        target: resolved.target,
        workflow: resolved.runRequest.workflow,
        singleNode: resolved.runRequest.singleNode,
        roles: resolved.runRequest.roles,
        skills: resolved.runRequest.skills
      },
      idempotencyKey
    });

    if (resolved.contextFileIds.length > 0) {
      await linkRunInputFiles(org.sql, org.orgId, run.id, resolved.contextFileIds);
    }
    const firstEventSequence = await nextRunEventSequence(org.sql, org.orgId, run.id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ kind: "run", runId: run.id, type: resolved.type })));
        const pendingEvents: PendingEvent[] = [];
        const pendingArtifacts: Artifact[] = [];
        let outputText = "";
        let terminalStatus: RunStatus = "completed";
        let errorMessage: string | null = null;
        let checkpoint: RunCheckpoint | null = null;
        let streamEventSequence = firstEventSequence;

        const gen: AsyncGenerator<RunYield, void, void> =
          resolved.type === "chat"
            ? streamChatRun({
                ...resolved.runRequest,
                runId: run.id,
                directorPrompt: resolved.directorPrompt,
                history: body.messages,
                signal: request.signal
              })
            : streamRun({ ...resolved.runRequest, runId: run.id, signal: request.signal });

        try {
          for await (const item of gen) {
            if (item.kind === "text") {
              outputText += item.text;
              controller.enqueue(encoder.encode(frame({ kind: "text", text: item.text })));
            } else if (item.kind === "status") {
              controller.enqueue(encoder.encode(frame({ kind: "status", message: item.message })));
            } else if (item.kind === "event") {
              const e: RunEvent = { ...item.event, sequence: streamEventSequence++ };
              pendingEvents.push({
                event_type: e.type,
                node_id: e.nodeId ?? null,
                node_title: e.nodeTitle ?? null,
                skill_id: e.skillId ?? null,
                skill_name: e.skillName ?? null,
                message: e.message,
                payload: e.payload ?? {}
              });
              controller.enqueue(encoder.encode(frame({ kind: "event", event: e })));
            } else if (item.kind === "artifact") {
              pendingArtifacts.push(item.artifact);
              controller.enqueue(encoder.encode(frame({ kind: "artifact", artifact: item.artifact })));
            } else if (item.kind === "human_input") {
              terminalStatus = "waiting_human";
              controller.enqueue(encoder.encode(frame({ kind: "human_input", request: item.request })));
            } else if (item.kind === "checkpoint") {
              checkpoint = item.state;
            } else if (item.kind === "done") {
              const allowed: RunStatus[] = ["running", "waiting_human", "completed", "failed", "cancelled"];
              terminalStatus = (allowed.includes(item.status as RunStatus) ? item.status : "completed") as RunStatus;
            }
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : "Run failed";
          terminalStatus = "failed";
          controller.enqueue(encoder.encode(frame({ kind: "error", message: errorMessage })));
        }

        if (pendingEvents.length > 0) {
          try {
            await appendRunEvents(org.sql, org.orgId, run.id, pendingEvents);
          } catch (err) {
            console.error("[runs/execute] event persist failed:", err);
          }
        }

        for (const artifact of pendingArtifacts) {
          try {
            const file = await createFile(org.sql, org.orgId, {
              title: artifact.title,
              body: artifact.body,
              fileType: artifact.type === "artifact" ? "artifact" : artifact.type,
              status: "active",
              metadata: {
                ...artifact.metadata,
                runId: run.id,
                runtimeArtifactId: artifact.id,
                seedFolder: generatedFileFolder()
              }
            });
            await linkRunOutputFile(org.sql, org.orgId, run.id, file.id);
          } catch (err) {
            console.error("[runs/execute] artifact persist failed:", err);
          }
        }

        const completedAt =
          terminalStatus === "completed" || terminalStatus === "failed" || terminalStatus === "cancelled"
            ? new Date().toISOString()
            : null;

        await updateRun(org.sql, org.orgId, run.id, {
          status: terminalStatus,
          outputs: { text: outputText },
          state: checkpoint ?? undefined,
          error: errorMessage,
          completedAt
        });

        if (
          resolved.runRequest.provider &&
          resolved.runRequest.model &&
          outputText
        ) {
          try {
            await recordUsage(org.sql, org.orgId, {
              runId: run.id,
              provider: resolved.runRequest.provider.name,
              model: resolved.runRequest.model.model,
              inputTokens: Math.ceil(body.prompt.length / 4),
              outputTokens: Math.ceil(outputText.length / 4),
              costMicros: 0
            });
          } catch (err) {
            console.warn("[runs/execute] usage record failed:", err);
          }
        }

        if (chatId && outputText) {
          try {
            await appendChatMessages(org.sql, org.orgId, chatId, [
              { role: "user", body: body.prompt, metadata: { runId: run.id } },
              { role: "assistant", body: outputText, metadata: { runId: run.id } }
            ]);
          } catch (err) {
            console.warn("[runs/execute] chat persist failed:", err);
          }
        }

        controller.enqueue(encoder.encode(frame({ kind: "done", runId: run.id, status: terminalStatus })));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
}
