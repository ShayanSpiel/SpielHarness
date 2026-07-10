"use client";

import { Icon } from "../../components/icons";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { StrategyEditor } from "../../components/strategy-editor";

const STRATEGY_DEFAULT_FOLDERS = [
  "Brand",
  "Audience",
  "Offer",
  "Voice",
  "Positioning",
  "Prompts"
];

export default function StrategyPage() {
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-panel-raised text-foreground">
              <Icon name="brain" size={14} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">Strategy</h1>
            </div>
          </div>
        </header>

        <FolderFileBrowser
          title="Strategy"
          itemKind="strategy"
          defaultFolders={STRATEGY_DEFAULT_FOLDERS}
          fileExtension=".md"
          renderEditor={({ value, onChange, fileName }) => (
            <StrategyEditor
              fileName={fileName}
              onChange={onChange}
              value={value}
            />
          )}
          emptyStateDescription="Create or select a strategy file to start editing. Supports .md and .json files."
        />
      </div>
    </AppShell>
  );
}
