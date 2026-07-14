"use client";

import { useState } from "react";
import { NavTabs, PageHeader } from "@spielos/design-system";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { AppShell } from "../../components/app-shell";
import { FolderFileBrowser } from "../../components/folder-file-browser";
import { LibraryFilesSection } from "../../components/library-files-section";
import { DocumentEditor } from "../../components/document-editor";
import type { WorkspaceItemKind } from "../../lib/workspace-data";

type FilesSection = "library" | "files";

const FILES_TABS = [
  { id: "library", label: "Library", icon: "archive" },
  { id: "files", label: "Files", icon: "cloud" }
];
const LIBRARY_ITEM_KINDS: WorkspaceItemKind[] = ["knowledge", "library"];
const LIBRARY_DEFAULT_FOLDERS = ["Library"];

export default function FilesPage() {
  const [activeSection, setActiveSection] = useState<FilesSection>("library");
  const [libraryKey, setLibraryKey] = useState(0);

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.file} size={14} />}
          title="Files"
        />

        <NavTabs
          tabs={FILES_TABS}
          value={activeSection}
          onChange={(value) => {
            setActiveSection(value as FilesSection);
            if (value === "library") setLibraryKey((current) => current + 1);
          }}
        />

        {activeSection === "files" ? (
          <LibraryFilesSection />
        ) : (
          <FolderFileBrowser
            key={`library-${libraryKey}`}
            title="Library"
            sidebarId="local-library"
            itemKind={LIBRARY_ITEM_KINDS}
            defaultFolders={LIBRARY_DEFAULT_FOLDERS}
            fileExtension=".md"
            useSharedFolders
            showStatusSelect={false}
            renderEditor={({ value, onChange }) => (
              <DocumentEditor onChange={onChange} value={value} />
            )}
            emptyStateDescription="Local source text, saved articles, emails, references, and generated outputs appear here. Google Drive remains in Files."
          />
        )}
      </div>
    </AppShell>
  );
}
