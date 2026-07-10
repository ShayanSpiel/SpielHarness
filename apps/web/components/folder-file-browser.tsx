"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Pill,
  Tooltip,
  cn
} from "@spielos/design-system";
import { Icon } from "./icons";
import { useWorkspaceStore } from "../lib/use-workspace-store";
import type { WorkspaceItem, WorkspaceKind } from "../lib/workspace-data";

type FolderFileBrowserProps = {
  title: string;
  itemKind: WorkspaceKind;
  defaultFolders: string[];
  fileExtension: string;
  fileIconName?: string;
  folderIconName?: string;
  folderSectionLabel?: string;
  newFileLabel?: string;
  searchPlaceholder?: string;
  useSharedFolders?: boolean;
  renderEditor: (props: {
    value: string;
    onChange: (value: string) => void;
    fileName: string;
  }) => ReactNode;
  showStatusSelect?: boolean;
  showFolderSelect?: boolean;
  emptyStateDescription?: string;
};

function sortByTitle(a: WorkspaceItem, b: WorkspaceItem) {
  return a.title.localeCompare(b.title);
}

export function FolderFileBrowser({
  title,
  itemKind,
  defaultFolders,
  fileExtension,
  fileIconName = "file-text",
  folderIconName = "folder",
  folderSectionLabel = "Folders",
  newFileLabel = "File",
  searchPlaceholder = "Search files",
  useSharedFolders = false,
  renderEditor,
  showStatusSelect = true,
  showFolderSelect = true,
  emptyStateDescription = "Create or select a file from the folder tree to start editing."
}: FolderFileBrowserProps) {
  const store = useWorkspaceStore();
  const resourceItems = useMemo(
    () =>
      store.items
        .filter((item) => item.kind === itemKind)
        .map((item) => ({ ...item, folder: item.folder ?? defaultFolders[0] ?? "Notes" }))
        .sort(sortByTitle),
    [store.items, itemKind, defaultFolders]
  );
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const folders = useMemo(() => {
    const seen = new Set<string>();
    const itemFolders = resourceItems
      .map((item) => item.folder)
      .filter((folder): folder is string => Boolean(folder));
    const source = useSharedFolders
      ? [...store.libraryFolders, ...defaultFolders, ...itemFolders, ...localFolders]
      : [...defaultFolders, ...itemFolders, ...localFolders];
    return source.filter((folder) => {
      if (seen.has(folder)) return false;
      seen.add(folder);
      return true;
    });
  }, [defaultFolders, localFolders, resourceItems, store.libraryFolders, useSharedFolders]);

  const initialItem = resourceItems[0] ?? null;
  const [selectedFolder, setSelectedFolder] = useState<string>(
    initialItem?.folder ?? folders[0] ?? defaultFolders[0] ?? "Notes"
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialItem?.id ?? null);
  const [query, setQuery] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [fileNameDraft, setFileNameDraft] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set([initialItem?.folder ?? folders[0] ?? defaultFolders[0] ?? "Notes"])
  );

  function emptyDraft(folder: string): WorkspaceItem {
    return {
      id: "new",
      kind: itemKind,
      title: `Untitled${fileExtension}`,
      body: "",
      folder,
      status: "draft",
      metadata: { type: fileExtension === ".json" ? "json" : "markdown" },
      updatedAt: new Date().toISOString()
    };
  }

  const selected = resourceItems.find((item) => item.id === selectedId) ?? null;
  const [draft, setDraft] = useState<WorkspaceItem>(selected ?? emptyDraft(selectedFolder));
  const dirty = selected ? JSON.stringify(draft) !== JSON.stringify(selected) : draft.body.length > 0;

  useEffect(() => {
    if (!selected) return;
    setDraft(selected);
    if (selected.folder) {
      setSelectedFolder(selected.folder);
      setExpandedFolders((current) => new Set(current).add(selected.folder ?? defaultFolders[0] ?? "Notes"));
    }
  }, [selected, defaultFolders]);

  const itemsByFolder = useMemo(() => {
    const search = query.trim().toLowerCase();
    return folders.map((folder) => {
      const files = resourceItems.filter((item) => {
        const inFolder = item.folder === folder;
        const matches =
          !search ||
          item.title.toLowerCase().includes(search) ||
          item.body.toLowerCase().includes(search);
        return inFolder && matches;
      });
      return { folder, files };
    }).filter((entry) => !search || entry.files.length > 0 || entry.folder.toLowerCase().includes(search));
  }, [folders, query, resourceItems]);

  function toggleFolder(folder: string) {
    setSelectedFolder(folder);
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  function selectFile(item: WorkspaceItem) {
    setSelectedId(item.id);
    setDraft(item);
    if (item.folder) {
      setSelectedFolder(item.folder);
      setExpandedFolders((current) => new Set(current).add(item.folder ?? defaultFolders[0] ?? "Notes"));
    }
  }

  function createFolder(event?: FormEvent) {
    event?.preventDefault();
    const clean = folderName.trim();
    if (!clean) return;
    if (useSharedFolders) store.addLibraryFolder(clean);
    else setLocalFolders((current) => current.includes(clean) ? current : [...current, clean]);
    setSelectedFolder(clean);
    setExpandedFolders((current) => new Set(current).add(clean));
    setFolderName("");
    setCreatingFolder(false);
  }

  function startRenameFolder(folder: string) {
    setEditingFolder(folder);
    setFolderDraft(folder);
  }

  function commitRenameFolder() {
    if (!editingFolder) return;
    const clean = folderDraft.trim();
    if (clean && clean !== editingFolder) {
      if (useSharedFolders) {
        store.renameLibraryFolder(editingFolder, clean);
      } else {
        setLocalFolders((current) =>
          current.map((folder) => folder === editingFolder ? clean : folder)
        );
        resourceItems
          .filter((item) => item.folder === editingFolder)
          .forEach((item) =>
            store.updateItem(item.id, {
              ...item,
              folder: clean,
              metadata: { ...item.metadata, seedFolder: clean }
            })
          );
      }
      setSelectedFolder((current) => (current === editingFolder ? clean : current));
      setDraft((current) =>
        current.folder === editingFolder ? { ...current, folder: clean } : current
      );
      setExpandedFolders((current) => {
        const next = new Set(current);
        if (next.delete(editingFolder)) next.add(clean);
        return next;
      });
    }
    setEditingFolder(null);
    setFolderDraft("");
  }

  function deleteFolder(folder: string) {
    resourceItems
      .filter((item) => item.folder === folder)
      .forEach((item) => store.deleteItem(item.id));
    if (useSharedFolders) store.deleteLibraryFolder(folder, null);
    else setLocalFolders((current) => current.filter((entry) => entry !== folder));
    const nextFolder = folders.find((entry) => entry !== folder) ?? defaultFolders[0] ?? "Notes";
    const nextFile = resourceItems.find((item) => item.folder !== folder) ?? null;
    setSelectedFolder(nextFolder);
    setSelectedId(nextFile?.id ?? null);
    setDraft(nextFile ?? emptyDraft(nextFolder));
  }

  function createFile() {
    const folder = selectedFolder || folders[0] || defaultFolders[0] || "Notes";
    const created = store.addItem({
      ...emptyDraft(folder),
      kind: itemKind,
      title: `Untitled${fileExtension}`
    });
    setExpandedFolders((current) => new Set(current).add(folder));
    setSelectedId(created.id);
    setDraft(created);
  }

  function startRenameFile(item: WorkspaceItem) {
    setEditingFileId(item.id);
    setFileNameDraft(item.title);
  }

  function commitRenameFile(id: string) {
    const clean = fileNameDraft.trim() || `Untitled${fileExtension}`;
    store.updateItem(id, { title: clean });
    setDraft((current) => (current.id === id ? { ...current, title: clean } : current));
    setEditingFileId(null);
    setFileNameDraft("");
  }

  function saveFile() {
    if (!selected) return;
    const next = {
      ...draft,
      title: draft.title.trim() || `Untitled${fileExtension}`,
      folder: draft.folder || selectedFolder || defaultFolders[0] || "Notes"
    };
    store.updateItem(selected.id, next);
    setDraft(next);
  }

  function deleteFile(item = selected) {
    if (!item) return;
    store.deleteItem(item.id);
    const next =
      resourceItems.find((entry) => entry.id !== item.id && entry.folder === item.folder) ??
      resourceItems.find((entry) => entry.id !== item.id) ??
      null;
    setSelectedId(next?.id ?? null);
    setDraft(next ?? emptyDraft(selectedFolder));
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-background">
        <div className="border-b border-border p-3 md:hidden">
          <SearchInput placeholder={searchPlaceholder} query={query} setQuery={setQuery} />
        </div>

        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {folderSectionLabel}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip content="New folder" side="bottom">
              <Button
                aria-label="New folder"
                className="h-7 px-2"
                onClick={() => setCreatingFolder(true)}
                size="sm"
                variant="ghost"
              >
                <Icon name="folder-plus" size={14} />
                <span className="ml-1 text-xs">Folder</span>
              </Button>
            </Tooltip>
            <Tooltip content="New file" side="bottom">
              <Button
                aria-label="New file"
                className="h-7 px-2"
                onClick={createFile}
                size="sm"
                variant="ghost"
              >
                <Icon name="plus" size={14} />
                <span className="ml-1 text-xs">{newFileLabel}</span>
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="hidden border-b border-border p-2 md:block">
          <SearchInput placeholder={searchPlaceholder} query={query} setQuery={setQuery} />
        </div>

        {creatingFolder ? (
          <form className="flex items-center gap-1 border-b border-border p-2" onSubmit={createFolder}>
            <Input
              autoFocus
              className="h-8 text-xs"
              onBlur={() => {
                if (folderName.trim()) createFolder();
              }}
              onChange={(event) => setFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setCreatingFolder(false);
                  setFolderName("");
                }
              }}
              placeholder="Folder name"
              value={folderName}
            />
            <Button aria-label="Create folder" size="icon" type="submit" variant="ghost">
              <Icon name="check" size={14} />
            </Button>
          </form>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {itemsByFolder.length === 0 ? (
            <EmptyState
              className="py-10"
              description="No folders or files match this search."
              title="No matches"
            />
          ) : (
            <ul className="grid gap-0.5">
              {itemsByFolder.map(({ folder, files }) => {
                const expanded = query.trim() ? true : expandedFolders.has(folder);
                const folderActive = selectedFolder === folder;
                return (
                  <li key={folder}>
                    <div
                      className={cn(
                        "group flex h-8 items-center gap-1 rounded-md px-1.5 text-sm transition-colors",
                        folderActive
                          ? "bg-selected text-foreground-strong"
                          : "text-foreground-muted hover:bg-hover hover:text-foreground"
                      )}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => toggleFolder(folder)}
                        type="button"
                      >
                        <Icon name="chevron-right" className={cn("shrink-0 transition-transform", expanded && "rotate-90")} size={14} />
                        <Icon name={folderIconName} className="shrink-0" size={14} />
                        {editingFolder === folder ? (
                          <Input
                            autoFocus
                            className="h-6 text-xs"
                            onBlur={commitRenameFolder}
                            onChange={(event) => setFolderDraft(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitRenameFolder();
                              if (event.key === "Escape") {
                                setEditingFolder(null);
                                setFolderDraft("");
                              }
                            }}
                            value={folderDraft}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate">{folder}</span>
                        )}
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {files.length}
                        </span>
                      </button>
                      <TreeMenu
                        onDelete={() => deleteFolder(folder)}
                        onRename={() => startRenameFolder(folder)}
                      />
                    </div>

                    {expanded ? (
                      <ul className="ml-5 mt-0.5 grid gap-0.5 border-l border-border pl-2">
                        {files.length === 0 ? (
                          <li className="px-2 py-1 text-[11px] text-muted-foreground">Empty</li>
                        ) : (
                          files.map((item) => (
                            <FileTreeRow
                              editing={editingFileId === item.id}
                              fileNameDraft={fileNameDraft}
                              item={item}
                              iconName={fileIconName}
                              key={item.id}
                              onDelete={() => deleteFile(item)}
                              onRename={() => startRenameFile(item)}
                              onSelect={() => selectFile(item)}
                              onUpdateDraft={setFileNameDraft}
                              onCancelRename={() => {
                                setEditingFileId(null);
                                setFileNameDraft("");
                              }}
                              onCommitRename={() => commitRenameFile(item.id)}
                              selected={item.id === selectedId}
                            />
                          ))
                        )}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span>{title}</span>
            <Icon name="chevron-right" size={12} />
            <button
              className="max-w-40 truncate rounded-sm px-1 text-foreground-muted hover:bg-hover hover:text-foreground"
              onClick={() => selected?.folder && setSelectedFolder(selected.folder)}
              type="button"
            >
              {draft.folder || selectedFolder}
            </button>
            <Icon name="chevron-right" size={12} />
            <span className="max-w-72 truncate text-foreground">{draft.title}</span>
            {dirty ? <Pill tone="warning">unsaved</Pill> : null}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {showStatusSelect ? (
              <StatusSelect
                value={draft.status}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, status: value as WorkspaceItem["status"] }))
                }
              />
            ) : null}
            {showFolderSelect ? (
              <FolderSelect
                folders={folders}
                value={draft.folder || selectedFolder}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, folder: value }))
                }
              />
            ) : null}
            <Tooltip content="Delete file" side="bottom">
              <Button
                aria-label="Delete file"
                disabled={!selected}
                onClick={() => deleteFile()}
                size="icon"
                variant="ghost"
              >
                <Icon name="trash" size={14} />
              </Button>
            </Tooltip>
            <Button disabled={!selected || !dirty} onClick={saveFile} size="md">
              <Icon name="save" size={14} />
              Save
            </Button>
          </div>
        </div>

        {selected ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="grid shrink-0 gap-3 border-b border-border bg-panel-raised px-4 py-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <Field label="File name">
                <Input
                  className="h-8 text-sm font-medium"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  value={draft.title}
                />
              </Field>
              {showFolderSelect ? (
                <Field label="Folder">
                  <FolderSelect
                    folders={folders}
                    value={draft.folder || selectedFolder}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, folder: value }))
                    }
                  />
                </Field>
              ) : null}
            </div>

            {renderEditor({
              value: draft.body,
              onChange: (body) => setDraft((current) => ({ ...current, body })),
              fileName: draft.title
            })}
          </section>
        ) : (
          <EmptyState
            className="flex-1"
            description={emptyStateDescription}
            title="No file selected"
          />
        )}
      </main>
    </div>
  );
}

