import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ThemeId = "monochrome-dark" | "monochrome-light" | "gruvbox-dark" | "gruvbox-light";

export type ThemeDescriptor = {
  id: ThemeId;
  label: string;
  group: "monochrome" | "gruvbox" | "custom";
};

export const THEME_REGISTRY: ThemeDescriptor[] = [
  { id: "monochrome-dark", label: "Monochrome Dark", group: "monochrome" },
  { id: "monochrome-light", label: "Monochrome Light", group: "monochrome" },
  { id: "gruvbox-dark", label: "Gruvbox Dark", group: "gruvbox" },
  { id: "gruvbox-light", label: "Gruvbox Light", group: "gruvbox" }
];

export const DEFAULT_THEME: ThemeId = "gruvbox-dark";

export * from "./components/index";
