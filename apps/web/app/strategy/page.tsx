"use client";

import { useMemo, useState } from "react";
import { cn } from "@spielos/design-system";
import { Icon } from "../../components/icons";
import { PageHeader } from "@spielos/design-system";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { PromptEditor } from "../../components/prompt-editor";
import { StrategyEditor } from "../../components/strategy-editor";

type StrategySection = "strategy" | "prompts";

const STRATEGY_DEFAULT_FOLDERS = [
  "Brand",
  "Audience",
  "Offer",
  "Voice",
  "Positioning"
];

const PROMPT_DEFAULT_FOLDERS = [
  "System Prompts",
  "Strategy Prompts",
  "Reusable Blocks",
  "Experiments"
];

const SECTION_LABELS: Record<StrategySection, string> = {
  strategy: "Strategy Files",
  prompts: "Prompts"
};

const SECTION_ICONS: Record<StrategySection, string> = {
  strategy: "strategy",
  prompts: "prompt"
};

export default function StrategyPage() {
  const [activeSection, setActiveSection] = useState<StrategySection>("strategy");
  const sections = useMemo<StrategySection[]>(() => ["strategy", "prompts"], []);

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name="strategy" size={14} />}
          title="Strategy"
        />

        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-raised px-3">
          {sections.map((section) => {
            const active = activeSection === section;
            return (
              <button
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-selected text-foreground-strong"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground"
                )}
                key={section}
                onClick={() => setActiveSection(section)}
                type="button"
              >
                <Icon name={SECTION_ICONS[section]} size={14} />
                {SECTION_LABELS[section]}
              </button>
            );
          })}
        </div>

        {activeSection === "strategy" ? (
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
        ) : (
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
            emptyStateDescription="Create or select a system or strategy prompt. Role prompts stay on Roles."
          />
        )}
      </div>
    </AppShell>
  );
}
