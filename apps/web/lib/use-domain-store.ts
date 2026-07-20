"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  EvalFile as CoreEvalFile,
  FileRecord,
  Model,
  Role as CoreRole,
  RoleContract,
  Skill as CoreSkill,
  WorkflowFile as CoreWorkflowFile
} from "@spielos/core";
import { toast } from "@spielos/design-system";
import { fileRecordToItem, type WorkspaceItem } from "./workspace-data";
import { fetchJsonWithRetry } from "./fetch-json";
import { useRealtimeSubscription } from "./use-realtime";
import type { DomainEvent } from "./realtime";


export type DomainStore = {
  ready: boolean;
  files: FileRecord[];
  items: WorkspaceItem[];
  roles: CoreRole[];
  skills: CoreSkill[];
  workflows: CoreWorkflowFile[];
  evalFiles: CoreEvalFile[];
  models: Model[];
  libraryFolders: string[];
  reload: () => Promise<void>;
  saveFile: (id: string, patch: FilePatch) => Promise<void>;
  createFile: (input: CreateFileInput) => Promise<FileRecord>;
  deleteFile: (id: string) => Promise<void>;
  addRole: (role: NewRole) => Promise<CoreRole>;
  updateRole: (id: string, patch: Partial<CoreRole>) => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  addSkill: (skill: NewSkill) => Promise<CoreSkill>;
  updateSkill: (id: string, patch: Partial<CoreSkill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  addWorkflow: (workflow: NewWorkflow) => Promise<CoreWorkflowFile>;
  updateWorkflow: (id: string, patch: Partial<CoreWorkflowFile>) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  addEvalFile: (evalFile: NewEvalFile) => Promise<CoreEvalFile>;
  updateEvalFile: (id: string, patch: Partial<CoreEvalFile>) => Promise<void>;
  deleteEvalFile: (id: string) => Promise<void>;
  addItem: (item: NewWorkspaceItem) => Promise<WorkspaceItem>;
  updateItem: (id: string, patch: Partial<WorkspaceItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  addModel: (model: NewModel) => Promise<Model>;
  updateModel: (id: string, patch: Partial<Model>) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  addLibraryFolder: (name: string) => void;
  renameLibraryFolder: (oldName: string, newName: string) => Promise<void>;
  deleteLibraryFolder: (name: string, moveItemsTo?: string | null) => Promise<void>;
  resetWorkspace: () => Promise<void>;
};

type FilePatch = {
  title?: string;
  body?: string;
  status?: "draft" | "active" | "archived" | "deleted";
  metadata?: Record<string, unknown>;
};

type CreateFileInput = {
  title: string;
  body: string;
  fileType: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

type NewRole = {
  name: string;
  description: string;
  prompt: string;
  skillIds: string[];
  modelId: string | null;
  inputContract: RoleContract;
  outputContract: RoleContract;
  status: string;
};

type NewSkill = {
  name: string;
  slug: string;
  description: string;
  kind: CoreSkill["kind"];
  implementation: string;
  inputSchema: string;
  outputSchema: string;
  bindings: CoreSkill["bindings"];
  status: string;
};

type NewWorkflow = {
  name: string;
  description: string;
  nodes: CoreWorkflowFile["nodes"];
  edges: CoreWorkflowFile["edges"];
  status: string;
};

type NewEvalFile = {
  name: string;
  description: string;
  rules: CoreEvalFile["rules"];
  overallThreshold: number;
  loopConfig: CoreEvalFile["loopConfig"];
  status: string;
};

type NewWorkspaceItem = {
  kind: WorkspaceItem["kind"];
  title: string;
  body: string;
  folder?: string;
  status?: WorkspaceItem["status"];
  metadata?: Record<string, string>;
};

type NewModel = {
  name: string;
  provider: Model["provider"];
  model: string;
  baseUrl: string | null;
  secretEnvKey: string | null;
  enabled: boolean;
  config?: Record<string, unknown>;
};

const DomainStoreContext = createContext<DomainStore | null>(null);

function parseRole(row: FileRecord): CoreRole {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    description: String(m.description ?? ""),
    prompt: row.body,
    modelId: (m.modelId as string | null) ?? null,
    inputContract: (m.inputContract as RoleContract) ?? defaultInputContract(),
    outputContract: (m.outputContract as RoleContract) ?? defaultOutputContract(),
    skillIds: (m.skillIds as string[]) ?? (m.skillSlugs as string[]) ?? [],
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    metadata: m
  };
}

function parseSkill(row: FileRecord): CoreSkill {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    slug: String(m.slug ?? row.id),
    description: String(m.description ?? ""),
    kind: (m.kind as CoreSkill["kind"]) ?? "llm_call",
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    auth: (m.auth as CoreSkill["auth"]) ?? "none",
    sideEffect: (m.sideEffect as CoreSkill["sideEffect"]) ?? "none",
    inputSchema: typeof m.inputSchema === "string" ? m.inputSchema : JSON.stringify(m.inputSchema ?? {}),
    outputSchema: typeof m.outputSchema === "string" ? m.outputSchema : JSON.stringify(m.outputSchema ?? {}),
    implementation: String(m.implementation ?? row.body),
    bindings: (m.bindings as CoreSkill["bindings"]) ?? [],
    humanQuestions: (m.humanQuestions as CoreSkill["humanQuestions"]) ?? undefined,
    evalRules: (m.evalRules as CoreSkill["evalRules"]) ?? undefined,
    overallThreshold: (m.overallThreshold as number | undefined) ?? undefined,
    metadata: m
  };
}

function parseEval(row: FileRecord): CoreEvalFile {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    description: String(m.description ?? row.body ?? ""),
    rules: (m.rules as CoreEvalFile["rules"]) ?? [],
    overallThreshold: Number(m.overallThreshold ?? 75),
    loopConfig: (m.loopConfig as CoreEvalFile["loopConfig"]) ?? {
      enabled: false,
      maxAttempts: 3,
      breakCondition: "on_pass",
      retryDelayMs: 0
    },
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    metadata: m
  };
}

