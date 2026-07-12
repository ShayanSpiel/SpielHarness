import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ThemeId =
  | "monochrome-dark"
  | "monochrome-light"
  | "gruvbox-dark"
  | "gruvbox-light"
  | "blue-dark"
  | "blue-light"
  | "discord-dark"
  | "discord-light";

export type ThemeDescriptor = {
  id: ThemeId;
  label: string;
  group: "monochrome" | "gruvbox" | "blue" | "discord";
  mode: "dark" | "light";
};

export const THEME_REGISTRY: ThemeDescriptor[] = [
  { id: "monochrome-dark", label: "Monochrome Dark", group: "monochrome", mode: "dark" },
  { id: "monochrome-light", label: "Monochrome Light", group: "monochrome", mode: "light" },
  { id: "gruvbox-dark", label: "Gruvbox Dark", group: "gruvbox", mode: "dark" },
  { id: "gruvbox-light", label: "Gruvbox Light", group: "gruvbox", mode: "light" },
  { id: "blue-dark", label: "Blue Dark", group: "blue", mode: "dark" },
  { id: "blue-light", label: "Blue Light", group: "blue", mode: "light" },
  { id: "discord-dark", label: "Discord Dark", group: "discord", mode: "dark" },
  { id: "discord-light", label: "Discord Light", group: "discord", mode: "light" }
];

export const DEFAULT_THEME: ThemeId = "gruvbox-dark";

export { SIDEBAR } from "./layout-constants";

export * from "./components/index";
