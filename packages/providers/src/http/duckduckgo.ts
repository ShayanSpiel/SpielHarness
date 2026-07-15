import { readToolInput, readToolNumber } from "./input.ts";
import type { HttpAdapter } from "./types.ts";

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function resultUrl(value: string): string {
  const decoded = decodeHtml(value);
  try {
    const url = new URL(decoded, "https://html.duckduckgo.com");
    const redirect = url.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : url.toString();
  } catch {
    return decoded;
  }
}

export type DuckDuckGoResult = { title: string; url: string; snippet: string };

export function parseDuckDuckGoHtml(html: string, limit: number): DuckDuckGoResult[] {
  const links = [...html.matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/gi)];
  return links.slice(0, limit).map((match, index) => ({
    title: plainText(match[2] ?? ""),
    url: resultUrl(match[1] ?? ""),
    snippet: plainText(snippets[index]?.[1] ?? "")
  })).filter((result) => result.title && /^https?:\/\//i.test(result.url));
}

export const duckDuckGoAdapter: HttpAdapter = {
  async execute(req) {
    const query = readToolInput(req.input, ["query", "q"]);
    if (!query) throw new Error("DuckDuckGo search requires a query.");
    const limit = readToolNumber(req.input, ["maxResults", "max_results", "limit"], 5, { max: 10 });
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query.slice(0, 2000));
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; SpielOS/0.1; +https://duckduckgo.com/)"
      },
      signal: req.signal
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}: ${plainText(html).slice(0, 500)}`);
    const results = parseDuckDuckGoHtml(html, limit);
    if (results.length === 0) throw new Error("DuckDuckGo returned no parseable search results.");
    return {
      output: JSON.stringify({ query, retrievedAt: new Date().toISOString(), results }, null, 2)
    };
  }
};