function parseWorkflow(row: FileRecord): CoreWorkflowFile {
  const m = row.metadata ?? {};
  const rawNodes = (m.nodes as Array<Record<string, unknown>>) ?? [];
  const rawEdges = (m.edges as Array<Record<string, unknown>>) ?? [];
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    description: row.body,
    nodes: rawNodes.map((n, i) => ({
      id: String(n.id ?? `node-${i + 1}`),
      title: String(n.title ?? `Step ${i + 1}`),
      roleId: String(n.roleId ?? n.roleSlug ?? ""),
      promptOverride: n.promptOverride ? String(n.promptOverride) : undefined,
      humanQuestions: n.humanQuestions as CoreWorkflowFile["nodes"][number]["humanQuestions"],
      skillIds: (n.skillIds as string[]) ?? (n.skillSlugs as string[]) ?? [],
      fileIds: (n.fileIds as string[]) ?? (n.fileSlugs as string[]) ?? [],
      skillSlugs: [],
      fileSlugs: [],
      inputContract: String(n.inputContract ?? n.input ?? "any"),
      outputContract: String(n.outputContract ?? n.output ?? "any"),
      position: (n.position as { x: number; y: number }) ?? { x: 120 + i * 260, y: 160 },
      loopConfig: n.loopConfig as CoreWorkflowFile["nodes"][number]["loopConfig"],
      evalInput: n.evalInput as CoreWorkflowFile["nodes"][number]["evalInput"]
    })),
    edges: rawEdges.map((e) => ({
      id: String(e.id),
      source: String(e.source),
      target: String(e.target)
    })),
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    metadata: m
  };
}

function defaultInputContract(): RoleContract {
  return {
    name: "Input",
    format: "markdown",
    body: "Describe the request, context, constraints, source material, and success criteria this role needs before it starts.",
    required: true,
    multiple: false
  };
}

function defaultOutputContract(): RoleContract {
  return {
    name: "Output",
    format: "markdown",
    body: "Describe the exact deliverable this role must return, including structure, tone, required sections, and quality bar.",
    required: true,
    multiple: false
  };
}

function parseModel(row: {
  id: string;
  orgId: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  secretEnvKey: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
}): Model {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    provider: row.provider as Model["provider"],
    model: row.model,
    baseUrl: row.baseUrl,
    secretEnvKey: row.secretEnvKey,
    config: row.config ?? {},
    enabled: row.enabled
  };
}

const KIND_TO_FILE_TYPE: Record<WorkspaceItem["kind"], string> = {
  strategy: "strategy",
  knowledge: "knowledge",
  library: "draft",
  prompt: "prompt",
  roles: "harness_role",
  skills: "harness_skill",
  workstreams: "harness_workflow",
  evals: "harness_eval"
};

