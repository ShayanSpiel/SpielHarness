"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeMarkdown } from "../../lib/markdown";

export function MarkdownContent({ text, className = "" }: { text: string; className?: string }) {
  return (
    <ReactMarkdown
      className={`prose-chat min-w-0 max-w-full text-sm leading-7 text-foreground ${className}`}
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="mb-3 mt-1 text-2xl font-semibold leading-tight text-foreground-strong">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold leading-tight text-foreground-strong">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold leading-snug text-foreground-strong">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold leading-snug text-foreground-strong">{children}</h4>,
        p: ({ children }) => <p className="my-2 text-sm leading-7 text-foreground">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-foreground-strong">{children}</strong>,
        em: ({ children }) => <em className="italic text-foreground">{children}</em>,
        ul: ({ children }) => <ul className="my-2 ms-5 list-disc space-y-1 text-sm leading-6">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 ms-5 list-decimal space-y-1 text-sm leading-6">{children}</ol>,
        li: ({ children }) => <li className="ps-1 text-foreground">{children}</li>,
        blockquote: ({ children }) => <blockquote className="my-3 border-s-2 border-border ps-3 text-sm text-muted-foreground">{children}</blockquote>,
        a: ({ children, href }) => <a className="font-medium text-foreground-strong underline underline-offset-4" href={href} rel="noreferrer" target="_blank">{children}</a>,
        table: ({ children }) => <div className="my-3 max-w-full overflow-x-auto"><table className="w-full border-collapse text-start text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border border-border bg-panel-raised px-2 py-1.5 font-semibold text-foreground-strong">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1.5 align-top text-foreground">{children}</td>,
        code: ({ children }) => <code className="rounded-sm border border-border bg-panel-raised px-1 py-0.5 font-mono text-xs text-foreground">{children}</code>,
        pre: ({ children }) => <pre className="my-3 overflow-auto rounded-md border border-border bg-panel-raised p-3 text-xs leading-5">{children}</pre>
      }}
    >
      {normalizeMarkdown(text)}
    </ReactMarkdown>
  );
}
