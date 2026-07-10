type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ContextItem = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  body?: string;
  meta?: Record<string, string>;
};

type WorkflowNodeData = {
  id: string;
  title: string;
  prompt: string;
  roleName: string;
  rolePrompt: string;
  skills: { name: string; slug: string }[];
  files: { title: string; body: string }[];
  input: string;
  output: string;
};

type WorkflowData = {
  id: string;
  title: string;
  description: string;
  nodes: WorkflowNodeData[];
  edges: { id: string; source: string; target: string }[];
};

type ChatBody = {
  prompt?: string;
  messages?: ChatMessage[];
  context?: {
    roles?: ContextItem[];
    tools?: ContextItem[];
    workstreams?: ContextItem[];
    knowledge?: ContextItem[];
  };
  workflows?: WorkflowData[];
};

function frame(item: unknown) {
  return `data: ${JSON.stringify(item)}\n\n`;
}

function formatContext(label: string, items: ContextItem[] = []) {
  if (items.length === 0) return `${label}: none`;
  return [
    `${label}:`,
    ...items.map((item) => {
      const detail = [item.subtitle, item.body].filter(Boolean).join("\n");
      return `- ${item.title}${detail ? `\n${detail}` : ""}`;
    })
  ].join("\n");
}

function formatWorkflows(workflows: WorkflowData[] = []) {
  if (workflows.length === 0) return "";
  return [
    "=== WORKFLOWS ===",
    "You MUST execute each attached workflow by running its nodes in topological order.",
    "For each node: use its role prompt as instructions, pass the previous node's output as its input, and produce the expected output type.",
    "Make every node's execution visible in your answer. Label each step clearly.",
    "",
    ...workflows.flatMap((ws) => {
      const edgeDesc = ws.edges.map((e) => {
        const from = ws.nodes.find((n) => n.id === e.source)?.title ?? e.source;
        const to = ws.nodes.find((n) => n.id === e.target)?.title ?? e.target;
        return `  ${from} -> ${to}`;
      });
      return [
        `Workflow: ${ws.title}`,
        `Description: ${ws.description}`,
        "Edges:",
        ...edgeDesc,
        "",
        "Nodes (execute in topological order):",
        ...ws.nodes.map((node, i) => [
          `  Step ${i + 1}: ${node.title}`,
          `  Role: ${node.roleName}`,
          `  Role prompt: ${node.rolePrompt}`,
          `  Node prompt: ${node.prompt}`,
          node.skills.length ? `  Skills: ${node.skills.map((s) => s.name).join(", ")}` : "  Skills: none",
          node.files.length ? `  Files: ${node.files.map((f) => `${f.title}: ${f.body.slice(0, 200)}`).join("\n    ")}` : "  Files: none",
          `  Input type: ${node.input}`,
          `  Output type: ${node.output}`,
          ""
        ].join("\n")),
        ""
      ];
    }),
    "After executing all workflow steps, summarize the outcome."
  ].join("\n");
}

function orchestratorPrompt(body: ChatBody) {
  const context = body.context ?? {};
  return [
    "You are the Director orchestrator inside SpielOS.",
    "SpielOS is a customizable agent/workflow platform. Agents, nodes, tools, prompts, evals, and workflows are user-configured context, not hardcoded behavior.",
    "Do not run evals unless an eval is explicitly attached by the user. Do not invent hidden tools or roles.",
    "If roles are attached, use their prompts as operating instructions for this turn. If no roles are attached, answer as a normal assistant and ask a clarifying question only when needed.",
    "If tools are attached, treat them as available capabilities, but do not claim external side effects unless the tool result is provided.",
    "Return useful work directly. Keep the answer concise unless a workflow execution requires detail.",
    "",
    formatContext("Attached roles", context.roles),
    "",
    formatContext("Attached tools", context.tools),
    "",
    formatContext("Attached workflows summary", context.workstreams),
    "",
    formatContext("Attached knowledge", context.knowledge),
    "",
    formatWorkflows(body.workflows)
  ].join("\n");
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatBody;
  const encoder = new TextEncoder();
  const apiKey = process.env.MISTRAL_API_KEY;
  const model = process.env.MISTRAL_MODEL ?? "mistral-large-latest";
  const baseUrl = process.env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (!apiKey) {
          controller.enqueue(encoder.encode(frame({
            kind: "text",
            text: "LLM is not connected. Set MISTRAL_API_KEY to enable Director chat. No eval was run."
          })));
          return;
        }

        const messages = (body.messages ?? [])
          .filter((message) => message.content.trim())
          .map((message) => ({
            role: message.role === "system" ? "assistant" : message.role,
            content: message.content
          }));

        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            temperature: 0.4,
            messages: [
              { role: "system", content: orchestratorPrompt(body) },
              ...(messages.length ? messages : [{ role: "user", content: body.prompt ?? "" }])
            ]
          })
        });

        if (!response.ok) {
          throw new Error(`Mistral request failed with ${response.status}`);
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        controller.enqueue(encoder.encode(frame({
          kind: "text",
          text: data.choices?.[0]?.message?.content?.trim() || "No response returned."
        })));
      } catch (error) {
        controller.enqueue(encoder.encode(frame({
          kind: "error",
          message: error instanceof Error ? error.message : "Unknown chat error"
        })));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
