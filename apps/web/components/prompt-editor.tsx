"use client";

import { useMemo, useState } from "react";
import { Button, Pill, Tooltip } from "@spielos/design-system";
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
  fileName
}: {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
}) {
  const [formatMessage, setFormatMessage] = useState<string | null>(null);
  const isJson = fileName.toLowerCase().endsWith(".json");
  const jsonState = useMemo(() => (isJson && value.trim() ? parseJson(value) : null), [isJson, value]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-3">
        <Icon name={isJson ? "prompt-json" : "prompt"} className="text-muted-foreground" size={14} />
        <span className="text-xs font-medium text-foreground">
          {isJson ? "JSON Prompt" : "Markdown Prompt"}
        </span>
        <Pill tone={isJson ? (jsonState?.valid === false ? "destructive" : "success") : "default"} className="ml-1">
          {isJson ? (jsonState?.valid === false ? "invalid json" : "valid json") : "markdown"}
        </Pill>
        {isJson && jsonState?.valid === false ? (
          <span className="min-w-0 truncate text-xs text-destructive">{jsonState.error}</span>
        ) : formatMessage ? (
          <span className="text-xs text-muted-foreground">{formatMessage}</span>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground">{value.length} chars</span>
        {isJson ? (
          <Tooltip content="Format JSON" side="bottom">
            <Button aria-label="Format JSON" onClick={formatJson} size="icon" type="button" variant="ghost">
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
