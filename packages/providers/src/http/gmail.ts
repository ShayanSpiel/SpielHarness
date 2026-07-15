import { resolveGoogleAccessToken } from "./auth.ts";
import type { HttpAdapter } from "./types.ts";
import { readToolInput, readToolNumber } from "./input.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailGet(
  path: string,
  token: string,
  params?: Record<string, string>,
  signal?: AbortSignal
): Promise<string> {
  const url = new URL(`${GMAIL_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Gmail returned HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }
  return text;
}

async function gmailPost(
  path: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Gmail returned HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }
  return text;
}

function buildEmailRaw(to: string, subject: string, bodyText: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    bodyText,
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

type EmailFields = {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
};

type GmailPayload = {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayload[];
};

type GmailMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPayload;
};

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function readableGmailBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  const candidates: Array<{ mimeType: string; text: string }> = [];
  const visit = (part: GmailPayload) => {
    const mimeType = part.mimeType ?? "";
    if (part.body?.data && (mimeType.startsWith("text/plain") || mimeType.startsWith("text/html"))) {
      candidates.push({ mimeType, text: decodeBase64Url(part.body.data) });
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);
  const selected = candidates.find((candidate) => candidate.mimeType.startsWith("text/plain")) ?? candidates[0];
  if (!selected) return "";
  return selected.mimeType.startsWith("text/html")
    ? selected.text.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : selected.text.trim();
}

export function normalizeGmailMessage(raw: string): string {
  const message = JSON.parse(raw) as GmailMessage;
  const allowedHeaders = new Set(["subject", "from", "to", "cc", "date", "message-id"]);
  const headers = Object.fromEntries((message.payload?.headers ?? [])
    .filter((header) => header.name && allowedHeaders.has(header.name.toLowerCase()))
    .map((header) => [header.name!, header.value ?? ""]));
  const readableBody = readableGmailBody(message.payload);
  const body = readableBody.slice(0, 40_000);
  return JSON.stringify({
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    internalDate: message.internalDate,
    headers,
    snippet: message.snippet ?? "",
    body: body || message.snippet || "",
    truncated: readableBody.length > body.length
  }, null, 2);
}

function parseEmailInput(input: string): EmailFields {
  const trimmed = input.trim();

  // 1. Try JSON.
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const to =
      String(parsed.to ?? parsed.recipient ?? parsed.send_to ?? "").trim();
    const subject = String(
      parsed.subject ?? parsed.re ?? parsed.topic ?? ""
    ).trim();
    const body = String(
      parsed.body ?? parsed.message ?? parsed.content ?? ""
    ).trim();
    if (to) {
      return {
        to,
        subject,
        body: body || trimmed,
        cc: String(parsed.cc ?? "").trim() || undefined,
        bcc: String(parsed.bcc ?? "").trim() || undefined,
      };
    }
  } catch {}

  // 2. Try key-value line format (To:/Subject:/Body:).
  const kvTo = trimmed.match(
    /(?:^|\n)\s*(?:to|recipient|send\s*to)\s*:\s*(.+)/im
  );
  const kvSubject = trimmed.match(
    /(?:^|\n)\s*(?:subject|re|topic)\s*:\s*(.+)/im
  );
  const kvBody = trimmed.match(
    /(?:^|\n)\s*(?:body|message|content)\s*:\s*([\s\S]*)$/im
  );
  if (kvTo) {
    return {
      to: kvTo[1].trim(),
      subject: kvSubject?.[1]?.trim() ?? "",
      body: kvBody?.[1]?.trim() ?? trimmed,
    };
  }

  // 3. Natural language extraction.
  const emailAddr = trimmed.match(EMAIL_RE);
  if (emailAddr) {
    const to = emailAddr[0];
    let subject = "";
    let body = trimmed;

    // Remove the email address from body text.
    body = body.replace(emailAddr[0], "").trim();

    // Try to extract subject from common patterns.
    // "with subject X" or "subject: X" or "subject X" or "re: X"
    const subjMatch = body.match(
      /(?:with\s+)?(?:subject|re|about)\s*[:=]?\s*["'`]?(.+?)["'`]?(?:\s+and|\s+with|\s+saying|\s+where|\s+that|\s*$)/i
    );
    if (subjMatch) {
      subject = subjMatch[1].trim();
      body = body.replace(subjMatch[0], "").trim();
    }

    // Try to extract body after "saying", "with body", "body:", "that says"
    const bodyIdx = body.search(
      /saying\s+(?:that\s+)?|with\s+body\s*[:=]?\s*|body\s*[:=]?\s*|message\s*[:=]?\s*/i
    );
    if (bodyIdx !== -1) {
      const after = body.slice(bodyIdx);
      const content = after
        .replace(
          /^(?:saying\s+(?:that\s+)?|with\s+body\s*[:=]?\s*|body\s*[:=]?\s*|message\s*[:=]?\s*)/i,
          ""
        )
        .trim();
      if (content) {
        body = content;
      }
    }

    // Clean up remaining noise words.
    body = body
      .replace(
        /^(?:send|write|forward|reply|draft|compose|create)\s+(?:(?:an?\s+)?email\s+)?(?:to\s+)?/i,
        ""
      )
      .replace(/^(?:with|about|for|regarding)\s+/i, "")
      .replace(/^["'`]|["'`]$/g, "")
      .trim();

    return { to, subject, body: body || trimmed };
  }

  // 4. Fallback — no recipient found.
  return { to: "", subject: "", body: trimmed };
}

export const gmailAdapter: HttpAdapter = {
  async execute(req) {
    const token = await resolveGoogleAccessToken(
      req.connection.id,
      req.connection.config
    );

    switch (req.operation.id) {
      case "gmail.search": {
        const params: Record<string, string> = {
          maxResults: String(readToolNumber(req.input, ["maxResults", "max_results", "limit"], 10, { max: 25 }))
        };
        const input = readToolInput(req.input, ["query", "q"]);
        if (input) {
          params.q = input.slice(0, 2000);
        }
        const raw = await gmailGet("/messages", token, params, req.signal);
        return { output: raw };
      }

      case "gmail.read": {
        const messageId = readToolInput(req.input, ["messageId", "message_id", "id"]);
        if (!messageId) {
          throw new Error("Gmail read requires a message ID.");
        }
        const raw = await gmailGet(`/messages/${messageId}`, token, {
          format: "full",
        }, req.signal);
        return { output: normalizeGmailMessage(raw) };
      }

      case "gmail.draft": {
        const { to, subject, body } = parseEmailInput(req.input);
        if (!to) {
          throw new Error(
            "Gmail draft requires a recipient (to). Ensure the LLM formats the email with 'to', 'subject', and 'body' fields."
          );
        }
        const raw = await gmailPost("/drafts", token, {
          message: { raw: buildEmailRaw(to, subject, body) },
        }, req.signal);
        return { output: raw };
      }

      case "gmail.send": {
        const trimmed = req.input.trim();

        // Detect if the input is a draft result from a previous gmail.draft call.
        // The Gmail draft API returns { "id": "r123", "message": { "id": "m456" } }.
        let draftId: string | null = null;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed.draft_id && typeof parsed.draft_id === "string") {
            draftId = parsed.draft_id;
          } else if (
            parsed.id &&
            typeof parsed.id === "string" &&
            parsed.message &&
            typeof parsed.message === "object"
          ) {
            draftId = parsed.id as string;
          }
        } catch {}

        if (draftId) {
          const raw = await gmailPost("/drafts/send", token, { id: draftId }, req.signal);
          return { output: raw };
        }

        // Otherwise build and send directly.
        const { to, subject, body } = parseEmailInput(req.input);
        if (!to) {
          throw new Error(
            "Gmail send requires a recipient (to). Provide 'to', 'subject', and 'body' fields. " +
            "If sending from a draft, pass the draft result JSON from a previous gmail.draft call."
          );
        }
        const raw = await gmailPost("/messages/send", token, {
          raw: buildEmailRaw(to, subject, body),
        }, req.signal);
        return { output: raw };
      }

      default:
        throw new Error(`Unknown Gmail operation: "${req.operation.id}".`);
    }
  },
};
