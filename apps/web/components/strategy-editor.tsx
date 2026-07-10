"use client";

import { DocumentEditor } from "./document-editor";

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export function StrategyEditor({
  value,
  onChange,
  fileName
}: {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
}) {
  const isJson = fileName.endsWith(".json");

  if (isJson) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-4">
          <span className="text-xs font-medium text-muted-foreground">JSON</span>
          {!isValidJson(value) && value.length > 0 ? (
            <span className="text-xs text-destructive">Invalid JSON</span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <textarea
            className="h-full w-full resize-none border-0 bg-background p-6 font-mono text-[13px] leading-6 text-foreground outline-none"
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            value={value}
          />
        </div>
      </div>
    );
  }

  return <DocumentEditor onChange={onChange} value={value} />;
}
