"use client";

import { useMemo, useState, useEffect, useCallback, type KeyboardEvent } from "react";
import { Button, ConfirmDialog, EmptyState, Field, Input, Inspector, InspectorBody, InspectorEmptyState, InspectorHeader, InspectorSection, ListItem, NativeSelect, PageHeader, Pill, ToggleRow, Textarea, Tooltip, cn, toast } from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { AppShell } from "../../components/app-shell";
import { SidebarListPanel } from "../../components/sidebar-list-panel";
import { MentionTextarea } from "../../components/mention-textarea";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { EvalRule } from "@spielos/core";

type EvalFileResult = {
  id: string;
  evalId: string;
  runAt: string;
  targetContent: string;
  rubricScores: Record<string, { score: number; passed: boolean; notes: string }>;
  overallScore: number;
  passed: boolean;
  findings: Array<{ label: string; score: number; notes: string }>;
  recommendations: string[];
};

type Rubric = EvalRule & {
  description: string;
};

type DraftEval = {
  name: string;
  description: string;
  rules: Rubric[];
  overallThreshold: number;
  loopConfig: {
    enabled: boolean;
    maxAttempts: number;
    breakCondition: "on_pass" | "on_fail";
    retryDelayMs: number;
    evalId: string | null;
  };
  status: "draft" | "active" | "archived" | "deleted";
};

function toRubric(rule: EvalRule): Rubric {
  return { ...rule, description: "" };
}

function fromStore(ef: import("../../lib/workspace-data").EvalFile): DraftEval {
  return {
    name: ef.name,
    description: ef.description,
    rules: ef.rules.map(toRubric),
    overallThreshold: ef.overallThreshold,
    loopConfig: ef.loopConfig,
    status: ef.status
  };
}

function blankEvalFile(): DraftEval {
  return {
    name: "New Eval",
    description: "Describe what this eval checks for.",
    rules: [] as Rubric[],
    overallThreshold: 70,
    loopConfig: {
      enabled: false,
      maxAttempts: 3,
      breakCondition: "on_pass" as const,
      retryDelayMs: 0,
      evalId: null as string | null
    },
    status: "draft" as const
  };
}

function blankRubric(): Rubric {
  return {
    id: `rubric_${crypto.randomUUID()}`,
    label: "Required signal",
    description: "",
    type: "contains",
    value: "",
    importance: 50
  };
}

const CHECK_TYPES: Record<Rubric["type"], {
  label: string;
  helper: string;
  storyPrefix: string;
  valueLabel: string;
  valueKind: "chips" | "number" | "text" | "textarea";
}> = {
  contains: {
    label: "Contains any of",
    helper: "This rule passes when the output includes at least one of the phrases you list below. If none appear, it fails.",
    storyPrefix: "the output mentions",
    valueLabel: "Accepted phrases",
    valueKind: "chips"
  },
  missing: {
    label: "Must not include",
    helper: "This rule passes when none of the listed phrases appear in the output. If any one shows up, it fails.",
    storyPrefix: "the output avoids",
    valueLabel: "Blocked phrases",
    valueKind: "chips"
  },
  min_words: {
    label: "Minimum words",
    helper: "This rule passes when the output has at least this many words. Shorter outputs fail.",
    storyPrefix: "the output has at least",
    valueLabel: "Minimum",
    valueKind: "number"
  },
  max_words: {
    label: "Maximum words",
    helper: "This rule passes when the output stays under this word count. Longer outputs fail.",
    storyPrefix: "the output stays under",
    valueLabel: "Maximum",
    valueKind: "number"
  },
  regex: {
    label: "Matches pattern",
    helper: "This rule passes when the output matches the regular expression you provide. Useful for checking structure or format.",
    storyPrefix: "the output matches",
    valueLabel: "Pattern",
    valueKind: "text"
  },
  llm_judge: {
    label: "Quality judge",
    helper: "Write a prompt that tells an AI judge what to evaluate. The judge scores the output against your instruction.",
    storyPrefix: "the output satisfies",
    valueLabel: "Judge instruction",
    valueKind: "textarea"
  }
};

const RUBRIC_TYPES = (Object.keys(CHECK_TYPES) as Rubric["type"][]).filter((type) => type !== "llm_judge");

