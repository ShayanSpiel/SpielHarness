"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { Button, Tooltip } from "@spielos/design-system";
import { Icon } from "./icons";

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
  const lastLoadedValue = useRef(value);
  const editor = useEditor({
    extensions: [StarterKit],
    content: bodyToHtml(value),
    editorProps: {
      attributes: {
        class: "min-h-full px-6 py-6 text-[15px] leading-7 text-foreground outline-none"
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
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-raised px-2">
        <EditorButton
          active={editor?.isActive("heading", { level: 1 }) ?? false}
          disabled={!editor}
          label="Heading 1"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Icon name="heading-1" size={14} />
        </EditorButton>
        <EditorButton
          active={editor?.isActive("heading", { level: 2 }) ?? false}
          disabled={!editor}
          label="Heading 2"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Icon name="heading-2" size={14} />
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
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent
          aria-label="Document body"
          className="min-h-full [&_.ProseMirror]:min-h-[calc(100vh-210px)] [&_.ProseMirror_h1]:mb-4 [&_.ProseMirror_h1]:text-3xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_p]:mb-4 [&_.ProseMirror_ul]:mb-4 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border-strong [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:text-muted-foreground"
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
        size="icon"
        type="button"
        variant="ghost"
      >
        {children}
      </Button>
    </Tooltip>
  );
}
