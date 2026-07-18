"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

const DEFAULT_ICON_MAP: Record<string, string> = {
  search: "SearchAlt",
  plus: "Plus",
  trash: "TrashAlt",
  save: "Save",
  check: "Check",
  x: "X",
  close: "X",
  settings: "Cog",
  filter: "Filter",
  edit: "Pencil",
  copy: "Copy",
  refresh: "RefreshCw",
  "refresh-ccw": "RefreshCcw",
  loader: "LoaderDots",
  more: "DotsHorizontalRounded",
  download: "ArrowToBottom",
  upload: "ArrowToTop",
  "arrow-up": "ArrowUp",
  "arrow-down": "ArrowDown",
  "arrow-left": "ArrowBigLeft",
  "arrow-right": "ArrowRight",
  "chevron-up": "ChevronUp",
  "chevron-down": "ChevronDown",
  "chevron-left": "ChevronLeft",
  "chevron-right": "ChevronRight",
  file: "File",
  "file-text": "File",
  "file-code": "FileCode",
  "file-detail": "FileDetail",
  folder: "Folder",
  "folder-plus": "FolderPlus",
  image: "Image",
  video: "Video",
  music: "Music",
  link: "LinkAlt",
  mail: "Envelope",
  message: "MessageBubbleCaptions",
  "message-square": "MessageBubbleCaptions",
  "message-code": "MessageBubbleCode",
  send: "Send",
  bell: "Bell",
  user: "User",
  users: "Group",
  "user-plus": "UserPlus",
  "user-minus": "UserX",
  box: "Box",
  boxes: "Cuboid",
  circle: "Circle",
  "circle-dot": "RadioCircle",
  square: "Square",
  triangle: "Triangle",
  "check-circle": "CheckCircle",
  "alert-circle": "AlertCircle",
  "alert-triangle": "AlertTriangle",
  info: "InfoCircle",
  alert: "AlertCircle",
  "x-circle": "XCircle",
  "panel-right-open": "DockRightAlt",
  "panel-right-close": "DockRight",
  layout: "Layout",
  "layout-list": "ListUl",
  code: "CodeAlt",
  terminal: "Terminal",
  "git-branch": "WorkflowAlt",
  "git-commit": "GitCommit",
  "git-merge": "GitMerge",
  package: "Package",
  database: "Database",
  server: "Server",
  play: "Play",
  pause: "Pause",
  stop: "StopCircle",
  eye: "Eye",
  "eye-off": "EyeClosed",
  maximize: "ExpandLeft",
  minimize: "ShrinkLeft",
  "zoom-in": "SearchPlus",
  "zoom-out": "SearchMinus",
  grid: "Grid",
  list: "ListUl",
  columns: "Columns",
  rows: "Menu",
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  text: "FontColor",
  quote: "QuoteLeft",
  "list-ordered": "ListOl",
  "list-unordered": "ListUl",
  heart: "Heart",
  star: "Star",
  bookmark: "BookmarkAlt",
  share: "Share",
  lock: "Lock",
  unlock: "LockOpen",
  shield: "ShieldAlt2",
  wrench: "Slider",
  tool: "SliderAlt",
  magic: "MagicWand",
  "reading-glass": "ReadingGlass",
  sparkles: "Search",
  zap: "Bolt",
  sun: "Sun",
  moon: "Moon",
  cloud: "Cloud",
  clock: "Timer",
  repeat: "Repeat",
  calendar: "Calendar",
  map: "MapIcon",
  pin: "Pin",
  flag: "Flag",
  tag: "TagAlt",
  hash: "Hashtag",
  at: "At",
  globe: "GlobeAlt",
  compass: "Compass",
  home: "HomeAlt",
  inbox: "Inbox",
  archive: "ArchiveAlt",
  history: "History",
  "external-link": "LinkAlt",
  activity: "TrendingUp",
  layers: "Layers",
  "layers-down-right": "LayersDownRight",
  "grip-vertical": "Move",
  move: "Move",
  brain: "Brain",
  "workflow-alt": "WorkflowAlt",
  wand: "MagicWand",
  flask: "Flask",
  "medical-flask": "MedicalFlask",
  "square-terminal": "Terminal",
  "bar-chart": "BarChart",
  pencil: "Pencil",
  bot: "Robot",
  "loader-2": "LoaderDots",
  knowledge: "Cognition",
  strategy: "Strategy",
  prompt: "MessageBubbleCode",
  "prompt-json": "FileCode",
  "prompt-folder": "FileDetail",
  key: "Key",
  community: "Community",
  task: "Task",
  psychology: "Psychology",
  intellect: "Intellect",
  head: "Head",
};

const INITIAL_ICON_MAP: Record<string, string> = { ...DEFAULT_ICON_MAP };

interface IconRegistryContextType {
  icons: Record<string, string>;
  setIcon: (name: string, icon: string) => void;
  setIcons: (icons: Record<string, string>) => void;
  resetIcons: () => void;
}

const IconRegistryContext = createContext<IconRegistryContextType | null>(null);

export function IconRegistryProvider({
  children,
  icons: customIcons
}: {
  children: ReactNode;
  icons?: Record<string, string>;
}) {
  const [iconMap, setIconMap] = useState<Record<string, string>>({
    ...DEFAULT_ICON_MAP,
    ...customIcons
  });

  const setIcon = useCallback((name: string, icon: string) => {
    setIconMap((prev) => ({ ...prev, [name]: icon }));
  }, []);

  const setIcons = useCallback((newIcons: Record<string, string>) => {
    setIconMap((prev) => ({ ...prev, ...newIcons }));
  }, []);

  const resetIcons = useCallback(() => {
    setIconMap({ ...DEFAULT_ICON_MAP });
  }, []);

  return (
    <IconRegistryContext.Provider value={{ icons: iconMap, setIcon, setIcons, resetIcons }}>
      {children}
    </IconRegistryContext.Provider>
  );
}

export function useIconRegistry() {
  const context = useContext(IconRegistryContext);
  if (!context) {
    return {
      icons: DEFAULT_ICON_MAP,
      setIcon: () => {},
      setIcons: () => {},
      resetIcons: () => {}
    };
  }
  return context;
}

export const iconRegistry = {
  icons: DEFAULT_ICON_MAP,
  setIcon: (name: string, icon: string) => {
    DEFAULT_ICON_MAP[name] = icon;
  },
  setIcons: (newIcons: Record<string, string>) => {
    Object.assign(DEFAULT_ICON_MAP, newIcons);
  },
  resetIcons: () => {
    Object.keys(DEFAULT_ICON_MAP).forEach((key) => {
      delete DEFAULT_ICON_MAP[key];
    });
    Object.assign(DEFAULT_ICON_MAP, INITIAL_ICON_MAP);
  }
};