export default function EvalsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.evalFiles[0]?.id ?? null);
  const selected = store.evalFiles.find((ef) => ef.id === selectedId);
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<DraftEval>(
    selected ? fromStore(selected) : blankEvalFile()
  );
  const [query, setQuery] = useState("");
  const [sample, setSample] = useState("Paste content here to test the criteria against.");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [evalResults, setEvalResults] = useState<Record<string, EvalFileResult[]>>({});
  const isNew = selectedId === null;

  useEffect(() => {
    if (!selectedId) return;
    const found = store.evalFiles.find((ef) => ef.id === selectedId);
    if (found) reset(fromStore(found));
  }, [selectedId, store.evalFiles, reset]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.evalFiles;
    return store.evalFiles.filter((ef) =>
      [ef.name, ef.description].some((value) => value.toLowerCase().includes(q))
    );
  }, [query, store.evalFiles]);

  const latestResult = useMemo(() => {
    if (!selectedId) return null;
    const results = evalResults[selectedId];
    if (!results || results.length === 0) return null;
    return results[results.length - 1];
  }, [selectedId, evalResults]);

  function selectFile(ef: import("../../lib/workspace-data").EvalFile) {
    setCreating(false);
    setSelectedId(ef.id);
    reset(fromStore(ef));
  }

  function createFile() {
    setCreating(true);
    setSelectedId(null);
    reset(blankEvalFile());
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = await store.addEvalFile({
          name: draft.name,
          description: draft.description,
          rules: draft.rules,
          overallThreshold: draft.overallThreshold,
          loopConfig: draft.loopConfig,
          status: draft.status
        });
        setSelectedId(created.id);
        reset(fromStore(created));
        setCreating(false);
        toast.success("Eval created");
      } else {
        await store.updateEvalFile(selectedId!, draft);
        markSaved();
        toast.success("Eval saved");
      }
    } catch {
      toast.error("Failed to save eval");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) return;
    const id = selectedId!;
    try {
      await store.deleteEvalFile(id);
      const next = store.evalFiles.find((evalFile) => evalFile.id !== id);
      setCreating(false);
      if (next) selectFile(next);
      else {
        setSelectedId(null);
        reset(blankEvalFile());
      }
      toast.success("Eval deleted");
    } catch {
      toast.error("Failed to delete eval");
    }
  }

  function addRubric() {
    setDraft((current) => ({ ...current, rules: [...current.rules, blankRubric()] }));
  }

  function updateRubric(id: string, patch: Partial<Rubric>) {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((r) => (r.id === id ? { ...r, ...patch } : r))
    }));
  }

  function deleteRubric(id: string) {
    setDraft((current) => ({ ...current, rules: current.rules.filter((r) => r.id !== id) }));
  }

  const appendEvalResult = useCallback((evalId: string, result: EvalFileResult) => {
    setEvalResults((prev) => ({
      ...prev,
      [evalId]: [...(prev[evalId] ?? []), result]
    }));
  }, []);

  async function runEval() {
    if (isNew || draft.rules.length === 0 || draft.status !== "active") return;

    setRunning(true);
    try {
      const response = await fetch("/api/runs/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: sample,
          type: "eval",
          targetId: selectedId,
          contextFileIds: []
        })
      });
      if (!response.ok || !response.body) throw new Error(`Eval run failed: HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const item = JSON.parse(line.slice(6)) as {
            kind: string;
            artifact?: {
              metadata?: {
                result?: {
                  overall: number;
                  findings: Array<{ label: string; score: number; notes: string }>;
                  recommendations: string[];
                };
              };
            };
          };
          const evalResult = item.artifact?.metadata?.result;
          if (item.kind === "artifact" && evalResult) {
            const rubricScores: Record<string, { score: number; passed: boolean; notes: string }> = {};
            for (const finding of evalResult.findings) {
              const rubric = draft.rules.find((r) => r.label === finding.label);
              const threshold = rubric?.importance ?? 50;
              rubricScores[finding.label] = {
                score: finding.score,
                passed: finding.score >= threshold,
                notes: finding.notes
              };
            }
            appendEvalResult(selectedId!, {
              id: `result_${crypto.randomUUID()}`,
              evalId: selectedId!,
              runAt: new Date().toISOString(),
              targetContent: sample,
              rubricScores,
              overallScore: evalResult.overall,
              passed: evalResult.overall >= draft.overallThreshold,
              findings: evalResult.findings,
              recommendations: evalResult.recommendations
            });
          }
        }
      }
    } catch (error) {
      console.warn("Eval run failed:", error);
    } finally {
      setRunning(false);
    }
  }

  function exportJson() {
    if (isNew) return;
    const data = JSON.stringify(draft, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string) as DraftEval;
          const created = await store.addEvalFile({
            name: data.name,
            description: data.description,
            rules: data.rules,
            overallThreshold: data.overallThreshold,
            loopConfig: data.loopConfig,
            status: data.status
          });
          setSelectedId(created.id);
          reset(fromStore(created));
        } catch {
          toast.error("That file is not a valid SpielOS eval JSON export.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  return (
    <AppShell
      inspector={
        <ResultInspector result={latestResult} rules={draft.rules} />
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.eval} size={14} />}
          title="Evals"
        />

        <div className="flex min-h-0 flex-1">
          <SidebarListPanel
            title="Eval Files"
            count={store.evalFiles.length + (creating ? 1 : 0)}
            onNew={createFile}
            newTooltip="New eval file"
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search evals"
          >
            {filtered.length === 0 && !creating ? (
              <EmptyState
                className="py-10"
                description="No eval files match this search."
                title="No matches"
              />
            ) : (
              <ul className="grid gap-1">
                {creating ? (
                  <ListItem
                    active
                    description={draft.description}
                    icon={ENTITY_ICONS.eval}
                    metadata={<Pill tone="info">New</Pill>}
                    onClick={() => undefined}
                    title={draft.name}
                  />
                ) : null}
                {filtered.map((ef) => <ListItem
                  active={ef.id === selectedId}
                  footnotes={<>{ef.rules.length} criteria · overall {ef.overallThreshold} · {(evalResults[ef.id] ?? []).length} runs</>}
                  icon={ENTITY_ICONS.eval}
                  key={ef.id}
                  metadata={<Pill tone={ef.status === "active" ? "success" : "default"}>{ef.status === "active" ? "On" : "Off"}</Pill>}
                  onClick={() => selectFile(ef)}
                  title={ef.name}
                />)}
              </ul>
            )}
          </SidebarListPanel>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>Evals</span>
                <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.name}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>
                  {draft.status === "active" ? "Enabled" : "Disabled"}
                </Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Tooltip content="Export as JSON" side="bottom">
                  <Button
                    aria-label="Export"
                    disabled={isNew}
                    icon="download"
                    onClick={exportJson}
                    size="icon-xs"
                    variant="ghost"
                  />
                </Tooltip>
                <Tooltip content="Import from JSON" side="bottom">
                  <Button aria-label="Import" icon="upload" onClick={importJson} size="icon-xs" variant="ghost" />
                </Tooltip>
                <Button
                  icon={ENTITY_ICONS.eval}
                  loading={running}
                  onClick={runEval}
                  size="md"
                  variant="outline"
                  disabled={isNew || draft.rules.length === 0 || draft.status !== "active"}
                >
                  Test
                </Button>
                {!isNew ? (
                  <Tooltip content="Delete eval" side="bottom">
                    <Button aria-label="Delete eval" icon="trash" onClick={() => setConfirmDelete(true)} size="icon-xs" variant="ghost" />
                  </Tooltip>
                ) : null}
                <Button disabled={!dirty} icon="save" loading={saving} onClick={save} size="md" variant={dirty ? "primary" : "outline"}>
                   Save
                 </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--editor-field-min)),1fr))] items-end gap-3 border-b border-border bg-panel-raised px-4 py-3">
                  <div className="grid gap-1.5">
                    <InfoLabel label="Eval name" info="Give this eval a clear name so you can find it when attaching to workflow steps." />
                    <Input
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      value={draft.name}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <InfoLabel label="Pass score" info="The overall weighted score (0–100) this eval needs to reach to pass. Individual criteria contribute based on their importance." />
                    <Input
                      onChange={(e) => setDraft((d) => ({ ...d, overallThreshold: Number(e.target.value) }))}
                      type="number"
                      min={0}
                      max={100}
                      value={draft.overallThreshold}
                    />
                  </div>
                  <Field label="Enabled">
                    <ToggleRow
                      checked={draft.status === "active"}
                      description={draft.status === "active" ? "On" : "Off"}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          status: checked ? "active" : "draft"
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 px-4 py-3">
                  <Field label="Description">
                    <div className="overflow-hidden rounded-md border border-border bg-input transition-colors focus-within:border-[var(--focus-border)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
                      <MentionTextarea
                        density="field"
                        onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
                        placeholder="Eval description (type @ to mention)"
                        rows={1}
                        value={draft.description}
                      />
                    </div>
                  </Field>

                  <Field label="Test sample">
                    <div className="overflow-hidden rounded-md border border-border bg-input transition-colors focus-within:border-[var(--focus-border)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
                      <div className="flex h-8 items-center gap-2 border-b border-border bg-panel-raised px-2">
                        <span className="text-2xs text-muted-foreground">Paste an output here to test the criteria before using the eval in a workflow.</span>
                        <span className="ml-auto text-3xs text-muted-foreground select-none">@ to mention</span>
                      </div>
                      <MentionTextarea
                        className="min-h-28"
                        density="field"
                        mono
                        onChange={setSample}
                        value={sample}
                      />
                    </div>
                  </Field>
                </div>

                <div className="border-t border-border">
                  <div className="flex h-10 items-center gap-2 border-b border-border px-4">
                    <Icon className="text-muted-foreground" name="list" size={14} />
                    <span className="text-xs font-medium text-foreground">Criteria</span>
                    <Pill className="ml-auto">{draft.rules.length}</Pill>
                    <Button className="ml-1 h-7" onClick={addRubric} size="sm" variant="outline">
                      <Icon name="plus" size={14} />
                      Criterion
                    </Button>
                  </div>
                  <div>
                    {draft.rules.length === 0 ? (
                      <div className="m-4 rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                        No criteria yet. Add one to define what this eval checks for.
                      </div>
                    ) : (
                      <div>
                        <div className="grid gap-1 p-1">
                          {draft.rules.map((rubric, idx) => (
                            <CriteriaRow
                              index={idx}
                              key={rubric.id}
                              onDelete={() => deleteRubric(rubric.id)}
                              onUpdate={(patch) => updateRubric(rubric.id, patch)}
                              rubric={rubric}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-border">
                  <div className="flex h-10 items-center gap-2 border-b border-border px-4">
                    <Icon className="text-muted-foreground" name="repeat" size={14} />
                    <span className="text-xs font-medium text-foreground">Workflow Retry Policy</span>
                    <InfoTip content="When this eval is used as a workflow QA step, retry sends failed work back through the previous step to try again. Direct test runs on this page never retry." />
                    <Pill tone={draft.loopConfig.enabled ? "success" : "default"} className="ml-auto">
                      {draft.loopConfig.enabled ? "Retry enabled" : "No retry"}
                    </Pill>
                  </div>
                  <div className="grid gap-3 px-4 py-3">
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--editor-field-min)),1fr))] items-end gap-3">
                      <div className="grid gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Retry failed output</span>
                        <ToggleRow
                          checked={draft.loopConfig.enabled}
                          description={draft.loopConfig.enabled ? "Retry before continuing" : "Fail without retrying"}
                          onCheckedChange={(checked) =>
                            setDraft((current) => ({
                              ...current,
                              loopConfig: { ...current.loopConfig, enabled: checked }
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <InfoLabel label="Attempts" info="How many times the workflow retries before giving up." />
                        <Input
                          className="h-8 text-xs"
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              loopConfig: { ...current.loopConfig, maxAttempts: Number(event.target.value) }
                            }))
                          }
                          type="number"
                          min={1}
                          max={10}
                          value={draft.loopConfig.maxAttempts}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <InfoLabel label="Stop retrying" info="Choose when to stop retrying: usually when the eval passes." />
                        <NativeSelect
                          ariaLabel="Stop retrying"
                          onChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              loopConfig: { ...current.loopConfig, breakCondition: value as "on_pass" | "on_fail" }
                            }))
                          }
                          options={[
                            { label: "when it passes", value: "on_pass" },
                            { label: "when it fails", value: "on_fail" }
                          ]}
                          value={draft.loopConfig.breakCondition}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <InfoLabel label="Delay" info="Wait time in milliseconds between each retry attempt." />
                        <Input
                          className="h-8 text-xs"
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              loopConfig: { ...current.loopConfig, retryDelayMs: Number(event.target.value) }
                            }))
                          }
                          type="number"
                          min={0}
                          value={draft.loopConfig.retryDelayMs}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
        <ConfirmDialog
          confirmLabel="Delete eval"
          description={`Workflow QA steps using ${draft.name} will no longer be executable.`}
          onConfirm={async () => {
            setConfirmDelete(false);
            await remove();
          }}
          onOpenChange={setConfirmDelete}
          open={confirmDelete}
          title={`Delete ${draft.name}?`}
        />
      </div>
    </AppShell>
  );
}

function splitRuleValues(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function joinRuleValues(values: string[]): string {
  return values.join(", ");
}

function InfoTip({ content }: { content: string }) {
  return (
    <Tooltip content={content} side="bottom">
      <button
        aria-label={content}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
        type="button"
      >
        <Icon name="info" size={12} />
      </button>
    </Tooltip>
  );
}

function InfoLabel({ info, label }: { info: string; label: string }) {
  return (
    <div className="flex h-4 items-center gap-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <InfoTip content={info} />
    </div>
  );
}

function CriteriaRow({
  index,
  onDelete,
  onUpdate,
  rubric
}: {
  index: number;
  onDelete: () => void;
  onUpdate: (patch: Partial<Rubric>) => void;
  rubric: Rubric;
}) {
  const config = CHECK_TYPES[rubric.type];

  return (
    <div className="grid min-w-0 grid-cols-[1.5fr_1fr_2fr_0.75fr_min-content] items-end gap-2 rounded-md bg-background px-2 py-2 transition-colors hover:bg-panel-raised">
      <div className="grid min-w-0 gap-1.5 overflow-hidden">
        <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Criterion
        </span>
        <div className="flex items-center gap-1">
          <span className="w-5 shrink-0 text-center text-3xs font-mono text-muted-foreground">
            {index + 1}
          </span>
          <Input
            className="h-8 text-xs font-medium"
            onChange={(event) => onUpdate({ label: event.target.value })}
            placeholder="Grounding"
            value={rubric.label}
          />
        </div>
      </div>

      <div className="grid min-w-0 gap-1.5 overflow-hidden">
        <span className="flex items-center gap-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Check
          <InfoTip content={config.helper} />
        </span>
        <NativeSelect
          ariaLabel="Criterion check"
          onChange={(value) =>
            onUpdate({
              type: value as Rubric["type"],
              value: value === rubric.type ? rubric.value : ""
            })
          }
          options={[
            ...(rubric.type === "llm_judge" ? [{ label: CHECK_TYPES.llm_judge.label, value: "llm_judge" }] : []),
            ...RUBRIC_TYPES.map((type) => ({ label: CHECK_TYPES[type].label, value: type }))
          ]}
          value={rubric.type}
        />
      </div>

      <div className="grid min-w-0 gap-1.5 overflow-hidden">
        <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Condition
        </span>
        <CriterionValueEditor
          config={config}
          onChange={(value) => onUpdate({ value })}
          value={rubric.value}
        />
      </div>

      <div className="grid min-w-0 gap-1.5 overflow-hidden">
        <span className="flex items-center gap-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Importance
          <InfoTip content="How much this rule matters (1–100). Higher values give this rule more influence over the overall score." />
        </span>
        <ImportanceInput
          onChange={(value) => onUpdate({ importance: value })}
          value={rubric.importance}
        />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 self-end pb-0.5">
        <Tooltip content="Delete criterion" side="bottom">
          <Button
            aria-label="Delete criterion"
            icon="trash"
            onClick={onDelete}
            size="icon-xs"
            variant="ghost"
          />
        </Tooltip>
      </div>
    </div>
  );
}

function ImportanceInput({
  onChange,
  value
}: {
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <Input
      className="h-8 text-xs"
      min={1}
      max={100}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isNaN(v)) onChange(Math.min(100, Math.max(1, v)));
      }}
      type="number"
      value={value}
    />
  );
}

function CriterionValueEditor({
  config,
  onChange,
  value
}: {
  config: typeof CHECK_TYPES[Rubric["type"]];
  onChange: (value: string) => void;
  value: string;
}) {
  if (config.valueKind === "chips") {
    return (
      <EditableChips
        onChange={(values) => onChange(joinRuleValues(values))}
        placeholder={`Add ${config.valueLabel.toLowerCase()}`}
        values={splitRuleValues(value)}
      />
    );
  }

  if (config.valueKind === "number") {
    return (
      <Input
        aria-label={config.valueLabel}
        className="h-8 text-xs"
        min={0}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    );
  }

  if (config.valueKind === "textarea") {
    return (
      <Textarea
        aria-label={config.valueLabel}
        className="min-h-20 font-mono text-xs"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    );
  }

  return (
    <Input
      aria-label={config.valueLabel}
      className="h-8 font-mono text-xs"
      onChange={(event) => onChange(event.target.value)}
      placeholder="Example: \\bproof\\b"
      value={value}
    />
  );
}

function EditableChips({
  onChange,
  placeholder,
  values
}: {
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  const [draftValue, setDraftValue] = useState("");

  function addValue() {
    const clean = draftValue.trim();
    if (!clean) return;
    const exists = values.some((value) => value.toLowerCase() === clean.toLowerCase());
    if (!exists) onChange([...values, clean]);
    setDraftValue("");
  }

  function removeValue(value: string) {
    onChange(values.filter((entry) => entry !== value));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addValue();
    }
    if (event.key === "Backspace" && !draftValue && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-8 min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-input px-1.5 py-1 transition-colors focus-within:border-[var(--focus-border)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
      {values.map((value) => (
        <span
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-panel-raised px-1.5 text-2xs text-foreground"
          key={value}
        >
          <span className="truncate">{value}</span>
          <button
            aria-label={`Remove ${value}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => removeValue(value)}
            type="button"
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        className="h-5 min-w-24 shrink-0 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        onBlur={addValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={values.length ? "Add another" : placeholder}
        value={draftValue}
      />
    </div>
  );
}

