"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { type ReactNode } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

const listItemStyles = cva(
  "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-start transition-colors duration-[var(--duration)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
  {
    variants: {
      active: {
        true: "bg-selected text-foreground-strong",
        false: "hover:bg-hover",
      },
    },
    defaultVariants: { active: false },
  }
);

export interface ListItemProps extends VariantProps<typeof listItemStyles> {
  title: string;
  subtitle?: string;
  icon?: string;
  metadata?: ReactNode;
  description?: string;
  footnotes?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ListItem({
  title,
  subtitle,
  icon,
  active,
  metadata,
  description,
  footnotes,
  onClick,
  className,
}: ListItemProps) {
  return (
    <li>
      <button
        className={cn(listItemStyles({ active }), className)}
        onClick={onClick}
        type="button"
      >
        {icon ? (
          <Icon
            name={icon}
            size={14}
            className="mt-0.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {title}
            </span>
            {subtitle ? (
              <span className="truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
            {metadata ? (
              <span className="ms-auto shrink-0">{metadata}</span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
          {footnotes ? (
            <div className="mt-1.5 flex items-center gap-2 text-3xs text-muted-foreground">
              {footnotes}
            </div>
          ) : null}
        </div>
      </button>
    </li>
  );
}
