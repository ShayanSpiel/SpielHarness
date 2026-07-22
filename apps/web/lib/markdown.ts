/**
 * Providers occasionally indent an entire Markdown document even when it is
 * not a code sample. CommonMark interprets four leading spaces as one giant
 * code block, so remove only indentation shared by every non-empty line.
 * Intentional code should be emitted with fenced code blocks.
 */
export function normalizeMarkdown(text: string): string {
  // Do not use String.trim() here: it removes indentation from only the first
  // line and hides the common indent we need to measure across the document.
  let normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[\t ]*\n)+/, "")
    .replace(/(?:\n[\t ]*)+$/, "");
  const wholeDocumentFence = normalized.match(/^```(markdown|md)?[\t ]*\n([\s\S]*?)\n```$/i);
  if (wholeDocumentFence) {
    const language = wholeDocumentFence[1]?.toLowerCase();
    const body = wholeDocumentFence[2] ?? "";
    if (language === "markdown" || language === "md" || (/^---\s*\n/.test(body) && /\n#\s+\S/.test(body))) {
      normalized = body;
    }
  }

  const lines = normalized.split("\n");
  while (lines[0]?.trim() === "") lines.shift();
  while (lines.at(-1)?.trim() === "") lines.pop();

  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) return "";
  const commonIndent = Math.min(
    ...nonEmpty.map((line) => line.match(/^[ \t]*/)?.[0].replace(/\t/g, "    ").length ?? 0)
  );
  if (commonIndent < 4) return lines.join("\n");

  return lines
    .map((line) => {
      let remaining = commonIndent;
      let index = 0;
      while (remaining > 0 && index < line.length) {
        if (line[index] === " ") remaining -= 1;
        else if (line[index] === "\t") remaining -= 4;
        else break;
        index += 1;
      }
      return line.slice(index);
    })
    .join("\n");
}