function ResultInspector({
  result,
  rules
}: {
  result: EvalFileResult | null;
  rules: Rubric[];
}) {
  if (!result) {
    return (
      <Inspector>
        <InspectorHeader icon={ENTITY_ICONS.eval} title="Eval results" />
        <InspectorBody>
          <InspectorEmptyState description="Test this eval to inspect its latest criterion scores and recommendations." icon={ENTITY_ICONS.eval} title="No results yet" />
        </InspectorBody>
      </Inspector>
    );
  }

  const avgThreshold = rules.length > 0
    ? Math.round(rules.reduce((sum, r) => sum + r.importance, 0) / rules.length)
    : 50;

  return (
    <Inspector>
      <InspectorHeader
        actions={<Tooltip content="Each criterion is scored 0–100. The overall score is weighted by importance. Passes when it meets the threshold." side="bottom"><Button aria-label="About eval results" icon="info" size="icon-xs" variant="ghost" /></Tooltip>}
        icon={ENTITY_ICONS.eval}
        title="Eval results"
      />
      <InspectorBody>
      <InspectorSection>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Score</span>
          <Tooltip content={`Weighted average of all criteria. Needs ${avgThreshold}% to pass.`} side="bottom">
            <Button aria-label="Score info" size="icon-xs" variant="ghost" icon="info" />
          </Tooltip>
          <Pill tone={result.passed ? "success" : "destructive"} className="ml-auto">
            {result.overallScore}/100
          </Pill>
        </div>
        <div className="mt-3 grid gap-2">
          {Object.entries(result.rubricScores).map(([label, score]) => (
            <div key={label}>
              <div className="flex items-center justify-between text-2xs">
                <span className="text-foreground">{label}</span>
                <Pill tone={score.passed ? "success" : "destructive"} className="text-3xs">
                  {score.score}
                </Pill>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className={cn("h-full rounded-full transition-all", score.passed ? "bg-success" : "bg-destructive")}
                  style={{ width: `${Math.min(100, score.score)}%` }}
                />
              </div>
              <div className="mt-0.5 text-3xs text-muted-foreground">{score.notes}</div>
            </div>
          ))}
        </div>
      </InspectorSection>

      {result.findings.length > 0 && (
        <InspectorSection>
          <span className="text-xs font-semibold text-foreground">Findings</span>
          <div className="mt-2 grid gap-1">
            {result.findings.map((finding) => (
              <div className="text-2xs" key={`${finding.label}-${finding.notes}`}>
                <span className="text-foreground">{finding.label}: </span>
                <span className="text-muted-foreground">{finding.notes}</span>
              </div>
            ))}
          </div>
        </InspectorSection>
      )}

      {result.recommendations.length > 0 && (
        <InspectorSection>
          <span className="text-xs font-semibold text-foreground">Recommendations</span>
          <div className="mt-2 grid gap-1">
            {result.recommendations.map((rec, i) => (
              <div className="text-2xs text-muted-foreground" key={i}>
                - {rec}
              </div>
            ))}
          </div>
        </InspectorSection>
      )}
      </InspectorBody>
    </Inspector>
  );
}
