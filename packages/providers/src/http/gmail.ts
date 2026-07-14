import { resolveGoogleAccessToken } from "./auth.ts";
import type { HttpAdapter } from "./types.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailGet(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<string> {
  const url = new URL(path, GMAIL_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
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
  body: Record<string, unknown>
): Promise<string> {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
        const params: Record<string, string> = {};
        const input = req.input.trim();
        if (input) {
          params.q = input.slice(0, 2000);
        } else {
          params.maxResults = "10";
        }
        const raw = await gmailGet("/messages", token, params);
        return { output: raw };
      }

      case "gmail.read": {
        const messageId = req.input.trim();
        if (!messageId) {
          throw new Error("Gmail read requires a message ID.");
        }
        const raw = await gmailGet(`/messages/${messageId}`, token, {
          format: "full",
        });
        return { output: raw };
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
        });
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
          const raw = await gmailPost("/drafts/send", token, { id: draftId });
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
        });
        return { output: raw };
      }

      default:
        throw new Error(`Unknown Gmail operation: "${req.operation.id}".`);
    }
  },
};
