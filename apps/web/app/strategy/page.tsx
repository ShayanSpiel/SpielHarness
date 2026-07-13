"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { PageHeader } from "@spielos/design-system";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { PromptEditor } from "../../components/prompt-editor";

const PROMPT_DEFAULT_FOLDERS = [
  "System Prompts",
  "Strategy Prompts",
  "Reusable Blocks",
  "Experiments",
  "Brand",
  "Audience",
  "Offer",
  "Voice",
  "Positioning"
];

export default function StrategyPage() {
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.strategy} size={14} />}
          title="Strategy"
        />

        <FolderFileBrowser
          title="Prompts"
          itemKind="prompt"
          defaultFolders={PROMPT_DEFAULT_FOLDERS}
          fileExtension=".md"
          fileIconName="task"
          folderIconName="prompt-folder"
          folderSectionLabel="Prompts"
          newFileLabel="Prompt"
          searchPlaceholder="Search prompts"
          showStatusSelect={false}
          renderEditor={({ value, onChange, fileName, onRename }) => (
            <PromptEditor
              fileName={fileName}
              onChange={onChange}
              onRename={onRename}
              value={value}
            />
          )}
          emptyStateDescription="Create or select a system or strategy prompt. Role prompts stay on Roles."
        />
      </div>
    </AppShell>
  );
}
