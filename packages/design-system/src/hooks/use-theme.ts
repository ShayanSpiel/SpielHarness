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

  const currentDescriptor = THEME_REGISTRY.find((t) => t.id === theme);
  const isDark = currentDescriptor?.mode === "dark";

  function toggle() {
    setThemeState((current) => {
      const idx = THEME_REGISTRY.findIndex((t) => t.id === current);
      const next = (idx + 1) % THEME_REGISTRY.length;
      return THEME_REGISTRY[next].id;
    });
  }

  return {
    theme,
    setTheme: setThemeState,
    toggle,
    isDark,
    ready
  };
}
