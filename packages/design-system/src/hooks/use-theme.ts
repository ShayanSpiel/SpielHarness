"use client";

import { useEffect, useState } from "react";
import { DEFAULT_THEME, type ThemeId, THEME_REGISTRY } from "../index";

const STORAGE_KEY = "spielos.theme";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY)) as
      | ThemeId
      | null;
    if (stored && THEME_REGISTRY.some((entry) => entry.id === stored)) {
      setThemeState(stored);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [ready, theme]);

  return {
    theme,
    setTheme: setThemeState,
    toggle: () =>
      setThemeState((current) => {
        if (current === "monochrome-dark") return "monochrome-light";
        if (current === "monochrome-light") return "gruvbox-dark";
        if (current === "gruvbox-dark") return "gruvbox-light";
        return "monochrome-dark";
      }),
    ready
  };
}
