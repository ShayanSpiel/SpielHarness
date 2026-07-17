import { Command } from "@langchain/langgraph";
import type { HumanInputRequest } from "@spielos/core";

/**
 * Bridge between the existing `runs/[id]/reply` body shape and
 * LangGraph's `Command({ resume: ... })` payload.
 *
 * The reply endpoint already accepts `{ requestId, answers }` —
 * answers is keyed by `HumanInputQuestion.id`. The deepagents
 * runtime surfaces the original question set on the run's
 * `state.__interrupt__` payload. We translate the answers map
 * into a `Command` whose `resume` field carries the answer
 * value for each question id. The Director's interrupt-on-tool
 * configuration then replays the parent graph with the
 * resolved answers.
 */

export type ReplyBody = {
  requestId: string;
  answers: Record<string, unknown>;
};

export function commandFromReply(request: HumanInputRequest, body: ReplyBody): Command {
  const resume: Record<string, unknown> = {};
  for (const question of request.questions) {
    if (question.id in body.answers) {
      resume[question.id] = body.answers[question.id];
    }
  }
  return new Command({ resume });
}

/**
 * Extract a `Record<string, unknown>` resume payload from a raw
 * reply body. The Director's `Command({ resume })` form is
 * permissive: any structured value can be passed back. The
 * existing `runs/[id]/reply` route validates `requestId` and
 * `answers`; the Director's interrupt is correlated by requestId.
 */
export function resumePayloadFromReply(body: ReplyBody): Record<string, unknown> {
  return body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
    ? { ...body.answers }
    : {};
}
