"use client";

import { useMemo } from "react";
import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from "@assistant-ui/react";
import { buildObjectReferences, type ObjectReference, type ObjectReferenceKind } from "../../lib/object-references";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import { ENTITY_ICONS } from "@spielos/design-system/components";

const KIND_TO_TYPE: Record<ObjectReferenceKind, string> = {
  role: "role",
  skill: "skill",
  eval: "eval",
  workflow: "workflow",
  file: "file",
  prompt: "prompt"
};

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  role: { label: "Roles", icon: ENTITY_ICONS.role },
  skill: { label: "Skills", icon: ENTITY_ICONS.skill },
  eval: { label: "Evals", icon: ENTITY_ICONS.eval },
  workflow: { label: "Workflows", icon: ENTITY_ICONS.workflow },
  file: { label: "Files", icon: ENTITY_ICONS.file },
  prompt: { label: "Prompts", icon: ENTITY_ICONS.prompt }
};

export function useChatMentionAdapter() {
  const store = useWorkspaceStore();
  const references = useMemo(() => buildObjectReferences(store), [store]);

  const categories = useMemo(() => {
    const kinds = new Set<string>(references.map((r: ObjectReference) => r.kind));
    return Array.from(kinds).map((kind: string) => ({
      id: kind,
      label: CATEGORY_META[kind]?.label ?? kind
    }));
  }, [references]);

  const categoryItems = useMemo(() => {
    const byKind = new Map<string, ObjectReference[]>();
    for (const ref of references) {
      const list = byKind.get(ref.kind) ?? [];
      list.push(ref);
      byKind.set(ref.kind, list);
    }
    return (categoryId: string) =>
      (byKind.get(categoryId) ?? []).map((ref: ObjectReference) => ({
        id: ref.id,
        type: KIND_TO_TYPE[ref.kind],
        label: ref.title,
        metadata: { kind: ref.kind, subtitle: ref.subtitle }
      }));
  }, [references]);

  return useMemo(
    () => ({
      categories: () => categories,
      categoryItems,
      search: (query: string) => {
        const lower = query.toLowerCase();
        return references
          .filter(
            (ref: ObjectReference) =>
              ref.title.toLowerCase().includes(lower) ||
              ref.kind.toLowerCase().includes(lower) ||
              ref.subtitle.toLowerCase().includes(lower)
          )
          .map((ref: ObjectReference) => ({
            id: ref.id,
            type: KIND_TO_TYPE[ref.kind],
            label: ref.title,
            metadata: { kind: ref.kind, subtitle: ref.subtitle }
          }));
      }
    }),
    [categories, categoryItems, references]
  );
}

export const spielosDirectiveFormatter: Unstable_DirectiveFormatter = {
  serialize(item) {
    const kind = (item.metadata?.kind as string) ?? item.type;
    return `@[${item.label}](spielos://${kind}/${item.id})`;
  },
  parse(text: string): Unstable_DirectiveSegment[] {
    const segments: Unstable_DirectiveSegment[] = [];
    const regex = /@\[([^\]]+)\]\(spielos:\/\/(\w+)\/([^)]+)\)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
      }
      segments.push({
        kind: "mention",
        type: match[2],
        label: match[1],
        id: match[3]
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      segments.push({ kind: "text", text: text.slice(lastIndex) });
    }

    return segments;
  }
};
