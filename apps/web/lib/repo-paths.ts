import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve a repository-owned file from either the monorepo root or the web
 * workspace. Next can use either directory as process.cwd() depending on how
 * the app is started, so server code must not assume one launch command.
 */
export function resolveRepoPath(...segments: string[]): string {
  const roots = [process.cwd(), path.resolve(process.cwd(), "..", "..")];
  const match = roots
    .map((root) => path.join(root, ...segments))
    .find((candidate) => existsSync(candidate));

  return match ?? path.join(process.cwd(), ...segments);
}

export const SEED_ROOT = resolveRepoPath("supabase", "seed");
