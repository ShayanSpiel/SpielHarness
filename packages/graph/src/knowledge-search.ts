export type SearchableFile = {
  id: string;
  title: string;
  body: string;
};

/**
 * Deterministic tenant-file search shared by Direct and Director modes.
 * The caller owns tenancy and file visibility; this function only ranks the
 * supplied snapshot and never performs a second model call or database read.
 */
export function searchAttachedFiles(
  files: SearchableFile[],
  query: string,
  originalPrompt = "",
  limit = 5
): string {
  const terms = `${originalPrompt}\n${query}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
  const scored = files
    .map((file) => {
      const haystack = `${file.title}\n${file.body}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { file, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
  return scored.length > 0
    ? scored.map(({ file }) => `# ${file.title}\n\n${file.body}`).join("\n\n---\n\n")
    : "No matching harness files found.";
}