function SearchInput({
  placeholder,
  query,
  setQuery
}: {
  placeholder: string;
  query: string;
  setQuery: (value: string) => void;
}) {
  return (
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
      <Input
        className="h-8 pl-7 text-xs"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        value={query}
      />
    </div>
  );
}

function FileTreeRow({
  editing,
  fileNameDraft,
  iconName,
  item,
  onCommitRename,
  onCancelRename,
  onDelete,
  onRename,
  onSelect,
  onUpdateDraft,
  selected
}: {
  editing: boolean;
  fileNameDraft: string;
  iconName: string;
  item: WorkspaceItem;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onRename: () => void;
  onSelect: () => void;
  onUpdateDraft: (value: string) => void;
  selected: boolean;
}) {
  return (
    <li
      className={cn(
        "group flex min-h-8 items-center gap-1 rounded-md px-1.5 text-sm transition-colors",
        selected ? "bg-selected text-foreground-strong" : "text-foreground-muted hover:bg-hover hover:text-foreground"
      )}
    >
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSelect} type="button">
        <Icon name={iconName} className="shrink-0" size={14} />
        {editing ? (
          <Input
            autoFocus
            className="h-6 text-xs"
            onBlur={onCommitRename}
            onChange={(event) => onUpdateDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitRename();
              if (event.key === "Escape") onCancelRename();
            }}
            value={fileNameDraft}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        )}
      </button>
      <TreeMenu onDelete={onDelete} onRename={onRename} />
    </li>
  );
}

function TreeMenu({
  onDelete,
  onRename
}: {
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Actions"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          size="icon"
          variant="ghost"
        >
          <Icon name="more" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <Icon name="edit" size={14} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
          <Icon name="trash" size={14} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      ariaLabel="File status"
      className="w-28"
      onChange={onChange}
      options={[
        { label: "draft", value: "draft" },
        { label: "active", value: "active" },
        { label: "archived", value: "archived" }
      ]}
      value={value}
    />
  );
}

function FolderSelect({
  folders,
  value,
  onChange
}: {
  folders: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      ariaLabel="Folder"
      className="w-32"
      onChange={onChange}
      options={folders.map((folder) => ({ label: folder, value: folder }))}
      value={value}
    />
  );
}

function NativeSelect({
  ariaLabel,
  className,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-label={ariaLabel}
        className="h-8 w-full appearance-none rounded-md border border-border bg-input px-2.5 pr-8 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-right" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-muted-foreground" size={14} />
    </div>
  );
}
