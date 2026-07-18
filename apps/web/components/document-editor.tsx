"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { useEffect, useMemo, useRef } from "react";
import { Button, Tooltip } from "@spielos/design-system";
import { Icon } from "@spielos/design-system/components";
import type { SuggestionProps } from "@tiptap/suggestion";
import { MentionDropdown } from "./mention-dropdown";
import { buildObjectReferences, mentionText } from "../lib/object-references";
import { useWorkspaceStore } from "../lib/use-workspace-store";
import type { ObjectReference } from "../lib/object-references";
import { ReactRenderer } from "@tiptap/react";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bodyToHtml(value: string) {
  if (value.trim().startsWith("<")) return value;
  const paragraphs = value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "<p></p>";
  return paragraphs
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function DocumentEditor({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const store = useWorkspaceStore();
  const lastLoadedValue = useRef(value);
  const items = useMemo(
    () => buildObjectReferences({
      items: store.items,
      roles: store.roles,
      skills: store.skills,
      evalFiles: store.evalFiles,
      workstreams: store.workflows
    }),
    [store.items, store.roles, store.skills, store.evalFiles, store.workflows]
  );

  const suggestion = useMemo(
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
            {
              "data-type": "mention",
              "data-id": id,
              "data-label": label,
              "data-kind": kind
            },
            `@${label}`
          ];
        },
        suggestion
      })
    ],
    content: bodyToHtml(value),
    editorProps: {
      attributes: {
        class: "min-h-full px-6 py-6 text-editor leading-7 text-foreground outline-none"
      }
    },
    immediatelyRender: false,
    onUpdate({ editor: activeEditor }) {
      const html = activeEditor.getHTML();
      lastLoadedValue.current = html;
      onChange(html);
    }
  });

  useEffect(() => {
    if (!editor || value === lastLoadedValue.current) return;
    lastLoadedValue.current = value;
    editor.commands.setContent(bodyToHtml(value), { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-panel-raised px-2">
        <EditorButton
          active={editor?.isActive("heading", { level: 1 }) ?? false}
          disabled={!editor}
          label="Heading 1"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <span className="font-mono text-3xs font-semibold">H1</span>
        </EditorButton>
        <EditorButton
          active={editor?.isActive("heading", { level: 2 }) ?? false}
          disabled={!editor}
          label="Heading 2"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <span className="font-mono text-3xs font-semibold">H2</span>
        </EditorButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <EditorButton
          active={editor?.isActive("bold") ?? false}
          disabled={!editor}
          label="Bold"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Icon name="bold" size={14} />
        </EditorButton>
        <EditorButton
          active={editor?.isActive("italic") ?? false}
          disabled={!editor}
          label="Italic"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Icon name="italic" size={14} />
        </EditorButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <EditorButton
          active={editor?.isActive("bulletList") ?? false}
          disabled={!editor}
          label="Bullet list"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <Icon name="list" size={14} />
        </EditorButton>
        <EditorButton
          active={editor?.isActive("blockquote") ?? false}
          disabled={!editor}
          label="Quote"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Icon name="quote" size={14} />
        </EditorButton>
        <span className="ms-auto shrink-0 text-3xs text-muted-foreground select-none">
          @ to mention
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent
          aria-label="Document body"
          className="min-h-full [&_.ProseMirror]:min-h-[calc(100vh-210px)] [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_p]:mb-4 [&_.ProseMirror_ul]:mb-4 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:ps-6 [&_.ProseMirror_blockquote]:border-s-2 [&_.ProseMirror_blockquote]:border-border-strong [&_.ProseMirror_blockquote]:ps-4 [&_.ProseMirror_blockquote]:text-muted-foreground [&_.ProseMirror_.mention]:rounded-sm [&_.ProseMirror_.mention]:bg-selected [&_.ProseMirror_.mention]:px-1 [&_.ProseMirror_.mention]:py-0.5 [&_.ProseMirror_.mention]:text-foreground-strong [&_.ProseMirror_.mention]:font-medium"
          editor={editor}
        />
      </div>
    </div>
  );
}

function EditorButton({
  active,
  children,
  disabled,
  label,
  onClick
}: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <Button
        aria-label={label}
        className={active ? "bg-selected text-foreground-strong" : undefined}
        disabled={disabled}
        onClick={onClick}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {children}
      </Button>
    </Tooltip>
  );
}
