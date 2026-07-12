"use client";

import { useTheme } from "../hooks/use-theme";
import { Button } from "./button";
import { Icon } from "./icons";
import { Tooltip } from "./tooltip";

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <Tooltip content={isDark ? "Switch to light" : "Switch to dark"} side="right">
      <Button aria-label="Toggle theme" onClick={toggle} size="icon" variant="ghost">
        <Icon name={isDark ? "sun" : "moon"} size={16} />
      </Button>
    </Tooltip>
  );
}
