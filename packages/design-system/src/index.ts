import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a non-negative integer as a compact token / counter string.
 *
 * Shared formatter so the output budget, context window, tool counter,
 * and any other capacity meter agree on rounding, locale, and the
 * K/M boundary. Use the same formatter in every surface that prints
 * raw token counts.
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return Math.round(value).toLocaleString();
}

export type ThemeId =
  | "monochrome-dark"
  | "monochrome-light"
  | "gruvbox-dark"
  | "gruvbox-light"
  | "blue-dark"
  | "blue-light"
  | "discord-dark"
  | "discord-light"
  | "black-gold-dark"
  | "black-gold-light";

export type ThemeDescriptor = {
  id: ThemeId;
  label: string;
  group: "monochrome" | "gruvbox" | "blue" | "discord" | "black-gold";
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
  { id: "discord-light", label: "Discord Light", group: "discord", mode: "light" },
  { id: "black-gold-dark", label: "Black Gold Dark", group: "black-gold", mode: "dark" },
  { id: "black-gold-light", label: "Black Gold Light", group: "black-gold", mode: "light" }
];

export const DEFAULT_THEME: ThemeId = "gruvbox-dark";

export { SIDEBAR } from "./layout-constants";

export * from "./components/index";
