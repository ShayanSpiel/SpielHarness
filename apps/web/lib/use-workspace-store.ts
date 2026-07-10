"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Artifact,
  Role,
  RunEvent
} from "@spielos/core";
import type {
  Chat,
  ChatMessage,
  EvalFile,
  EvalFileResult,
  EvalSuite,
  ProviderModel,
  SkillDefinition,
  WorkspaceItem,
  WorkspaceState,
  WorkstreamDefinition
} from "./workspace-data";
import { initialWorkspaceState } from "./workspace-data";
import { loadWorkspaceFromDb, deleteItemFromDb, saveHarnessFile } from "./supabase-store";

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

type Store = WorkspaceState & {
  ready: boolean;
  setActiveChat: (id: string | null) => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorWidth: (width: number) => void;
  toggleInspector: () => void;
  createChat: (title?: string) => Chat;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  touchChat: (id: string) => void;
  updateChatRoles: (id: string, roleIds: string[]) => void;
  updateChatTool: (id: string, toolId: string | null) => void;
  appendMessage: (chatId: string, message: Omit<ChatMessage, "id" | "createdAt" | "chatId">) => ChatMessage;
  appendEvent: (chatId: string, event: RunEvent) => void;
  appendArtifact: (chatId: string, artifact: Artifact) => void;
  addItem: (item: Omit<WorkspaceItem, "id" | "updatedAt">) => WorkspaceItem;
  updateItem: (id: string, patch: Partial<WorkspaceItem>) => void;
  deleteItem: (id: string) => void;
  addRole: (role: Omit<Role, "id" | "orgId">) => Role;
  updateRole: (id: string, patch: Partial<Role>) => void;
  deleteRole: (id: string) => void;
  addSkill: (skill: Omit<SkillDefinition, "id" | "updatedAt">) => SkillDefinition;
  updateSkill: (id: string, patch: Partial<SkillDefinition>) => void;
  deleteSkill: (id: string) => void;
  addWorkstream: (workstream: Omit<WorkstreamDefinition, "id" | "updatedAt">) => WorkstreamDefinition;
  updateWorkstream: (id: string, patch: Partial<WorkstreamDefinition>) => void;
  deleteWorkstream: (id: string) => void;
  addEvalSuite: (suite: Omit<EvalSuite, "id" | "updatedAt">) => EvalSuite;
  updateEvalSuite: (id: string, patch: Partial<EvalSuite>) => void;
  deleteEvalSuite: (id: string) => void;
  addEvalFile: (evalFile: Omit<EvalFile, "id" | "updatedAt" | "results">) => EvalFile;
  updateEvalFile: (id: string, patch: Partial<EvalFile>) => void;
  deleteEvalFile: (id: string) => void;
  appendEvalResult: (evalId: string, result: EvalFileResult) => void;
  addModel: (model: Omit<ProviderModel, "id">) => void;
  updateModel: (id: string, patch: Partial<ProviderModel>) => void;
  deleteModel: (id: string) => void;
  addLibraryFolder: (name: string) => void;
  renameLibraryFolder: (oldName: string, newName: string) => void;
  deleteLibraryFolder: (name: string, moveItemsTo?: string | null) => void;
  resetWorkspace: () => void;
};

const WorkspaceStoreContext = createContext<Store | null>(null);

