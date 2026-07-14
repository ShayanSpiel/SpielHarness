import type { HttpAdapter } from "./types.ts";

function readBufferToken(): string {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'Buffer is not configured. Set BUFFER_ACCESS_TOKEN in your environment.'
    );
  }
  return token;
}

async function bufferRequest(
  path: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<string> {
  const token = readBufferToken();
  const url = new URL(path, 'https://api.bufferapp.com/1');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Buffer returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

export const bufferAdapter: HttpAdapter = {
  async execute(req) {
    const op = req.operation.id;
    switch (op) {
      case 'buffer.list': {
        const raw = await bufferRequest('profiles.json', 'GET');
        const parsed = JSON.parse(raw) as { profiles?: Array<{ id: string; service: string }> };
        return { output: JSON.stringify(parsed.profiles ?? [], null, 2) };
      }
      case 'buffer.publish':
      case 'buffer.draft': {
        const body = JSON.parse(req.input) as Record<string, unknown>;
        const profiles = body.profiles as string[] ?? [];
        const text = body.text as string ?? req.input.slice(0, 2000);
        const payload: Record<string, unknown> = {
          text,
          profile_ids: profiles,
          ...(op === 'buffer.draft' ? { draft: true } : { now: true }),
        };
        const raw = await bufferRequest('updates/create.json', 'POST', payload);
        return { output: raw };
      }
      default:
        throw new Error(`Unknown Buffer operation: "${op}".`);
    }
  },
};
