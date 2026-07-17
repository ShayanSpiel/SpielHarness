import type { HttpAdapter } from "./types.ts";
import { gmailAdapter } from "./gmail.ts";
import { notionAdapter } from "./notion.ts";
import { bufferAdapter } from "./buffer.ts";
import { driveAdapter } from "./drive.ts";
import { duckDuckGoAdapter } from "./duckduckgo.ts";

const REGISTRY: Record<string, HttpAdapter> = {
  "gmail.search": gmailAdapter,
  "gmail.read": gmailAdapter,
  "gmail.draft": gmailAdapter,
  "gmail.send": gmailAdapter,
  "drive.list": driveAdapter,
  "drive.search": driveAdapter,
  "drive.read": driveAdapter,
  "drive.createFolder": driveAdapter,
  "drive.createFile": driveAdapter,
  "drive.updateFile": driveAdapter,
  "drive.publishProject": driveAdapter,
  "notion.search": notionAdapter,
  "notion.read": notionAdapter,
  "notion.create": notionAdapter,
  "notion.createDatabase": notionAdapter,
  "notion.update": notionAdapter,
  "duckduckgo.search": duckDuckGoAdapter,
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
