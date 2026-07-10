"use client";

import { Icon } from "../../components/icons";
import { PageHeader } from "@spielos/design-system";
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
        <PageHeader
          icon={<Icon name="brain" size={14} />}
          title="Strategy"
        />

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
