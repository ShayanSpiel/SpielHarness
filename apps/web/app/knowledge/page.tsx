"use client";

import { useState, useMemo } from "react";
import { cn } from "@spielos/design-system";
import { Icon } from "../../components/icons";
import { PageHeader } from "@spielos/design-system";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { LibraryFilesSection } from "../../components/library-files-section";
import { DocumentEditor } from "../../components/document-editor";

type KnowledgeSection = "files" | "library";

const SECTION_LABELS: Record<KnowledgeSection, string> = {
  files: "Files",
  library: "Library"
};

const SECTION_ICONS: Record<KnowledgeSection, string> = {
  files: "cloud",
  library: "folder"
};

const LIBRARY_DEFAULT_FOLDERS = [
  "Sessions",
  "Notes",
  "Evidence",
  "Learnings",
  "Templates"
];

export default function KnowledgePage() {
  const [activeSection, setActiveSection] = useState<KnowledgeSection>("library");
  const [libraryKey, setLibraryKey] = useState(0);

  const sections: KnowledgeSection[] = useMemo(() => ["files", "library"], []);

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name="knowledge" size={14} />}
          title="Knowledge"
        />

        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-raised px-3">
          {sections.map((section) => {
            const active = activeSection === section;
            return (
              <button
                key={section}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-selected text-foreground-strong"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground"
                )}
                onClick={() => {
                  setActiveSection(section);
                  if (section === "library") {
                    setLibraryKey((k) => k + 1);
                  }
                }}
                type="button"
              >
                <Icon name={SECTION_ICONS[section]} size={14} />
                {SECTION_LABELS[section]}
              </button>
            );
          })}
        </div>

        {activeSection === "files" ? (
          <LibraryFilesSection />
        ) : (
          <FolderFileBrowser
            key={libraryKey}
            title="Library"
            itemKind="library"
            defaultFolders={LIBRARY_DEFAULT_FOLDERS}
            fileExtension=".md"
            renderEditor={({ value, onChange }) => (
              <DocumentEditor onChange={onChange} value={value} />
            )}
            emptyStateDescription="Create or select a file from the Library folder tree to start editing."
          />
        )}
      </div>
    </AppShell>
  );
}
