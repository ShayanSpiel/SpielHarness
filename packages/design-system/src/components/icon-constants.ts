export const ENTITY_ICONS = {
  run: "play",
  knowledge: "brain",
  skill: "reading-glass",
  role: "users",
  eval: "bar-chart",
  workflow: "workflow-alt",
  prompt: "prompt",
  file: "file",
  strategy: "strategy",
  settings: "settings",
} as const;

export const ACTION_ICONS = {
  save: "save",
  add: "plus",
  delete: "trash",
  edit: "pencil",
  search: "search",
  refresh: "refresh",
  close: "x",
  check: "check",
  back: "arrow-left",
  forward: "arrow-right",
  more: "more",
  copy: "copy",
  download: "download",
  upload: "upload",
  filter: "filter",
  loader: "loader",
} as const;

export const EVENT_ICONS = {
  run_completed: "check",
  run_failed: "x",
  run_cancelled: "x",
  node_started: "circle-dot",
  node_status: "circle-dot",
  skill_started: "circle-dot",
  node_completed: "check",
  skill_completed: "check",
  artifact_created: "file-text",
  eval_score_updated: "bar-chart",
  human_input_requested: "user",
  human_input_received: "check-circle",
} as const;

export const CONTEXT_KIND_ICONS: Record<string, string> = {
  role: ENTITY_ICONS.role,
  tool: ENTITY_ICONS.skill,
  library: "archive",
  workstream: ENTITY_ICONS.workflow,
  strategy: "file-text",
  knowledge: ENTITY_ICONS.knowledge,
  prompt: ENTITY_ICONS.prompt,
  eval: ENTITY_ICONS.eval,
};

export const MENTION_KIND_ICONS: Record<string, string> = {
  role: ENTITY_ICONS.role,
  skill: ENTITY_ICONS.skill,
  eval: ENTITY_ICONS.eval,
  workflow: ENTITY_ICONS.workflow,
  file: ENTITY_ICONS.file,
  prompt: ENTITY_ICONS.prompt,
};

export const SETTINGS_TAB_ICONS: Record<string, string> = {
  models: "server",
  integrations: "tool",
  theme: "sun",
  workspace: "database",
};
