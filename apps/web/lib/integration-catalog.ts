import { readFile } from "node:fs/promises";
import path from "node:path";
import { SEED_ROOT } from "./repo-paths";

export type IntegrationOperation = { id: string; label?: string; effect?: "read" | "write" | "send" | "destructive"; [key: string]: unknown };
export type IntegrationPreset = { id: string; name: string; description: string; kind: string; icon: string; logo?: string; baseUrl?: string; secretEnvKey?: string; operations: IntegrationOperation[] };

export async function loadIntegrationCatalog(): Promise<IntegrationPreset[]> {
  const source = path.join(SEED_ROOT, "integrations", "catalog.json");
  return JSON.parse(await readFile(source, "utf8")) as IntegrationPreset[];
}
