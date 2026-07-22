"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Tooltip, cn } from "@spielos/design-system";
import { ThemeToggle } from "@spielos/design-system/components/theme-toggle";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { SIDEBAR } from "@spielos/design-system";
import { UserMenu } from "./user-menu";
import { useRuntimeStore } from "../lib/runtime-store";

type NavEntry = {
  href: string;
  label: string;
  icon: string;
  match: (pathname: string) => boolean;
};

const sections: Array<{
  id: "runtime" | "files" | "context";
  label: string;
  markerClass: string;
  activeClass: string;
  items: NavEntry[];
}> = [
  {
    id: "runtime",
    label: "Runtime",
    markerClass: "bg-info",
    activeClass: "bg-selected text-info",
    items: [
      { href: "/", label: "New Run", icon: ENTITY_ICONS.run, match: (p) => p === "/" },
    ],
  },
  {
    id: "files",
    label: "Files",
    markerClass: "bg-accent",
    activeClass: "bg-selected text-accent",
    items: [
      { href: "/knowledge", label: "Files", icon: ENTITY_ICONS.knowledge, match: (p) => p.startsWith("/knowledge") },
      { href: "/strategy", label: "Strategy", icon: ENTITY_ICONS.strategy, match: (p) => p.startsWith("/strategy") || p.startsWith("/prompts") },
    ],
  },
  {
    id: "context",
    label: "Context",
    markerClass: "bg-purple",
    activeClass: "bg-selected text-purple",
    items: [
      { href: "/roles", label: "Roles", icon: ENTITY_ICONS.role, match: (p) => p.startsWith("/roles") },
      { href: "/workflows", label: "Workflows", icon: ENTITY_ICONS.workflow, match: (p) => p.startsWith("/workflows") },
      { href: "/evals", label: "Evals", icon: ENTITY_ICONS.eval, match: (p) => p.startsWith("/evals") },
      { href: "/skills", label: "Skills", icon: ENTITY_ICONS.skill, match: (p) => p.startsWith("/skills") },
    ],
  },
];

export function NavRail({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();

  return (
    <aside className={cn("flex h-full shrink-0 flex-col items-center gap-1 border-e border-border bg-panel py-2", SIDEBAR.NAV_RAIL_WIDTH)}>
      <Tooltip content="SpielOS" side="right">
        <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-foreground-strong">
          <Icon name="box" size={16} />
        </div>
      </Tooltip>

      <UserMenu />

      <Tooltip content="Search (⌘K)" side="right">
        <Button aria-label="Search" onClick={onOpenSearch} size="icon" variant="ghost">
          <Icon name="search" size={16} />
        </Button>
      </Tooltip>

      <div className="my-1 h-px w-6 bg-border" />

      {sections.map((section, sectionIndex) => (
        <div aria-label={section.label} className="flex flex-col items-center gap-1" key={section.id} role="group">
          {sectionIndex > 0 ? (
            <div className="flex h-2 w-6 items-center justify-center" aria-hidden>
              <span className={cn("h-0.5 w-2 rounded-full opacity-70", section.markerClass)} />
            </div>
          ) : null}
          {section.items.map((item) => {
            const active = item.match(pathname);
            return (
              <Tooltip content={item.label} key={item.href} side="right">
                <Link
                  aria-label={item.label}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration)] hover:bg-hover hover:text-foreground",
                    active && section.activeClass
                  )}
                  href={item.href}
                  onClick={item.href === "/" ? () => useRuntimeStore.getState().startNewChat() : undefined}
                >
                  <Icon name={item.icon} size={16} />
                </Link>
              </Tooltip>
            );
          })}
        </div>
      ))}

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