export function DomainStoreProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [ready, setReady] = useState(false);
  const [libraryFolders, setLibraryFolders] = useState<string[]>([]);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const loadErrorShown = useRef(false);
  const reloadRef = useRef<(() => Promise<void>) | null>(null);
  const mountTime = useRef(Date.now());

  // Phase 4: subscribe to org-scoped domain events. File mutations
  // published by the server trigger a fresh `reload()` so the UI sees
  // the canonical state without polling. The store stays unaware of
  // the transport; `useRealtimeSubscription` is the only thing that
  // knows about EventSource.
  const orgCookie = typeof document === "undefined" ? null : document.cookie
    .split("; ")
    .find((row) => row.startsWith("spielos.org="))
    ?.split("=")[1] ?? null;
  const realtimeListener = useCallback((event: DomainEvent) => {
    // The relay sends `context.invalidated` as a greeting on every new
    // SSE connection. Skip it during the first 3s — the data was just
    // loaded by the mount effect.
    if (event.type === "context.invalidated" && Date.now() - mountTime.current < 3_000) return;
    if (
      event.type === "file.created" ||
      event.type === "file.updated" ||
      event.type === "file.deleted" ||
      event.type === "context.invalidated"
    ) {
      void reloadRef.current?.();
    }
  }, []);
  useRealtimeSubscription(orgCookie ? `org:${orgCookie}` : null, orgCookie, realtimeListener);

  const reload = useCallback(async () => {
    reloadRef.current = reload;
    if (typeof window !== "undefined" && window.location.pathname === "/login") {
      setReady(true);
      return;
    }
    try {
      const [filesResult, modelsResult] = await Promise.allSettled([
        fetchJsonWithRetry<{ files: FileRecord[] }>("/api/harness/files", { cache: "no-store" }),
        fetchJsonWithRetry<{ models: Array<{
          id: string;
          orgId: string;
          name: string;
          provider: string;
          model: string;
          baseUrl: string | null;
          secretEnvKey: string | null;
          config: Record<string, unknown>;
          enabled: boolean;
        }> }>("/api/models", { cache: "no-store" }),
      ]);

      for (const result of [filesResult, modelsResult]) {
        if (result.status === "rejected" && result.reason?.message?.includes("401")) {
          if (typeof window !== "undefined" && window.location.pathname !== "/login") {
            window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
          }
          return;
        }
      }

      if (filesResult.status === "fulfilled") {
        const dbFiles = filesResult.value.files ?? [];
        setFiles(dbFiles);
        const folders = new Set<string>();
        const libraryFileTypes = new Set([
          "artifact",
          "asset",
          "draft",
          "eval_report",
          "evidence",
          "harness_template",
          "publish_package"
        ]);
        for (const f of dbFiles) {
          if (typeof f.metadata?.seedFolder === "string" && libraryFileTypes.has(f.fileType)) {
            folders.add(f.metadata.seedFolder);
          }
        }
        setLibraryFolders(Array.from(folders));
      }
      if (modelsResult.status === "fulfilled") {
        setModels((modelsResult.value.models ?? []).map(parseModel));
      }
      if (filesResult.status === "rejected" || modelsResult.status === "rejected") {
        throw filesResult.status === "rejected" ? filesResult.reason : modelsResult.status === "rejected" ? modelsResult.reason : new Error("Workspace data failed to load");
      }
      loadErrorShown.current = false;
      setReady(true);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to load domain:", err);
      }
      if (!loadErrorShown.current) {
        toast.error("Workspace data could not be loaded", { description: "SpielOS will retry on the next workspace refresh." });
        loadErrorShown.current = true;
      }
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handler = () => void reload();
    window.addEventListener("spielos:workspace-reload", handler);
    return () => window.removeEventListener("spielos:workspace-reload", handler);
  }, [reload]);

  const createFile = useCallback(
    async (input: { title: string; body: string; fileType: string; status?: string; metadata?: Record<string, unknown> }) => {
      const res = await fetch("/api/harness/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      if (!res.ok) throw new Error("Failed to create file");
      const data = (await res.json()) as { file: FileRecord };
      setFiles((current) => [data.file, ...current]);
      return data.file;
    },
    []
  );

  const saveFile = useCallback(
    async (id: string, patch: FilePatch) => {
      setFiles((current) =>
        current.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: new Date().toISOString() } : f))
      );
      const existing = saveTimers.current.get(id);
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        id,
        setTimeout(async () => {
          await fetch("/api/harness/files", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, ...patch })
          }).catch((err) => {
            if (process.env.NODE_ENV !== "production") {
              console.warn("Save failed:", err);
            }
          });
          saveTimers.current.delete(id);
        }, 400)
      );
    },
    []
  );

  const deleteFile = useCallback(async (id: string) => {
    const res = await fetch(`/api/harness/files?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete file");
    setFiles((current) => current.filter((f) => f.id !== id));
  }, []);

  // ── Compatibility helpers for existing pages ──────────────────

  const addRole = useCallback(
    async (role: {
      name: string;
      description: string;
      prompt: string;
      skillIds: string[];
      modelId: string | null;
      inputContract: RoleContract;
      outputContract: RoleContract;
      status: string;
    }) => {
      const file = await createFile({
        title: role.name,
        body: role.prompt,
        fileType: "harness_role",
        status: role.status,
        metadata: {
          role: true,
          slug: role.name.toLowerCase().replace(/\s+/g, "-"),
          description: role.description,
          skillIds: role.skillIds,
          modelId: role.modelId,
          inputContract: role.inputContract,
          outputContract: role.outputContract
        }
      });
      return parseRole(file);
    },
    [createFile]
  );

  const updateRole = useCallback(
    async (id: string, patch: Partial<CoreRole>) => {
      const existing = files.find((f) => f.id === id);
      if (!existing) return;
      const next = { ...parseRole(existing), ...patch };
      await saveFile(id, {
        title: next.name,
        body: next.prompt,
        status: next.status,
        metadata: {
          ...existing.metadata,
          role: true,
          slug: next.name.toLowerCase().replace(/\s+/g, "-"),
          description: next.description,
          skillIds: next.skillIds,
          modelId: next.modelId,
          inputContract: next.inputContract,
          outputContract: next.outputContract
        }
      });
    },
    [files, saveFile]
  );

  const deleteRole = useCallback(async (id: string) => {
    await deleteFile(id);
  }, [deleteFile]);

  const addSkill = useCallback(
    async (skill: {
      name: string;
      slug: string;
      description: string;
      kind: CoreSkill["kind"];
      implementation: string;
      inputSchema: string;
      outputSchema: string;
      bindings: CoreSkill["bindings"];
      status: string;
    }) => {
      const file = await createFile({
        title: skill.name,
        body: skill.implementation,
        fileType: "harness_skill",
        status: skill.status,
        metadata: {
          skill: true,
          slug: skill.slug,
          kind: skill.kind,
          description: skill.description,
          inputSchema: skill.inputSchema,
          outputSchema: skill.outputSchema,
          bindings: skill.bindings
        }
      });
      return parseSkill(file);
    },
    [createFile]
  );

  const updateSkill = useCallback(
    async (id: string, patch: Partial<CoreSkill>) => {
      const existing = files.find((f) => f.id === id);
      if (!existing) return;
      const next = { ...parseSkill(existing), ...patch };
      await saveFile(id, {
        title: next.name,
        body: next.implementation,
        status: next.status,
        metadata: {
          ...existing.metadata,
          skill: true,
          slug: next.slug,
          kind: next.kind,
          description: next.description,
          inputSchema: next.inputSchema,
          outputSchema: next.outputSchema,
          bindings: next.bindings
        }
      });
    },
    [files, saveFile]
  );

  const deleteSkill = useCallback(async (id: string) => {
    await deleteFile(id);
  }, [deleteFile]);

  const addWorkflow = useCallback(
    async (workflow: { name: string; description: string; nodes: CoreWorkflowFile["nodes"]; edges: CoreWorkflowFile["edges"]; status: string }) => {
      const file = await createFile({
        title: workflow.name,
        body: workflow.description,
        fileType: "harness_workflow",
        status: workflow.status,
        metadata: {
          workstream: true,
          slug: workflow.name.toLowerCase().replace(/\s+/g, "-"),
          nodes: workflow.nodes,
          edges: workflow.edges
        }
      });
      return parseWorkflow(file);
    },
    [createFile]
  );

  const updateWorkflow = useCallback(
    async (id: string, patch: Partial<CoreWorkflowFile>) => {
      const existing = files.find((f) => f.id === id);
      if (!existing) return;
      const next = { ...parseWorkflow(existing), ...patch };
      await saveFile(id, {
        title: next.name,
        body: next.description,
        status: next.status,
        metadata: {
          ...existing.metadata,
          workstream: true,
          slug: next.name.toLowerCase().replace(/\s+/g, "-"),
          nodes: next.nodes,
          edges: next.edges
        }
      });
    },
    [files, saveFile]
  );

  const deleteWorkflow = useCallback(async (id: string) => {
    await deleteFile(id);
  }, [deleteFile]);

  const addEvalFile = useCallback(
    async (evalFile: { name: string; description: string; rules: CoreEvalFile["rules"]; overallThreshold: number; loopConfig: CoreEvalFile["loopConfig"]; status: string }) => {
      const file = await createFile({
        title: evalFile.name,
        body: evalFile.description,
        fileType: "harness_eval",
        status: evalFile.status,
        metadata: {
          eval: true,
          slug: evalFile.name.toLowerCase().replace(/\s+/g, "-"),
          rules: evalFile.rules,
          overallThreshold: evalFile.overallThreshold,
          loopConfig: evalFile.loopConfig
        }
      });
      return parseEval(file);
    },
    [createFile]
  );

  const updateEvalFile = useCallback(
    async (id: string, patch: Partial<CoreEvalFile>) => {
      const existing = files.find((f) => f.id === id);
      if (!existing) return;
      const next = { ...parseEval(existing), ...patch };
      await saveFile(id, {
        title: next.name,
        body: next.description,
        status: next.status,
        metadata: {
          ...existing.metadata,
          eval: true,
          slug: next.name.toLowerCase().replace(/\s+/g, "-"),
          rules: next.rules,
          overallThreshold: next.overallThreshold,
          loopConfig: next.loopConfig
        }
      });
    },
    [files, saveFile]
  );

  const deleteEvalFile = useCallback(async (id: string) => {
    await deleteFile(id);
  }, [deleteFile]);

  const addItem = useCallback(
    async (item: { kind: WorkspaceItem["kind"]; title: string; body: string; folder?: string; status?: WorkspaceItem["status"]; metadata?: Record<string, string> }) => {
      const fileType = KIND_TO_FILE_TYPE[item.kind];
      const file = await createFile({
        title: item.title,
        body: item.body,
        fileType,
        status: item.status ?? "draft",
        metadata: { ...(item.metadata ?? {}), seedFolder: item.folder }
      });
      return fileRecordToItem(file)!;
    },
    [createFile]
  );

  const updateItem = useCallback(
    async (id: string, patch: Partial<WorkspaceItem>) => {
      const update: FilePatch = {};
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.body !== undefined) update.body = patch.body;
      if (patch.status !== undefined) update.status = patch.status;
      if (patch.folder !== undefined) {
        const existing = files.find((f) => f.id === id);
        update.metadata = { ...(existing?.metadata ?? {}), seedFolder: patch.folder };
      }
      await saveFile(id, update);
    },
    [files, saveFile]
  );

  const deleteItem = useCallback(async (id: string) => {
    await deleteFile(id);
  }, [deleteFile]);

  const addModel = useCallback(
    async (model: { name: string; provider: Model["provider"]; model: string; baseUrl: string | null; secretEnvKey: string | null; enabled: boolean; config?: Record<string, unknown>; apiKey?: string }) => {
      const { apiKey, ...body } = model;
      const payload = apiKey ? { ...body, apiKey } : body;
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text ? `Failed to add model: ${text}` : "Failed to add model");
      }
      const data = (await res.json()) as { model: { id: string; orgId: string; name: string; provider: string; model: string; baseUrl: string | null; secretEnvKey: string | null; config: Record<string, unknown>; enabled: boolean } };
      const parsed = parseModel(data.model);
      setModels((current) => [...current, parsed]);
      return parsed;
    },
    []
  );

  const updateModel = useCallback(
    async (id: string, patch: Partial<Model> & { apiKey?: string | null }) => {
      const { apiKey, ...rest } = patch;
      const payload = apiKey !== undefined ? { ...rest, apiKey } : rest;
      const res = await fetch("/api/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...payload })
      });
      if (!res.ok) throw new Error("Failed to update model");
      const result = (await res.json()) as { model: { id: string; orgId: string; name: string; provider: string; model: string; baseUrl: string | null; secretEnvKey: string | null; config: Record<string, unknown>; enabled: boolean } };
      setModels((current) => current.map((m) => (m.id === id ? parseModel(result.model) : m)));
    },
    []
  );

  const deleteModel = useCallback(async (id: string) => {
    const res = await fetch(`/api/models?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete model");
    setModels((current) => current.filter((m) => m.id !== id));
  }, []);

  const addLibraryFolder = useCallback((name: string) => {
    setLibraryFolders((current) => (current.includes(name) ? current : [...current, name]));
  }, []);

  const renameLibraryFolder = useCallback(
    async (oldName: string, newName: string) => {
      setLibraryFolders((current) => current.map((f) => (f === oldName ? newName : f)));
      // Update file metadata to reflect new folder
      for (const f of files) {
        if ((f.metadata?.seedFolder as string | undefined) === oldName) {
          await saveFile(f.id, {
            metadata: { ...f.metadata, seedFolder: newName }
          });
        }
      }
    },
    [files, saveFile]
  );

  const deleteLibraryFolder = useCallback(
    async (name: string, moveItemsTo?: string | null) => {
      setLibraryFolders((current) => current.filter((f) => f !== name));
      for (const f of files) {
        if ((f.metadata?.seedFolder as string | undefined) === name) {
          if (moveItemsTo === null) {
            await deleteFile(f.id);
          } else {
            await saveFile(f.id, {
              metadata: { ...f.metadata, seedFolder: moveItemsTo ?? "Drafts" }
            });
          }
        }
      }
    },
    [files, saveFile, deleteFile]
  );

  const resetWorkspace = useCallback(async () => {
    const res = await fetch("/api/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "all", confirm: "RESET" })
    });
    if (!res.ok) throw new Error("Reset failed");
    await reload();
  }, [reload]);

  const items = files
    .map(fileRecordToItem)
    .filter((item): item is WorkspaceItem => item !== null);

  const skills = files.filter((f) => f.fileType === "harness_skill").map(parseSkill);
  const skillIdBySlug = new Map(skills.map((skill) => [skill.slug, skill.id]));
  const roles = files
    .filter((f) => f.fileType === "harness_role")
    .map(parseRole)
    .map((role) => ({
      ...role,
      skillIds: role.skillIds.map((idOrSlug) => skillIdBySlug.get(idOrSlug) ?? idOrSlug)
    }));
  const workflows = files.filter((f) => f.fileType === "harness_workflow" || f.fileType === "harness_workstream").map(parseWorkflow);
  const evalFiles = files.filter((f) => f.fileType === "harness_eval").map(parseEval);

  const store = useMemo<DomainStore>(
    () => ({
      ready,
      files,
      items,
      roles,
      skills,
      workflows,
      evalFiles,
      models,
      libraryFolders,
      reload,
      saveFile,
      createFile,
      deleteFile,
      addRole,
      updateRole,
      deleteRole,
      addSkill,
      updateSkill,
      deleteSkill,
      addWorkflow,
      updateWorkflow,
      deleteWorkflow,
      addEvalFile,
      updateEvalFile,
      deleteEvalFile,
      addItem,
      updateItem,
      deleteItem,
      addModel,
      updateModel,
      deleteModel,
      addLibraryFolder,
      renameLibraryFolder,
      deleteLibraryFolder,
      resetWorkspace
    }),
    [
      ready,
      files,
      items,
      roles,
      skills,
      workflows,
      evalFiles,
      models,
      libraryFolders,
      reload,
      saveFile,
      createFile,
      deleteFile,
      addRole,
      updateRole,
      deleteRole,
      addSkill,
      updateSkill,
      deleteSkill,
      addWorkflow,
      updateWorkflow,
      deleteWorkflow,
      addEvalFile,
      updateEvalFile,
      deleteEvalFile,
      addItem,
      updateItem,
      deleteItem,
      addModel,
      updateModel,
      deleteModel,
      addLibraryFolder,
      renameLibraryFolder,
      deleteLibraryFolder,
      resetWorkspace
    ]
  );

  return createElement(DomainStoreContext.Provider, { value: store }, children);
}

export function useDomainStore(): DomainStore {
  const store = useContext(DomainStoreContext);
  if (!store) throw new Error("useDomainStore must be used within a <DomainStoreProvider>");
  return store;
}
