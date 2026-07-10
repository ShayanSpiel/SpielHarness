"use client";

import { Icon } from "../../components/icons";
import { PageHeader } from "@spielos/design-system";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { PromptEditor } from "../../components/prompt-editor";

const PROMPT_DEFAULT_FOLDERS = [
  "System Prompts",
  "Strategy Prompts",
  "Reusable Blocks",
  "Experiments"
];

export default function PromptsPage() {
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name="prompt" size={14} />}
          title="Prompts"
        />

        <FolderFileBrowser
          title="Prompts"
          itemKind="prompts"
          defaultFolders={PROMPT_DEFAULT_FOLDERS}
          fileExtension=".md"
          fileIconName="prompt"
          folderIconName="prompt-folder"
          folderSectionLabel="Prompt Folders"
          newFileLabel="Prompt"
          searchPlaceholder="Search prompts"
          renderEditor={({ value, onChange, fileName }) => (
            <PromptEditor
              fileName={fileName}
              onChange={onChange}
              value={value}
            />
          )}
          emptyStateDescription="Create or select a prompt. Use .md for normal prompts and .json only when a structured prompt contract needs validation."
        />
      </div>
    </AppShell>
  );
}
