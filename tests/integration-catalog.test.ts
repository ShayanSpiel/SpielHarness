import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hasAdapter } from "@spielos/providers";

type CatalogPreset = {
  id: string;
  kind: string;
  availability?: "available" | "unavailable";
  unavailableReason?: string;
  operations: Array<{ id: string }>;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("available integration presets only advertise executable operations", async () => {
  const source = await readFile(path.join(root, "supabase/seed/integrations/catalog.json"), "utf8");
  const presets = JSON.parse(source) as CatalogPreset[];

  for (const preset of presets) {
    if (preset.availability === "unavailable") {
      assert.ok(preset.unavailableReason, `${preset.id} must explain why it is unavailable`);
      continue;
    }
    if (preset.kind === "builtin") continue;
    for (const operation of preset.operations) {
      assert.ok(hasAdapter(operation.id), `${preset.id} advertises ${operation.id} without a runtime adapter`);
    }
  }
});
