"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { NavTabs, PageHeader } from "@spielos/design-system";
import { useState } from "react";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { PromptEditor } from "../../components/prompt-editor";
import type { WorkspaceItemKind } from "../../lib/workspace-data";
import { MemoryWorkspace } from "../../components/memory-workspace";

const STRATEGY_ITEM_KINDS: WorkspaceItemKind[] = ["strategy", "prompt"];
const STRATEGY_FOLDERS = ["Strategy", "Prompts"];
const STRATEGY_FOLDER_KINDS: Record<string, WorkspaceItemKind> = {
  Strategy: "strategy",
  Prompts: "prompt"
};

export default function StrategyPage() {
  const [section, setSection] = useState<"strategy" | "memory">("strategy");
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.strategy} size={14} />}
          title="Strategy"
        />

        <NavTabs
          onChange={(value) => setSection(value as "strategy" | "memory")}
          tabs={[{ id: "strategy", label: "Strategy", icon: ENTITY_ICONS.strategy }, { id: "memory", label: "Memory", icon: "brain" }]}
          value={section}
        />

        {section === "strategy" ? <FolderFileBrowser
          title="Strategy"
          sidebarId="strategy-content"
          itemKind={STRATEGY_ITEM_KINDS}
          defaultFolders={STRATEGY_FOLDERS}
          folderKinds={STRATEGY_FOLDER_KINDS}
          fileExtension=".md"
          fileIconName="file-text"
          itemIconMap={{ strategy: "task", prompt: "prompt" }}
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
        /> : <MemoryWorkspace />}
      </div>
    </AppShell>
  );
}
