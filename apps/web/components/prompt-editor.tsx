"use client";

import { useMemo, useState } from "react";
import { Button, Pill, Tooltip, cn } from "@spielos/design-system";
import { Icon } from "./icons";

function parseJson(value: string): { valid: true; formatted: string } | { valid: false; error: string } {
  try {
    return { valid: true, formatted: JSON.stringify(JSON.parse(value), null, 2) };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid JSON"
    };
  }
}

export function PromptEditor({
  value,
  onChange,
  fileName,
  onRename
}: {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  onRename?: (newFileName: string) => void;
}) {
  const [formatMessage, setFormatMessage] = useState<string | null>(null);
  const isJson = fileName.toLowerCase().endsWith(".json");
  const jsonState = useMemo(() => (isJson && value.trim() ? parseJson(value) : null), [isJson, value]);
  const jsonLabel = jsonState === null ? "json" : jsonState.valid ? "valid json" : "invalid json";

  function formatJson() {
    if (!isJson) return;
    const result = parseJson(value || "{}");
    if (!result.valid) {
      setFormatMessage(result.error);
      return;
    }
    onChange(result.formatted);
    setFormatMessage("Formatted");
  }

  function toggleFormat() {
    if (!onRename) return;
    const base = fileName.replace(/\.(json|md)$/i, "");
    const newExt = isJson ? ".md" : ".json";
    onRename(`${base}${newExt}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-3">
        <button
          className={cn(
            "flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
            !isJson
              ? "bg-selected text-foreground-strong"
              : "text-muted-foreground hover:bg-hover hover:text-foreground"
          )}
          onClick={() => !isJson || toggleFormat()}
          type="button"
        >
          <Icon name="prompt" size={12} />
          Markdown
        </button>
        <button
          className={cn(
            "flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
            isJson
              ? "bg-selected text-foreground-strong"
              : "text-muted-foreground hover:bg-hover hover:text-foreground"
          )}
          onClick={() => isJson || toggleFormat()}
          type="button"
        >
          <Icon name="prompt-json" size={12} />
          JSON
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        <Pill tone={isJson ? (jsonState?.valid === false ? "destructive" : "default") : "default"}>
          {isJson ? jsonLabel : "markdown"}
        </Pill>
        {isJson && jsonState?.valid === false ? (
          <span className="min-w-0 truncate text-xs text-destructive">{jsonState.error}</span>
        ) : formatMessage ? (
          <span className="text-xs text-muted-foreground">{formatMessage}</span>
        ) : null}

        {isJson ? (
          <Tooltip content="Format JSON" side="bottom">
            <Button aria-label="Format JSON" className="ml-auto" onClick={formatJson} size="icon" type="button" variant="ghost">
              <Icon name="code" size={14} />
            </Button>
          </Tooltip>
        ) : null}
      </div>
      <textarea
        aria-label={isJson ? "JSON prompt body" : "Markdown prompt body"}
        className="min-h-0 flex-1 resize-none border-0 bg-background px-6 py-6 font-mono text-[13px] leading-6 text-foreground outline-none focus-visible:ring-0"
        onChange={(event) => {
          setFormatMessage(null);
          onChange(event.target.value);
        }}
        placeholder={
          isJson
            ? "{\n  \"instructions\": \"...\",\n  \"constraints\": []\n}"
            : "# Prompt\n\nWrite reusable instructions for a system or strategy prompt."
        }
        spellCheck={false}
        value={value}
      />
    </div>
  );
}
