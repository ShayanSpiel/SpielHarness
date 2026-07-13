"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@spielos/design-system";
import { buildObjectReferences, mentionText, type ObjectReference } from "../lib/object-references";
import { useWorkspaceStore } from "../lib/use-workspace-store";
import { MentionDropdown } from "./mention-dropdown";

export function getTextAroundCursor(value: string, cursorPos: number) {
  const before = value.slice(0, cursorPos);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  const textBeforeAt = before.slice(0, atIndex);
  if (atIndex > 0 && textBeforeAt.slice(-1) !== " " && textBeforeAt.slice(-1) !== "\n" && textBeforeAt.length > 0) {
    return null;
  }
  const query = before.slice(atIndex + 1);
  if (query.includes(" ") && query.split(" ").length > 3) return null;
  return { atIndex, query };
}

function filterItems(items: ObjectReference[], query: string): ObjectReference[] {
  const lower = query.toLowerCase();
  if (!lower) return items;
  return items.filter(
    (ref) =>
      ref.title.toLowerCase().includes(lower) ||
      ref.kind.toLowerCase().includes(lower) ||
      ref.subtitle.toLowerCase().includes(lower)
  );
}

function getCaretCoordinates(textarea: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const mirror = document.createElement("div");
  const style = getComputedStyle(textarea);
  const properties = [
    "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
    "textIndent", "textTransform", "wordSpacing", "whiteSpace",
    "overflowWrap", "overflow", "width", "paddingTop", "paddingRight",
    "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth",
    "borderBottomWidth", "borderLeftWidth", "boxSizing", "tabSize"
  ];
  for (const prop of properties) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop));
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.substring(0, position);
  const sentinel = document.createElement("span");
  sentinel.textContent = "\u200b";
  mirror.appendChild(sentinel);
  document.body.appendChild(mirror);
  const coordinates = {
    top: sentinel.offsetTop - textarea.scrollTop,
    left: sentinel.offsetLeft
  };
  document.body.removeChild(mirror);
  return coordinates;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  density = "editor",
  mono,
  rows,
  onKeyDown,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  density?: "editor" | "field";
  mono?: boolean;
  rows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  [key: string]: unknown;
}) {
  const store = useWorkspaceStore();
  const allItems = useMemo(
    () => buildObjectReferences({
      items: store.items,
      roles: store.roles,
      skills: store.skills,
      evalFiles: store.evalFiles,
      workstreams: store.workflows
    }),
    [store.items, store.roles, store.skills, store.evalFiles, store.workflows]
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [mentionState, setMentionState] = useState<{
    open: boolean;
    query: string;
    atIndex: number;
    top: number;
    left: number;
  }>({ open: false, query: "", atIndex: -1, top: 0, left: 0 });

  const filteredItems = useMemo(() => filterItems(allItems, mentionState.query), [allItems, mentionState.query]);

  const closeMention = useCallback(() => {
    setMentionState((s) => ({ ...s, open: false, query: "", atIndex: -1 }));
  }, []);

  const openMention = useCallback((textarea: HTMLTextAreaElement, cursorPos: number, query: string, atIndex: number) => {
    const coords = getCaretCoordinates(textarea, cursorPos);
    const rect = textarea.getBoundingClientRect();
    const viewportTop = rect.top + coords.top;
    const viewportLeft = rect.left + coords.left;
    const clampedLeft = Math.min(viewportLeft, window.innerWidth - 288 - 16);
    setMentionState({ open: true, query, atIndex, top: viewportTop, left: clampedLeft });
  }, []);

  const insertMention = useCallback(
    (ref: ObjectReference) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const mention = mentionText(ref);
      const before = value.slice(0, mentionState.atIndex);
      const after = value.slice(textarea.selectionStart);
      const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
      const newValue = `${before}${needsSpace ? " " : ""}${mention} ${after}`;
      onChange(newValue);
      closeMention();
      requestAnimationFrame(() => {
        const pos = mentionState.atIndex + (needsSpace ? 1 : 0) + mention.length + 1;
        textarea.setSelectionRange(pos, pos);
        textarea.focus();
      });
    },
    [value, onChange, mentionState.atIndex, closeMention]
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);
      const cursorPos = e.target.selectionStart;
      const state = getTextAroundCursor(newValue, cursorPos);
      if (state) {
        openMention(e.target, cursorPos, state.query, state.atIndex);
      } else {
        closeMention();
      }
    },
    [onChange, closeMention, openMention]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionState.open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const listbox = portalRef.current?.querySelector("[role='listbox']");
          if (listbox) {
            listbox.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, bubbles: true }));
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeMention();
          return;
        }
      }
      onKeyDown?.(e);
    },
    [mentionState.open, closeMention, onKeyDown]
  );

  const handleClick = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const state = getTextAroundCursor(value, cursorPos);
    if (state) {
      openMention(textarea, cursorPos, state.query, state.atIndex);
    } else {
      closeMention();
    }
  }, [value, closeMention, openMention]);

  useEffect(() => {
    if (!mentionState.open) return;
    function handle(e: MouseEvent) {
      const textarea = textareaRef.current;
      const portal = portalRef.current;
      const target = e.target as Node;
      if (textarea && portal && !textarea.contains(target) && !portal.contains(target)) {
        closeMention();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [mentionState.open, closeMention]);

  return (
    <div className={cn("relative", className)}>
      <textarea
        ref={textareaRef}
        className={cn(
          "h-full w-full resize-none border-0 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:pointer-events-none disabled:bg-[var(--disabled-surface)] disabled:text-[var(--disabled-foreground)]",
          density === "editor"
            ? "bg-background px-6 py-6 leading-6"
            : "min-h-8 bg-transparent px-3 py-2 leading-relaxed",
          mono && "font-mono"
        )}
        disabled={disabled}
        onClick={handleClick}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        value={value}
        {...rest}
      />
      {mentionState.open && createPortal(
        <div
          ref={portalRef}
          className="fixed z-50"
          style={{ top: mentionState.top, left: mentionState.left }}
        >
          <MentionDropdown
            items={filteredItems}
            onSelect={insertMention}
            searchQuery={mentionState.query}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
