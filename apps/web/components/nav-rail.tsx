"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Tooltip, cn } from "@spielos/design-system";
import { ThemeToggle } from "@spielos/design-system/components/theme-toggle";
import { Icon } from "./icons";

type NavEntry = {
  href: string;
  label: string;
  icon: string;
  match: (pathname: string) => boolean;
};

const sections: NavEntry[] = [
  { href: "/", label: "Runs", icon: "play", match: (p) => p === "/" },
  { href: "/knowledge", label: "Knowledge", icon: "brain", match: (p) => p.startsWith("/knowledge") },
  { href: "/strategy", label: "Strategy", icon: "file-text", match: (p) => p.startsWith("/strategy") || p.startsWith("/prompts") },
  { href: "/roles", label: "Roles", icon: "users", match: (p) => p.startsWith("/roles") },
  { href: "/workstreams", label: "Workstreams", icon: "folder-kanban", match: (p) => p.startsWith("/workstreams") },
  { href: "/evals", label: "Evals", icon: "bar-chart", match: (p) => p.startsWith("/evals") },
  { href: "/tools", label: "Skills", icon: "sparkles", match: (p) => p.startsWith("/tools") }
];

export function NavRail({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2">
      <Tooltip content="SpielOS" side="right">
        <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-foreground-strong">
          <Icon name="box" size={16} />
        </div>
      </Tooltip>

      <Tooltip content="Search (⌘K)" side="right">
        <Button aria-label="Search" onClick={onOpenSearch} size="icon" variant="ghost">
          <Icon name="search" size={16} />
        </Button>
      </Tooltip>

      <div className="my-1 h-px w-6 bg-border" />

      {sections.map((item) => {
        const active = item.match(pathname);
        return (
          <Tooltip content={item.label} key={item.href} side="right">
            <Link
              aria-label={item.label}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration)] hover:bg-hover hover:text-foreground",
                active && "bg-selected text-foreground-strong"
              )}
              href={item.href}
            >
              <Icon name={item.icon} size={16} />
            </Link>
          </Tooltip>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-1">
        <ThemeToggle />
        <Tooltip content="Settings" side="right">
          <Link
            aria-label="Settings"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
              pathname.startsWith("/settings") && "bg-selected text-foreground-strong"
            )}
            href="/settings"
          >
            <Icon name="settings" size={16} />
          </Link>
        </Tooltip>
      </div>
    </aside>
  );
}
