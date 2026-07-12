"use client";

import { Icon } from "@spielos/design-system/components";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  EmptyState,
  Field,
  Input,
  ListItem,
  Panel,
  Pill,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip
} from "@spielos/design-system";
import { SIDEBAR } from "../lib/layout-constants";
import { useWorkspaceStore } from "../lib/use-workspace-store";
import type {
  WorkspaceItem,
  WorkspaceKind
} from "../lib/workspace-data";

function emptyItem(kind: WorkspaceKind): WorkspaceItem {
  return {
    id: "new",
    kind,
    title: "Untitled",
    body: "",
    folder: ["knowledge", "library", "prompts", "strategy"].includes(kind) ? "Drafts" : undefined,
    status: "draft",
    metadata: {},
    updatedAt: new Date().toISOString()
  };
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export function ResourcePage({
  kind,
  kinds,
  createKind,
  title,
  showFolders,
  newLabel,
  fields,
  inspector
}: {
  kind?: WorkspaceKind;
  kinds?: WorkspaceKind[];
  createKind?: WorkspaceKind;
  title: string;
  showFolders?: boolean;
  newLabel?: string;
  fields?: (item: WorkspaceItem, update: (patch: Partial<WorkspaceItem>) => void) => ReactNode;
  inspector?: ReactNode;
}) {
  const store = useWorkspaceStore();
  const editableKinds = useMemo(() => kinds ?? (kind ? [kind] : []), [kind, kinds]);
  const defaultKind = createKind ?? kind ?? editableKinds[0] ?? "knowledge";
  const items = useMemo(
    () => store.items.filter((item) => editableKinds.includes(item.kind)),
    [editableKinds, store.items]
  );

  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkspaceItem>(emptyItem(defaultKind));
  const isNew = selectedId === null;

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const visibleItems = useMemo(() => {
    let list = items;
    if (showFolders && activeFolder) list = list.filter((i) => i.folder === activeFolder);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, search, showFolders, activeFolder]);

  function selectItem(item: WorkspaceItem | null) {
    if (item) {
      setSelectedId(item.id);
      setDraft(item);
    } else {
      const fresh = emptyItem(defaultKind);
      setSelectedId(null);
      setDraft(fresh);
    }
  }

  function patchDraft(patch: Partial<WorkspaceItem>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function save() {
    if (isNew) {
      store.addItem({
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        folder: draft.folder,
        status: draft.status,
        metadata: draft.metadata
      });
      setSelectedId(null);
      setDraft(emptyItem(defaultKind));
    } else {
      store.updateItem(selected!.id, draft);
    }
  }

  function remove() {
    if (!selected) return;
    store.deleteItem(selected.id);
    selectItem(null);
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className={`flex ${SIDEBAR.LIST_NARROW} shrink-0 flex-col border-r border-border bg-background`}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
          <Pill tone="default" className="ml-auto">
            {items.length}
          </Pill>
        </div>

        <div className="border-b border-border p-2">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <Input
              className="h-8 pl-7"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              value={search}
            />
          </div>
          {showFolders ? <FolderStrip activeFolder={activeFolder} setActiveFolder={setActiveFolder} /> : null}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <Button
            className="mb-2 w-full"
            icon="plus"
            onClick={() => selectItem(null)}
            size="md"
            variant="outline"
          >
            New {newLabel ?? "item"}
          </Button>

          {visibleItems.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No items yet.</p>
          ) : (
            <ul className="space-y-1">
              {visibleItems.map((item) => (
                <ListItem
                  active={item.id === selectedId}
                  description={item.body || "Empty"}
                  footnotes={
                    <>
                      {item.folder ? <Pill>{item.folder}</Pill> : null}
                      <span className="ml-auto">{relTime(item.updatedAt)}</span>
                    </>
                  }
                  key={item.id}
                  metadata={
                    <Pill
                      tone={
                        item.status === "active"
                          ? "success"
                          : item.status === "archived"
                            ? "warning"
                            : "default"
                      }
                      className="shrink-0 text-3xs"
                    >
                      {item.status}
                    </Pill>
                  }
                  onClick={() => selectItem(item)}
                  title={item.title}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          <Panel>
            <div className="mb-4 flex items-center gap-2">
              <Link className="text-muted-foreground hover:text-foreground" href="/">
                <Icon name="arrow-left" size={16} />
              </Link>
               <Icon name="chevron-right" className="text-muted-foreground" size={14} />
              <h1 className="text-sm font-semibold text-foreground">{title}</h1>
              {selected ? (
                <Pill tone="default" className="ml-2">
                  {selected.kind}
                </Pill>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                {selected ? (
                  <Tooltip content="Delete" side="bottom">
                    <Button
                      aria-label="Delete"
                      icon="trash"
                      onClick={remove}
                      size="icon-sm"
                      variant="ghost"
                    />
                  </Tooltip>
                ) : null}
                <Button icon="save" onClick={save} size="md">
                  {isNew ? "Create" : "Save"}
                </Button>
              </div>
            </div>

            {!selected && !isNew ? (
              <EmptyState
                className="py-12"
                description={`No ${title.toLowerCase()} items to edit. Create one from the sidebar.`}
                title="Nothing selected"
              />
            ) : (
              <div className="grid gap-4">
                <Field label="Title">
                  <Input
                    onChange={(event) => patchDraft({ title: event.target.value })}
                    value={draft.title}
                  />
                </Field>

                {showFolders ? (
                  <Field label="Folder">
                    <FolderSelect
                      onChange={(value) => patchDraft({ folder: value })}
                      value={draft.folder ?? ""}
                    />
                  </Field>
                ) : null}

                <Field label="Status">
                  <Select
                    onValueChange={(value) =>
                      patchDraft({ status: value as WorkspaceItem["status"] })
                    }
                    value={draft.status}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">active</SelectItem>
                      <SelectItem value="draft">draft</SelectItem>
                      <SelectItem value="archived">archived</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {fields ? fields(draft, patchDraft) : null}

                <Field label="Content">
                  <Textarea
                    autoResize
                    className="min-h-[360px] font-mono"
                    onChange={(event) => patchDraft({ body: event.target.value })}
                    value={draft.body}
                  />
                </Field>
              </div>
            )}
          </Panel>
        </div>
      </section>

      {inspector ? <aside className={`${SIDEBAR.LIST_WIDTH} shrink-0 border-l border-border bg-panel`}>{inspector}</aside> : null}
    </div>
  );
}

function FolderStrip({
  activeFolder,
  setActiveFolder
}: {
  activeFolder: string | null;
  setActiveFolder: (folder: string | null) => void;
}) {
  const store = useWorkspaceStore();
  return (
    <Tabs
      className="mt-2 w-full"
      onValueChange={(value) => setActiveFolder(value === "all" ? null : value)}
      value={activeFolder ?? "all"}
    >
      <TabsList className="w-full overflow-x-auto">
        <TabsTrigger value="all">All</TabsTrigger>
        {store.libraryFolders.map((folder) => (
          <TabsTrigger key={folder} value={folder}>
            {folder}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function FolderSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const store = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function commit() {
    if (name.trim()) {
      store.addLibraryFolder(name.trim());
      onChange(name.trim());
    }
    setName("");
    setCreating(false);
  }

  if (creating) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          className="h-8"
          onBlur={commit}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setCreating(false);
              setName("");
            }
          }}
          placeholder="New folder name"
          value={name}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger>
          <SelectValue placeholder="Choose folder" />
        </SelectTrigger>
        <SelectContent>
          {store.libraryFolders.map((folder) => (
            <SelectItem key={folder} value={folder}>
              {folder}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tooltip content="New folder" side="right">
        <Button
          aria-label="New folder"
          onClick={() => setCreating(true)}
          size="icon"
          variant="ghost"
        >
           <Icon name="plus" size={14} />
        </Button>
      </Tooltip>
    </div>
  );
}

export { FolderSelect };
