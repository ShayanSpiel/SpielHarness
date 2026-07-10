import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type DatabaseFileType =
  | "knowledge"
  | "strategy"
  | "prompt"
  | "artifact"
  | "draft"
  | "evidence"
  | "asset"
  | "eval_report"
  | "publish_package"
  | "harness_role"
  | "harness_skill"
  | "harness_workstream"
  | "harness_eval"
  | "harness_template"
  | "harness_chat_message";

export type DatabaseFileStatus = "draft" | "active" | "archived" | "deleted";

export type DatabaseFile = {
  id: string;
  org_id: string;
  folder_id: string | null;
  file_type: DatabaseFileType;
  status: DatabaseFileStatus;
  title: string;
  body: string;
  content_format: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DatabaseRun = {
  id: string;
  org_id: string;
  chat_id: string | null;
  run_type: "eval" | "content" | "ads" | "research" | "strategy" | "custom";
  prompt: string;
  status: "draft" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  selected_scope: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type DatabaseRunEvent = {
  id: string;
  org_id: string;
  run_id: string;
  event_type: string;
  node: string | null;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type DatabaseEvalReport = {
  id: string;
  org_id: string;
  run_id: string | null;
  file_id: string | null;
  score: number;
  findings: unknown[];
  recommendations: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DatabaseChat = {
  id: string;
  org_id: string;
  title: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DatabaseChatMessage = {
  id: string;
  org_id: string;
  chat_id: string;
  role: "system" | "user" | "assistant" | "tool";
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type HarnessFile = {
  id: string;
  orgId: string;
  folderId: string | null;
  fileType: DatabaseFileType;
  status: DatabaseFileStatus;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function toCamel(row: DatabaseFile): HarnessFile {
  return {
    id: row.id,
    orgId: row.org_id,
    folderId: row.folder_id,
    fileType: row.file_type,
    status: row.status,
    title: row.title,
    body: row.body,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createDbClient(url: string, anonKey: string) {
  const supabase = createClient(url, anonKey);

  return {
    supabase,

    // ─── Harness Files ─────────────────────────────────────────

    async listFiles(orgId: string) {
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("org_id", orgId)
        .in("file_type", [
          "strategy", "prompt", "artifact",
          "draft", "evidence", "asset", "eval_report",
          "publish_package", "knowledge", "harness_role",
          "harness_skill", "harness_workstream", "harness_eval",
          "harness_template", "harness_chat_message"
        ])
        .neq("status", "deleted")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data as DatabaseFile[]).map(toCamel);
    },

    async getFile(id: string) {
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return toCamel(data as DatabaseFile);
    },

    async createFile(orgId: string, file: {
      title: string;
      body: string;
      fileType: DatabaseFileType;
      status?: DatabaseFileStatus;
      folderId?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      const { data, error } = await supabase
        .from("files")
        .insert({
          org_id: orgId,
          title: file.title,
          body: file.body,
          file_type: file.fileType,
          status: file.status ?? "draft",
          folder_id: file.folderId ?? null,
          metadata: file.metadata ?? {},
          content_format: "markdown"
        })
        .select()
        .single();
      if (error) throw error;
      return toCamel(data as DatabaseFile);
    },

    async updateFile(id: string, patch: Partial<{
      title: string;
      body: string;
      fileType: DatabaseFileType;
      status: DatabaseFileStatus;
      folderId: string | null;
      metadata: Record<string, unknown>;
    }>) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.title !== undefined) dbPatch.title = patch.title;
      if (patch.body !== undefined) dbPatch.body = patch.body;
      if (patch.fileType !== undefined) dbPatch.file_type = patch.fileType;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.folderId !== undefined) dbPatch.folder_id = patch.folderId;
      if (patch.metadata !== undefined) dbPatch.metadata = patch.metadata;

      const { data, error } = await supabase
        .from("files")
        .update(dbPatch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toCamel(data as DatabaseFile);
    },

    async deleteFile(id: string) {
      const { error } = await supabase
        .from("files")
        .update({ status: "deleted" })
        .eq("id", id);
      if (error) throw error;
    },

    async hardDeleteFile(id: string) {
      const { error } = await supabase.from("files").delete().eq("id", id);
      if (error) throw error;
    },

    // ─── Runs ──────────────────────────────────────────────────

    async createRun(orgId: string, run: {
      runType: DatabaseRun["run_type"];
      prompt: string;
      chatId?: string | null;
    }) {
      const { data, error } = await supabase
        .from("runs")
        .insert({
          org_id: orgId,
          run_type: run.runType,
          prompt: run.prompt,
          status: "draft",
          chat_id: run.chatId ?? null
        })
        .select()
        .single();
      if (error) throw error;
      return data as DatabaseRun;
    },

    async updateRunStatus(id: string, status: DatabaseRun["status"]) {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status, updated_at: now };
      if (status === "completed" || status === "failed") {
        patch.completed_at = now;
      }
      const { error } = await supabase.from("runs").update(patch).eq("id", id);
      if (error) throw error;
    },

    async getRun(id: string) {
      const { data, error } = await supabase
        .from("runs")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as DatabaseRun;
    },

    // ─── Run Events ────────────────────────────────────────────

    async appendEvent(orgId: string, event: {
      runId: string;
      eventType: string;
      node?: string;
      message: string;
      payload?: Record<string, unknown>;
    }) {
      const { data, error } = await supabase
        .from("run_events")
        .insert({
          org_id: orgId,
          run_id: event.runId,
          event_type: event.eventType,
          node: event.node ?? null,
          message: event.message,
          payload: event.payload ?? {}
        })
        .select()
        .single();
      if (error) throw error;
      return data as DatabaseRunEvent;
    },

    async listEvents(runId: string) {
      const { data, error } = await supabase
        .from("run_events")
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as DatabaseRunEvent[];
    },

    // ─── Eval Reports ──────────────────────────────────────────

    async createEvalReport(orgId: string, report: {
      runId: string | null;
      fileId: string | null;
      score: number;
      findings: unknown[];
      recommendations: unknown[];
      metadata?: Record<string, unknown>;
    }) {
      const { data, error } = await supabase
        .from("eval_reports")
        .insert({
          org_id: orgId,
          run_id: report.runId,
          file_id: report.fileId,
          score: report.score,
          findings: report.findings,
          recommendations: report.recommendations,
          metadata: report.metadata ?? {}
        })
        .select()
        .single();
      if (error) throw error;
      return data as DatabaseEvalReport;
    },

    async listEvalReports(orgId: string) {
      const { data, error } = await supabase
        .from("eval_reports")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DatabaseEvalReport[];
    },

    // ─── Folders ───────────────────────────────────────────────

    async listFolders(orgId: string) {
      const { data, error } = await supabase
        .from("folders")
        .select("*")
        .eq("org_id", orgId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as Array<{
        id: string;
        org_id: string;
        parent_id: string | null;
        name: string;
        sort_order: number;
      }>;
    },

    async createFolder(orgId: string, name: string) {
      const { data, error } = await supabase
        .from("folders")
        .insert({ org_id: orgId, name })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // ─── Chats ─────────────────────────────────────────────────

    async createChat(orgId: string, title?: string) {
      const { data, error } = await supabase
        .from("chats")
        .insert({ org_id: orgId, title: title ?? "New chat" })
        .select()
        .single();
      if (error) throw error;
      return data as DatabaseChat;
    },

    async listChats(orgId: string) {
      const { data, error } = await supabase
        .from("chats")
        .select("*")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as DatabaseChat[];
    },

    async deleteChat(id: string) {
      const { error } = await supabase.from("chats").delete().eq("id", id);
      if (error) throw error;
    },

    // ─── Chat Messages ─────────────────────────────────────────

    async appendMessage(chatId: string, orgId: string, message: {
      role: DatabaseChatMessage["role"];
      body: string;
    }) {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          chat_id: chatId,
          org_id: orgId,
          role: message.role,
          body: message.body
        })
        .select()
        .single();
      if (error) throw error;
      return data as DatabaseChatMessage;
    },

    async listMessages(chatId: string) {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as DatabaseChatMessage[];
    },

    // ─── Check & Seed ─────────────────────────────────────────

    async countFiles(orgId: string) {
      const { count, error } = await supabase
        .from("files")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId);
      if (error) throw error;
      return count ?? 0;
    }
  };
}

export type DbClient = ReturnType<typeof createDbClient>;
