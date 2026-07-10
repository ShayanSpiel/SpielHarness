import type { Artifact, Role, RunEvent } from "@spielos/core";

export type { Role };

export type WorkspaceKind =
  | "strategy"
  | "knowledge"
  | "roles"
  | "workstreams"
  | "library"
  | "tools"
  | "prompts";

export type SkillDefinition = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: "search" | "retrieval" | "generation" | "evaluation" | "publishing" | "custom";
  status: "active" | "draft" | "archived";
  auth: "none" | "api_key" | "oauth";
  sideEffect: "none" | "read" | "write" | "external";
  inputSchema: string;
  outputSchema: string;
  implementation: string;
  evalRubrics?: EvalRubric[];
  overallThreshold?: number;
  updatedAt: string;
};

export type EvalRubric = {
  id: string;
  label: string;
  description: string;
  type: "contains" | "missing" | "min_words" | "max_words" | "regex" | "llm_judge";
  value: string;
  weight: number;
  passThreshold: number;
};

export type EvalTargetType = "prompt" | "workflow" | "skill" | "role" | "draft";

export type EvalFile = {
  id: string;
  name: string;
  description: string;
  targetType: EvalTargetType;
  targetId: string;
  rubrics: EvalRubric[];
  overallThreshold: number;
  loopConfig: {
    enabled: boolean;
    maxAttempts: number;
    breakCondition: "on_pass" | "on_fail";
    retryDelayMs: number;
  };
  status: "active" | "draft" | "archived";
  results: EvalFileResult[];
  updatedAt: string;
};

export type EvalFileResult = {
  id: string;
  evalId: string;
  runAt: string;
  targetContent: string;
  rubricScores: Record<string, { score: number; passed: boolean; notes: string }>;
  overallScore: number;
  passed: boolean;
  findings: Array<{ label: string; score: number; notes: string }>;
  recommendations: string[];
};

export type LoopConfig = {
  enabled: boolean;
  maxAttempts: number;
  breakCondition: "on_pass" | "on_fail";
  evalId: string | null;
  retryDelayMs: number;
};

export type WorkstreamNode = {
  id: string;
  roleId: string;
  title: string;
  x: number;
  y: number;
  prompt: string;
  skillIds: string[];
  fileIds: string[];
  input: string;
  output: string;
  loopConfig?: LoopConfig;
};

export type WorkstreamEdge = {
  id: string;
  source: string;
  target: string;
};

export type WorkstreamDefinition = {
  id: string;
  title: string;
  description: string;
  status: "active" | "draft" | "archived";
  nodes: WorkstreamNode[];
  edges: WorkstreamEdge[];
  updatedAt: string;
};

export type EvalRule = {
  id: string;
  label: string;
  type: "contains" | "missing" | "max_words" | "min_words";
  value: string;
  weight: number;
};

export type EvalCase = {
  id: string;
  input: string;
  expected: string;
  variantA: string;
  variantB: string;
};

export type EvalSuite = {
  id: string;
  title: string;
  description: string;
  status: "active" | "draft" | "archived";
  rules: EvalRule[];
  cases: EvalCase[];
  updatedAt: string;
};

export type WorkspaceItem = {
  id: string;
  kind: WorkspaceKind;
  title: string;
  body: string;
  folder?: string;
  status: "active" | "draft" | "archived";
  metadata: Record<string, string>;
  updatedAt: string;
};

export type ProviderModel = {
  id: string;
  provider: string;
  label: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageIds: string[];
  artifactIds: string[];
  activeRoleIds: string[];
  toolId: string | null;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt: string;
  artifactRefs: string[];
};

export type WorkspaceState = {
  items: WorkspaceItem[];
  roles: Role[];
  skills: SkillDefinition[];
  workstreams: WorkstreamDefinition[];
  evalSuites: EvalSuite[];
  evalFiles: EvalFile[];
  models: ProviderModel[];
  libraryFolders: string[];
  chats: Chat[];
  messages: Record<string, ChatMessage[]>;
  artifacts: Artifact[];
  events: Record<string, RunEvent[]>;
  activeChatId: string | null;
  inspectorOpen: boolean;
  inspectorWidth: number;
};

export const DEFAULT_LIBRARY_FOLDERS = [
  "Sessions",
  "Notes",
  "Evidence",
  "Drafts",
  "Content",
  "Assets",
  "Published",
  "Learnings"
];

export const initialWorkspaceState: WorkspaceState = {
  roles: [],
  skills: [],
  workstreams: [],
  evalSuites: [],
  evalFiles: [],
  models: [
    {
      id: "mistral-large",
      provider: "Mistral",
      label: "Mistral Large",
      model: "mistral-large-latest",
      enabled: true
    }
  ],
  items: [],
  libraryFolders: DEFAULT_LIBRARY_FOLDERS,
  chats: [],
  messages: {},
  artifacts: [],
  events: {},
  activeChatId: null,
  inspectorOpen: false,
  inspectorWidth: 360
};
