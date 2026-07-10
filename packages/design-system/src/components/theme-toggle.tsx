"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <Tooltip content={isDark ? "Switch to light" : "Switch to dark"} side="right">
      <Button aria-label="Toggle theme" onClick={toggle} size="icon" variant="ghost">
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </Tooltip>
  );
}