export function WorkspaceStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(initialWorkspaceState);
  const [ready, setReady] = useState(false);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    loadWorkspaceFromDb()
      .then((loaded) => {
        setState(loaded);
        setReady(true);
      })
      .catch((err) => {
        console.error("Failed to load workspace from DB:", err);
        setReady(true);
      });
  }, []);

  const debouncedSaveItem = useCallback((id: string, patch: Partial<WorkspaceItem>) => {
    const timer = saveTimers.current.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.current.set(
      id,
      setTimeout(async () => {
        try {
          await fetch("/api/harness/files", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, ...patch })
          });
        } catch (err) {
          console.warn("Failed to save item to DB:", err);
        }
        saveTimers.current.delete(id);
      }, 500)
    );
  }, []);

  const store = useMemo<Store>(
    () => ({
      ...state,
      ready,

      setActiveChat(id: string | null) {
        setState((current) => ({ ...current, activeChatId: id }));
      },
      setInspectorOpen(open: boolean) {
        setState((current) => ({ ...current, inspectorOpen: open }));
      },
      setInspectorWidth(width: number) {
        const next = Math.min(640, Math.max(280, Math.round(width)));
        setState((current) => ({ ...current, inspectorWidth: next }));
      },
      toggleInspector() {
        setState((current) => ({ ...current, inspectorOpen: !current.inspectorOpen }));
      },

      createChat(title = "New chat"): Chat {
        const chat: Chat = {
          id: createId("chat"),
          title,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          messageIds: [],
          artifactIds: [],
          activeRoleIds: [],
          toolId: null
        };
        setState((current) => ({
          ...current,
          chats: [chat, ...current.chats],
          messages: { ...current.messages, [chat.id]: [] },
          events: { ...current.events, [chat.id]: [] },
          artifacts: [...current.artifacts],
          activeChatId: chat.id
        }));
        return chat;
      },
      deleteChat(id: string) {
        setState((current) => {
          const messages: Record<string, ChatMessage[]> = {};
          const events: Record<string, RunEvent[]> = {};
          for (const key of Object.keys(current.messages)) {
            if (key !== id) messages[key] = current.messages[key];
          }
          for (const key of Object.keys(current.events)) {
            if (key !== id) events[key] = current.events[key];
          }
          return {
            ...current,
            chats: current.chats.filter((chat) => chat.id !== id),
            messages,
            events,
            activeChatId: current.activeChatId === id ? null : current.activeChatId
          };
        });
      },
      renameChat(id: string, title: string) {
        setState((current) => ({
          ...current,
          chats: current.chats.map((chat) =>
            chat.id === id ? { ...chat, title, updatedAt: nowIso() } : chat
          )
        }));
      },
      touchChat(id: string) {
        setState((current) => ({
          ...current,
          chats: current.chats.map((chat) =>
            chat.id === id ? { ...chat, updatedAt: nowIso() } : chat
          )
        }));
      },
      updateChatRoles(id: string, roleIds: string[]) {
        setState((current) => ({
          ...current,
          chats: current.chats.map((chat) =>
            chat.id === id ? { ...chat, activeRoleIds: roleIds, updatedAt: nowIso() } : chat
          )
        }));
      },
      updateChatTool(id: string, toolId: string | null) {
        setState((current) => ({
          ...current,
          chats: current.chats.map((chat) =>
            chat.id === id ? { ...chat, toolId, updatedAt: nowIso() } : chat
          )
        }));
      },
      appendMessage(chatId: string, message: Omit<ChatMessage, "id" | "createdAt" | "chatId">) {
        const entry: ChatMessage = {
          id: createId("msg"),
          chatId,
          createdAt: nowIso(),
          ...message
        };
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [chatId]: [...(current.messages[chatId] ?? []), entry]
          },
          chats: current.chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, messageIds: [...chat.messageIds, entry.id], updatedAt: nowIso() }
              : chat
          )
        }));
        return entry;
      },
      appendEvent(chatId: string, event: RunEvent) {
        setState((current) => ({
          ...current,
          events: {
            ...current.events,
            [chatId]: [...(current.events[chatId] ?? []), event]
          }
        }));
      },
      appendArtifact(chatId: string, artifact: Artifact) {
        setState((current) => ({
          ...current,
          artifacts: current.artifacts.some((existing) => existing.id === artifact.id)
            ? current.artifacts
            : [...current.artifacts, artifact],
          chats: current.chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, artifactIds: chat.artifactIds.includes(artifact.id) ? chat.artifactIds : [...chat.artifactIds, artifact.id], updatedAt: nowIso() }
              : chat
          )
        }));
      },

      addItem(item: Omit<WorkspaceItem, "id" | "updatedAt">) {
        const created = { ...item, id: createId(item.kind), updatedAt: nowIso() };
        setState((current) => ({
          ...current,
          items: [...current.items, created]
        }));
        return created;
      },
      updateItem(id: string, patch: Partial<WorkspaceItem>) {
        setState((current) => ({
          ...current,
          items: current.items.map((item) =>
            item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item
          )
        }));
        debouncedSaveItem(id, patch);
      },
      deleteItem(id: string) {
        setState((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== id)
        }));
        deleteItemFromDb(id).catch(() => {});
      },

      addRole(role: Omit<Role, "id" | "orgId">) {
        const id = crypto.randomUUID();
        const created = { ...role, id, orgId: "demo-org" };
        setState((current) => ({
          ...current,
          roles: [...current.roles, created]
        }));
        saveHarnessFile({
          id,
          title: role.name,
          body: role.prompt,
          fileType: "harness_role",
          status: role.status,
          metadata: {
            role: true,
            slug: role.name.toLowerCase().replace(/\s+/g, "."),
            description: role.description,
            skillIds: role.skillIds,
            modelId: role.modelId,
            memoryPolicy: role.memoryPolicy,
            inputTypes: role.inputArtifactTypes,
            outputTypes: role.outputArtifactTypes
          }
        }).catch(() => {});
        return created;
      },
      updateRole(id: string, patch: Partial<Role>) {
        const existing = state.roles.find((role) => role.id === id);
        const next = existing ? { ...existing, ...patch } : patch;
        setState((current) => ({
          ...current,
          roles: current.roles.map((role) => (role.id === id ? { ...role, ...patch } : role))
        }));
        saveHarnessFile({
          id,
          title: next.name ?? "Untitled role",
          body: next.prompt ?? "",
          fileType: "harness_role",
          status: next.status,
          metadata: {
            role: true,
            slug: (next.name ?? "role").toLowerCase().replace(/\s+/g, "."),
            description: next.description ?? "",
            skillIds: next.skillIds ?? [],
            modelId: next.modelId ?? null,
            memoryPolicy: next.memoryPolicy ?? [],
            inputTypes: next.inputArtifactTypes ?? [],
            outputTypes: next.outputArtifactTypes ?? []
          }
        }).catch(() => {});
      },
      deleteRole(id: string) {
        setState((current) => ({
          ...current,
          roles: current.roles.filter((role) => role.id !== id)
        }));
        deleteItemFromDb(id).catch(() => {});
      },

      addSkill(skill: Omit<SkillDefinition, "id" | "updatedAt">) {
        const id = crypto.randomUUID();
        const created = { ...skill, id, updatedAt: nowIso() };
        setState((current) => ({
          ...current,
          skills: [...current.skills, created]
        }));
        saveHarnessFile({
          id,
          title: skill.name,
          body: skill.implementation,
          fileType: "harness_skill",
          status: skill.status,
          metadata: {
            skill: true,
            slug: skill.slug,
            kind: skill.category === "evaluation" ? "eval" :
                  skill.category === "retrieval" ? "knowledge_search" :
                  skill.category === "search" || skill.category === "publishing" ? "http" :
                  skill.category === "custom" ? "human_input" : "llm_call",
            description: skill.description,
            auth: skill.auth,
            sideEffect: skill.sideEffect,
            inputSchema: skill.inputSchema,
            outputSchema: skill.outputSchema,
            category: skill.category,
            evalRubrics: skill.evalRubrics,
            overallThreshold: skill.overallThreshold
          }
        }).catch(() => {});
        return created;
      },
      updateSkill(id: string, patch: Partial<SkillDefinition>) {
        const existing = state.skills.find((skill) => skill.id === id);
        const next = existing ? { ...existing, ...patch } : patch;
        setState((current) => ({
          ...current,
          skills: current.skills.map((skill) =>
            skill.id === id ? { ...skill, ...patch, updatedAt: nowIso() } : skill
          )
        }));
        saveHarnessFile({
          id,
          title: next.name ?? "Untitled skill",
          body: next.implementation ?? "",
          fileType: "harness_skill",
          status: next.status,
          metadata: {
            skill: true,
            slug: next.slug,
            kind: next.category === "evaluation" ? "eval" :
                  next.category === "retrieval" ? "knowledge_search" :
                  next.category === "search" || next.category === "publishing" ? "http" :
                  next.category === "custom" ? "human_input" : "llm_call",
            description: next.description ?? "",
            auth: next.auth ?? "none",
            sideEffect: next.sideEffect ?? "none",
            inputSchema: next.inputSchema ?? "{}",
            outputSchema: next.outputSchema ?? "{}",
            category: next.category ?? "custom",
            evalRubrics: next.evalRubrics,
            overallThreshold: next.overallThreshold
          }
        }).catch(() => {});
      },
      deleteSkill(id: string) {
        setState((current) => ({
          ...current,
          skills: current.skills.filter((skill) => skill.id !== id),
          roles: current.roles.map((role) => ({
            ...role,
            skillIds: (role.skillIds as string[]).filter((skillId: string) => skillId !== id)
          })),
          workstreams: current.workstreams.map((workstream) => ({
            ...workstream,
            nodes: workstream.nodes.map((node) => ({
              ...node,
              skillIds: node.skillIds.filter((skillId) => skillId !== id)
            }))
          }))
        }));
        deleteItemFromDb(id).catch(() => {});
      },

      addWorkstream(workstream: Omit<WorkstreamDefinition, "id" | "updatedAt">) {
        const id = crypto.randomUUID();
        const created = { ...workstream, id, updatedAt: nowIso() };
        setState((current) => ({
          ...current,
          workstreams: [...current.workstreams, created]
        }));
        saveHarnessFile({
          id,
          title: workstream.title,
          body: workstream.description,
          fileType: "harness_workstream",
          status: workstream.status,
          metadata: {
            workstream: true,
            slug: workstream.title.toLowerCase().replace(/\s+/g, "."),
            nodes: workstream.nodes,
            edges: workstream.edges
          }
        }).catch(() => {});
        return created;
      },
      updateWorkstream(id: string, patch: Partial<WorkstreamDefinition>) {
        const existing = state.workstreams.find((workstream) => workstream.id === id);
        const next = existing ? { ...existing, ...patch } : patch;
        setState((current) => ({
          ...current,
          workstreams: current.workstreams.map((ws) =>
            ws.id === id ? { ...ws, ...patch, updatedAt: nowIso() } : ws
          )
        }));
        saveHarnessFile({
          id,
          title: next.title ?? "Untitled workflow",
          body: next.description ?? "",
          fileType: "harness_workstream",
          status: next.status,
          metadata: {
            workstream: true,
            slug: (next.title ?? "workflow").toLowerCase().replace(/\s+/g, "."),
            nodes: next.nodes ?? [],
            edges: next.edges ?? []
          }
        }).catch(() => {});
      },
      deleteWorkstream(id: string) {
        setState((current) => ({
          ...current,
          workstreams: current.workstreams.filter((ws) => ws.id !== id)
        }));
        deleteItemFromDb(id).catch(() => {});
      },

      addEvalSuite(suite: Omit<EvalSuite, "id" | "updatedAt">) {
        const created = { ...suite, id: createId("eval"), updatedAt: nowIso() };
        setState((current) => ({
          ...current,
          evalSuites: [...current.evalSuites, created]
        }));
        return created;
      },
      updateEvalSuite(id: string, patch: Partial<EvalSuite>) {
        setState((current) => ({
          ...current,
          evalSuites: current.evalSuites.map((suite) =>
            suite.id === id ? { ...suite, ...patch, updatedAt: nowIso() } : suite
          )
        }));
      },
      deleteEvalSuite(id: string) {
        setState((current) => ({
          ...current,
          evalSuites: current.evalSuites.filter((suite) => suite.id !== id)
        }));
      },

      addEvalFile(evalFile: Omit<EvalFile, "id" | "updatedAt" | "results">) {
        const created: EvalFile = { ...evalFile, id: crypto.randomUUID(), results: [], updatedAt: nowIso() };
        setState((current) => ({
          ...current,
          evalFiles: [...current.evalFiles, created]
        }));
        saveHarnessFile({
          id: created.id,
          title: created.name,
          body: created.description,
          fileType: "harness_eval",
          status: created.status,
          metadata: {
            eval: true,
            slug: created.name.toLowerCase().replace(/\s+/g, "."),
            targetType: created.targetType,
            targetId: created.targetId,
            rubrics: created.rubrics,
            overallThreshold: created.overallThreshold,
            loopConfig: created.loopConfig
          }
        }).catch(() => {});
        return created;
      },
      updateEvalFile(id: string, patch: Partial<EvalFile>) {
        const existing = state.evalFiles.find((evalFile) => evalFile.id === id);
        const next = existing ? { ...existing, ...patch } : patch;
        setState((current) => ({
          ...current,
          evalFiles: current.evalFiles.map((ef) =>
            ef.id === id ? { ...ef, ...patch, updatedAt: nowIso() } : ef
          )
        }));
        saveHarnessFile({
          id,
          title: next.name ?? "Untitled eval",
          body: next.description ?? "",
          fileType: "harness_eval",
          status: next.status,
          metadata: {
            eval: true,
            slug: (next.name ?? "eval").toLowerCase().replace(/\s+/g, "."),
            targetType: next.targetType ?? "draft",
            targetId: next.targetId ?? "",
            rubrics: next.rubrics ?? [],
            overallThreshold: next.overallThreshold ?? 75,
            loopConfig: next.loopConfig ?? {
              enabled: false,
              maxAttempts: 3,
              breakCondition: "on_pass",
              retryDelayMs: 0
            }
          }
        }).catch(() => {});
      },
      deleteEvalFile(id: string) {
        setState((current) => ({
          ...current,
          evalFiles: current.evalFiles.filter((ef) => ef.id !== id)
        }));
        deleteItemFromDb(id).catch(() => {});
      },
      appendEvalResult(evalId: string, result: EvalFileResult) {
        setState((current) => ({
          ...current,
          evalFiles: current.evalFiles.map((ef) =>
            ef.id === evalId
              ? { ...ef, results: [...ef.results, result], updatedAt: nowIso() }
              : ef
          )
        }));
      },

      addModel(model: Omit<ProviderModel, "id">) {
        setState((current) => ({
          ...current,
          models: [...current.models, { ...model, id: createId("model") }]
        }));
      },
      updateModel(id: string, patch: Partial<ProviderModel>) {
        setState((current) => ({
          ...current,
          models: current.models.map((model) =>
            model.id === id ? { ...model, ...patch } : model
          )
        }));
      },
      deleteModel(id: string) {
        setState((current) => ({
          ...current,
          models: current.models.filter((model) => model.id !== id)
        }));
      },

      addLibraryFolder(name: string) {
        const clean = name.trim();
        if (!clean) return;
        setState((current) =>
          current.libraryFolders.includes(clean)
            ? current
            : { ...current, libraryFolders: [...current.libraryFolders, clean] }
        );
      },
      renameLibraryFolder(oldName: string, newName: string) {
        const clean = newName.trim();
        if (!clean || oldName === clean) return;
        setState((current) => ({
          ...current,
          libraryFolders: current.libraryFolders.map((folder) =>
            folder === oldName ? clean : folder
          ),
          items: current.items.map((item) =>
            item.folder === oldName ? { ...item, folder: clean } : item
          )
        }));
      },
      deleteLibraryFolder(name: string, moveItemsTo?: string | null) {
        setState((current) => ({
          ...current,
          libraryFolders: current.libraryFolders.filter((folder) => folder !== name),
          items:
            moveItemsTo === null
              ? current.items.filter((item) => item.folder !== name)
              : current.items.map((item) =>
                  item.folder === name
                    ? { ...item, folder: moveItemsTo ?? current.libraryFolders[0] ?? "Drafts" }
                    : item
                )
        }));
      },

      resetWorkspace() {
        setState(initialWorkspaceState);
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, debouncedSaveItem]
  );

  return createElement(WorkspaceStoreContext.Provider, { value: store }, children);
}

export function useWorkspaceStore(): Store {
  const store = useContext(WorkspaceStoreContext);
  if (!store) {
    throw new Error("useWorkspaceStore must be used within a <WorkspaceStoreProvider>");
  }
  return store;
}
