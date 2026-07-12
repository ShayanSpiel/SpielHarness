"use client";

import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import type { SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@spielos/design-system";
import { MentionDropdown } from "./mention-dropdown";
import { buildObjectReferences, mentionText } from "../lib/object-references";
import { useWorkspaceStore } from "../lib/use-workspace-store";
import type { ObjectReference } from "../lib/object-references";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtml(text: string): string {
  if (text.trim().startsWith("<")) return text;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "<p></p>";
  return paragraphs
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function htmlToText(html: string): string {
  if (!html.trim().startsWith("<")) return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  const blocks: string[] = [];
  for (const child of div.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) blocks.push(text);
    } else if (child instanceof HTMLElement) {
      if (child.tagName === "P" || child.tagName === "DIV") {
        const text = child.textContent?.trim();
        if (text) blocks.push(text);
      } else if (child.tagName === "UL" || child.tagName === "OL") {
        const items = Array.from(child.querySelectorAll("li"))
          .map((li) => li.textContent?.trim())
          .filter(Boolean);
        if (items.length) blocks.push(items.join("\n"));
      } else if (child.tagName === "BLOCKQUOTE") {
        const text = child.textContent?.trim();
        if (text) blocks.push(`> ${text}`);
      } else {
        const text = child.textContent?.trim();
        if (text) blocks.push(text);
      }
    }
  }
  return blocks.join("\n\n");
}

function useMentionSuggestion() {
  const store = useWorkspaceStore();
  const items = useMemo(() => buildObjectReferences(store), [store]);

  return useMemo(
    () => ({
      char: "@",
      items: ({ query }: { query: string }) => {
        const lower = query.toLowerCase();
        if (!lower) return items;
        return items.filter(
          (ref) =>
            ref.title.toLowerCase().includes(lower) ||
            ref.kind.toLowerCase().includes(lower) ||
            ref.subtitle.toLowerCase().includes(lower)
        );
      },
      render: () => {
        let component: ReactRenderer | null = null;

        return {
          onStart: (props: SuggestionProps<ObjectReference, MentionNodeAttrs>) => {
            component = new ReactRenderer(MentionDropdown, {
              props: {
                items: props.items,
                onSelect: (ref: ObjectReference) => {
                  props.command({ id: ref.id, label: ref.title, kind: ref.kind } as MentionNodeAttrs);
                }
              },
              editor: props.editor
            });

            if (props.clientRect) {
              const rect = props.clientRect();
              if (rect) {
                component.element.style.position = "fixed";
                component.element.style.left = `${rect.left}px`;
                component.element.style.top = `${rect.top - 8}px`;
                component.element.style.transform = "translateY(-100%)";
                document.body.appendChild(component.element);
              }
            }
          },
          onUpdate: (props: SuggestionProps<ObjectReference, MentionNodeAttrs>) => {
            component?.updateProps({ items: props.items });
            if (component && props.clientRect) {
              const rect = props.clientRect();
              if (rect) {
                component.element.style.left = `${rect.left}px`;
                component.element.style.top = `${rect.top - 8}px`;
              }
            }
          },
          onKeyDown: (props: { event: KeyboardEvent }) => {
            if (props.event instanceof KeyboardEvent) {
              const key = props.event.key;
              if (key === "Escape") {
                component?.destroy();
                return true;
              }
              if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === "Tab") {
                const dropdownEl = component?.element.querySelector("[role='listbox']");
                if (dropdownEl) {
                  dropdownEl.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
                  return true;
                }
                return false;
              }
            }
            return false;
          },
          onExit: () => {
            component?.destroy();
          }
        };
      },
      allowSpaces: true
    }),
    [items]
  );
}

export function RichEditor({
  value,
  onChange,
  placeholder,
  className,
  mono
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  const lastLoadedValue = useRef(value);
  const suggestion = useMentionSuggestion();

  const editor = useEditor({
    extensions: [
      StarterKit,
      Mention.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            kind: {
              default: null,
              parseHTML: (element) => element.getAttribute("data-kind"),
              renderHTML: (attributes) => {
                if (!attributes.kind) return {};
                return { "data-kind": attributes.kind };
              }
            }
          };
        }
      }).configure({
        HTMLAttributes: {
          class: "mention"
        },
        renderText({ node }) {
          const label = (node.attrs.label as string) ?? (node.attrs.id as string);
          const kind = (node.attrs.kind as string) ?? "file";
          const id = node.attrs.id as string;
          return mentionText({ id, kind: kind as ObjectReference["kind"], title: label, subtitle: "" });
        },
        renderHTML({ node }) {
          const label = (node.attrs.label as string) ?? (node.attrs.id as string);
          const kind = (node.attrs.kind as string) ?? "file";
          const id = node.attrs.id as string;
          return [
            "span",
            { "data-type": "mention", "data-id": id, "data-label": label, "data-kind": kind },
            `@${label}`
          ];
        },
        suggestion
      })
    ],
    content: textToHtml(value),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-full px-6 py-6 text-[13px] leading-6 text-foreground outline-none",
          mono && "font-mono"
        ),
        "data-placeholder": placeholder ?? ""
      }
    },
    immediatelyRender: false,
    onUpdate({ editor: activeEditor }) {
      const html = activeEditor.getHTML();
      lastLoadedValue.current = html;
      onChange(htmlToText(html));
    }
  });

  useEffect(() => {
    if (!editor || value === lastLoadedValue.current) return;
    lastLoadedValue.current = value;
    editor.commands.setContent(textToHtml(value), { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <EditorContent
        className="min-h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror_p]:mb-2 [&_.ProseMirror_.mention]:rounded [&_.ProseMirror_.mention]:bg-selected [&_.ProseMirror_.mention]:px-1 [&_.ProseMirror_.mention]:py-0.5 [&_.ProseMirror_.mention]:text-foreground-strong [&_.ProseMirror_.mention]:font-medium [&_.ProseMirror]:empty:before:content-[attr(data-placeholder)] [&_.ProseMirror]:empty:before:text-muted-foreground"
        editor={editor}
      />
    </div>
  );
}
