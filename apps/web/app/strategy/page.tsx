"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { PageHeader } from "@spielos/design-system";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { PromptEditor } from "../../components/prompt-editor";
import type { WorkspaceItemKind } from "../../lib/workspace-data";

const STRATEGY_ITEM_KINDS: WorkspaceItemKind[] = ["strategy", "prompt"];
const STRATEGY_FOLDERS = ["Strategy", "Prompts"];
const STRATEGY_FOLDER_KINDS: Record<string, WorkspaceItemKind> = {
  Strategy: "strategy",
  Prompts: "prompt"
};

export default function StrategyPage() {
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.strategy} size={14} />}
          title="Strategy"
        />

        <FolderFileBrowser
          title="Strategy"
          sidebarId="strategy-content"
          itemKind={STRATEGY_ITEM_KINDS}
          defaultFolders={STRATEGY_FOLDERS}
          folderKinds={STRATEGY_FOLDER_KINDS}
          fileExtension=".md"
          fileIconName="file-text"
          folderIconName="prompt-folder"
          folderSectionLabel="Strategy"
          newFileLabel="Document"
          searchPlaceholder="Search strategy and prompts"
          showStatusSelect={false}
          renderEditor={({ value, onChange, fileName, onRename }) => (
            <PromptEditor
              fileName={fileName}
              onChange={onChange}
              onRename={onRename}
              value={value}
            />
          )}
          emptyStateDescription="Create strategy and reusable prompts in one folder-based workspace. Role prompts stay on Roles."
        />
      </div>
    </AppShell>
  );
}
