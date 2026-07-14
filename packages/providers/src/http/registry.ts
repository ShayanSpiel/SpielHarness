import type { HttpAdapter } from "./types.ts";
import { gmailAdapter } from "./gmail.ts";
import { notionAdapter } from "./notion.ts";
import { bufferAdapter } from "./buffer.ts";

const REGISTRY: Record<string, HttpAdapter> = {
  "gmail.search": gmailAdapter,
  "gmail.read": gmailAdapter,
  "gmail.draft": gmailAdapter,
  "gmail.send": gmailAdapter,
  "notion.search": notionAdapter,
  "notion.read": notionAdapter,
  "notion.create": notionAdapter,
  "notion.update": notionAdapter,
  "buffer.list": bufferAdapter,
  "buffer.draft": bufferAdapter,
  "buffer.publish": bufferAdapter,
};

export function adapterForOperation(
  operationId: string
): HttpAdapter | undefined {
  return REGISTRY[operationId];
}

export function hasAdapter(operationId: string): boolean {
  return operationId in REGISTRY;
}
