"use client";

import { useMemo, useState, useEffect, type KeyboardEvent } from "react";
import { Button, EmptyState, Field, Input, NativeSelect, PageHeader, Pill, SearchInput, Switch, Textarea, Tooltip, cn, toast } from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { Icon } from "../../components/icons";
import { InspectorToggle } from "../../components/inspector-toggle";
import { AppShell } from "../../components/app-shell";
import { useWorkspaceStore } from "../../lib/use-workspace-store";

type Rubric = {
  id: string;
  label: string;
  description: string;
  type: "contains" | "missing" | "min_words" | "max_words" | "regex" | "llm_judge";
  value: string;
  weight: number;
  passThreshold: number;
};

function blankEvalFile(): Omit<import("../../lib/workspace-data").EvalFile, "id" | "updatedAt" | "results"> {
  return {
    name: "New Eval",
    description: "Describe what this eval checks for.",
    targetType: "draft",
    targetId: "",
    rubrics: [],
    overallThreshold: 70,
    loopConfig: {
      enabled: false,
      maxAttempts: 3,
      breakCondition: "on_pass",
      retryDelayMs: 0
    },
    status: "draft"
  };
}

function blankRubric(): Rubric {
  return {
    id: `rubric_${crypto.randomUUID()}`,
    label: "Required signal",
    description: "",
    type: "contains",
    value: "",
    weight: 10,
    passThreshold: 75
  };
}

const CHECK_TYPES: Record<Rubric["type"], {
  label: string;
  helper: string;
  valueLabel: string;
  valueKind: "chips" | "number" | "text" | "textarea";
}> = {
  contains: {
    label: "Contains any of",
    helper: "Passes when the output includes at least one selected phrase.",
    valueLabel: "Accepted phrases",
    valueKind: "chips"
  },
  missing: {
    label: "Must not include",
    helper: "Passes when none of these phrases appear in the output.",
    valueLabel: "Blocked phrases",
    valueKind: "chips"
  },
  min_words: {
    label: "Minimum words",
    helper: "Passes when the output has at least this many words.",
    valueLabel: "Minimum",
    valueKind: "number"
  },
  max_words: {
    label: "Maximum words",
    helper: "Passes when the output stays under this word count.",
    valueLabel: "Maximum",
    valueKind: "number"
  },
  regex: {
    label: "Matches pattern",
    helper: "Passes when the output matches this regular expression.",
    valueLabel: "Pattern",
    valueKind: "text"
  },
  llm_judge: {
    label: "Quality judge",
    helper: "Stores a judge prompt. Runtime scoring is not model-backed yet.",
    valueLabel: "Judge instruction",
    valueKind: "textarea"
  }
};

const RUBRIC_TYPES = Object.keys(CHECK_TYPES) as Rubric["type"][];

export default function EvalsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.evalFiles[0]?.id ?? null);
  const selected = store.evalFiles.find((ef) => ef.id === selectedId) ?? null;
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<Omit<import("../../lib/workspace-data").EvalFile, "id" | "updatedAt" | "results"> | import("../../lib/workspace-data").EvalFile>(
    selected ?? blankEvalFile()
  );
  const [query, setQuery] = useState("");
  const [sample, setSample] = useState("Paste content here to test the criteria against.");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const isNew = selectedId === null;

  useEffect(() => {
    if (!selectedId) return;
    const found = store.evalFiles.find((ef) => ef.id === selectedId);
    if (found) reset(found);
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
    const ef = store.evalFiles.find((e) => e.id === selectedId);
    if (!ef || ef.results.length === 0) return null;
    return ef.results[ef.results.length - 1];
  }, [selectedId, store.evalFiles]);

  function selectFile(ef: import("../../lib/workspace-data").EvalFile) {
    setSelectedId(ef.id);
    reset(ef);
  }

  function createFile() {
    setSelectedId(null);
    reset(blankEvalFile());
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = store.addEvalFile(draft as Omit<import("../../lib/workspace-data").EvalFile, "id" | "updatedAt" | "results">);
        setSelectedId(created.id);
        reset(created);
        toast.success("Eval created");
      } else {
        store.updateEvalFile((draft as import("../../lib/workspace-data").EvalFile).id, draft as Partial<import("../../lib/workspace-data").EvalFile>);
        markSaved();
        toast.success("Eval saved");
      }
    } catch {
      toast.error("Failed to save eval");
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (isNew) return;
    store.deleteEvalFile((draft as import("../../lib/workspace-data").EvalFile).id);
    createFile();
  }

  function addRubric() {
    setDraft((current) => ({ ...current, rubrics: [...current.rubrics, blankRubric()] }));
  }

  function updateRubric(id: string, patch: Partial<Rubric>) {
    setDraft((current) => ({
      ...current,
      rubrics: current.rubrics.map((r) => (r.id === id ? { ...r, ...patch } : r))
    }));
  }

  function deleteRubric(id: string) {
    setDraft((current) => ({ ...current, rubrics: current.rubrics.filter((r) => r.id !== id) }));
  }

  function moveRubric(id: string, direction: "up" | "down") {
    setDraft((current) => {
      const idx = current.rubrics.findIndex((r) => r.id === id);
      if (idx === -1) return current;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= current.rubrics.length) return current;
      const newRubrics = [...current.rubrics];
      [newRubrics[idx], newRubrics[newIdx]] = [newRubrics[newIdx], newRubrics[idx]];
      return { ...current, rubrics: newRubrics };
    });
  }

  async function runEval() {
    if (isNew || draft.rubrics.length === 0 || draft.status !== "active") return;

    setRunning(true);
    try {
      const response = await fetch("/api/runs/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: sample,
          target: { type: "eval", id: (draft as import("../../lib/workspace-data").EvalFile).id },
          contextRefs: [{ id: (draft as import("../../lib/workspace-data").EvalFile).id, kind: "eval" }]
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
            const rubricScores: import("../../lib/workspace-data").EvalFileResult["rubricScores"] = {};
            for (const finding of evalResult.findings) {
              const rubric = draft.rubrics.find((r) => r.label === finding.label);
              const threshold = rubric?.passThreshold ?? 75;
              rubricScores[finding.label] = {
                score: finding.score,
                passed: finding.score >= threshold,
                notes: finding.notes
              };
            }
            store.appendEvalResult((draft as import("../../lib/workspace-data").EvalFile).id, {
              id: `result_${crypto.randomUUID()}`,
              evalId: (draft as import("../../lib/workspace-data").EvalFile).id,
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
      store.setInspectorOpen(true);
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
    a.download = `${(draft as import("../../lib/workspace-data").EvalFile).name.replace(/\s+/g, "-").toLowerCase()}.json`;
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
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string) as Omit<import("../../lib/workspace-data").EvalFile, "id" | "updatedAt" | "results">;
          const created = store.addEvalFile({
            name: data.name,
            description: data.description,
            targetType: data.targetType,
            targetId: data.targetId,
            rubrics: data.rubrics,
            overallThreshold: data.overallThreshold,
            loopConfig: data.loopConfig,
            status: data.status
          });
          setSelectedId(created.id);
          setDraft(created);
        } catch {
          alert("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  return (
    <AppShell
      inspector={
        <ResultInspector result={latestResult} rubrics={draft.rubrics} />
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name="bar-chart" size={14} />}
          title="Evals"
          actions={
            <>
              <div className="hidden w-80 md:block">
                <SearchInput placeholder="Search evals" value={query} onChange={setQuery} />
              </div>
              <InspectorToggle label="Open inspector" />
            </>
          }
        />

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-background">
            <div className="border-b border-border p-3 md:hidden">
              <SearchInput placeholder="Search evals" value={query} onChange={setQuery} />
            </div>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Eval Files
              </span>
              <Pill className="ml-auto">{store.evalFiles.length}</Pill>
              <Tooltip content="New eval file" side="bottom">
                <Button
                  aria-label="New eval file"
                  className="h-7 px-2"
                  onClick={createFile}
                  size="sm"
                  variant="ghost"
                >
                  <Icon name="plus" size={14} />
                  <span className="ml-1 text-xs">New</span>
                </Button>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <EmptyState
                  className="py-10"
                  description="No eval files match this search."
                  title="No matches"
                />
              ) : (
                <ul className="grid gap-1">
                  {filtered.map((ef) => (
                    <li key={ef.id}>
                      <button
                        className={cn(
                          "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                          ef.id === selectedId
                            ? "border-border bg-selected"
                            : "border-transparent hover:border-border hover:bg-hover"
                        )}
                        onClick={() => selectFile(ef)}
                        type="button"
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="text-muted-foreground" name="bar-chart" size={14} />
                          <span className="truncate text-sm font-medium text-foreground">{ef.name}</span>
                          <Pill tone={ef.status === "active" ? "success" : "default"} className="ml-auto text-[10px]">
                            {ef.status === "active" ? "enabled" : "disabled"}
                          </Pill>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{ef.rubrics.length} criteria</span>
                          <span className="text-border">·</span>
                          <span>threshold {ef.overallThreshold}</span>
                          <span className="text-border">·</span>
                          <span>{ef.results.length} runs</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>Evals</span>
                <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.name}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>
                  {draft.status === "active" ? "enabled" : "disabled"}
                </Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Tooltip content="Export as JSON" side="bottom">
                  <Button
                    aria-label="Export"
                    onClick={exportJson}
                    size="icon"
                    variant="ghost"
                    disabled={isNew}
                  >
                    <Icon name="download" size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="Import from JSON" side="bottom">
                  <Button aria-label="Import" onClick={importJson} size="icon" variant="ghost">
                    <Icon name="upload" size={14} />
                  </Button>
                </Tooltip>
                <Button
                  onClick={runEval}
                  size="md"
                  variant="outline"
                  disabled={isNew || draft.rubrics.length === 0 || draft.status !== "active" || running}
                >
                  {running ? (
                    <Icon name="loader" size={14} className="animate-spin" />
                  ) : (
                    <Icon name="play" size={14} />
                  )}
                  Run
                </Button>
                {!isNew ? (
                  <Tooltip content="Delete eval" side="bottom">
                    <Button
                      aria-label="Delete eval"
                      onClick={remove}
                      size="icon"
                      variant="ghost"
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </Tooltip>
                ) : null}
                <Button disabled={!dirty || saving} onClick={save} size="md" variant={dirty ? "primary" : "outline"}>
                   {saving ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="save" size={14} />}
                   Save
                 </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid gap-3 border-b border-border bg-panel-raised px-4 py-3 xl:grid-cols-[minmax(0,1fr)_160px_160px]">
                  <Field label="Eval name">
                    <Input
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      value={draft.name}
                    />
                  </Field>
                  <Field label="Pass score" hint="Overall score needed to pass.">
                    <Input
                      onChange={(e) => setDraft((d) => ({ ...d, overallThreshold: Number(e.target.value) }))}
                      type="number"
                      min={0}
                      max={100}
                      value={draft.overallThreshold}
                    />
                  </Field>
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Enabled</span>
                    <label className="flex h-9 items-center gap-2 text-xs text-foreground">
                      <Switch
                        checked={draft.status === "active"}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            status: checked ? "active" : "draft"
                          }))
                        }
                      />
                      <span>{draft.status === "active" ? "Can run in tests and workflows" : "Hidden from runtime pickers"}</span>
                    </label>
                  </div>
                </div>

                <div className="grid gap-4 px-4 py-3">
                  <Field label="Description">
                    <Input
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      value={draft.description}
                    />
                  </Field>

                  <Field label="Test sample" hint="Paste an output here to test the criteria before using the eval in a workflow.">
                    <Textarea
                      className="min-h-28 font-mono text-xs"
                      onChange={(e) => setSample(e.target.value)}
                      value={sample}
                    />
                  </Field>
                </div>

                <div className="border-t border-border">
                  <div className="flex h-9 items-center gap-2 border-b border-border px-4">
                    <Icon className="text-muted-foreground" name="list" size={14} />
                    <span className="text-xs font-medium text-foreground">Criteria</span>
                    <Pill className="ml-auto">{draft.rubrics.length}</Pill>
                    <Button className="ml-1 h-7" onClick={addRubric} size="sm" variant="outline">
                      <Icon name="plus" size={14} />
                      Criterion
                    </Button>
                  </div>
                  <div className="p-4">
                    {draft.rubrics.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                        No criteria yet. Add one to start scoring.
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-md border border-border">
                        <div className="hidden border-b border-border bg-panel-raised px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:grid xl:grid-cols-[minmax(220px,1.1fr)_190px_minmax(260px,1.4fr)_84px_84px_76px] xl:gap-3">
                          <span>Criterion</span>
                          <span>Check</span>
                          <span>Condition</span>
                          <span>Weight</span>
                          <span>Pass</span>
                          <span>Actions</span>
                        </div>
                        <div className="divide-y divide-border">
                          {draft.rubrics.map((rubric, idx) => (
                            <CriteriaRow
                              canMoveDown={idx < draft.rubrics.length - 1}
                              canMoveUp={idx > 0}
                              index={idx}
                              key={rubric.id}
                              onDelete={() => deleteRubric(rubric.id)}
                              onMoveDown={() => moveRubric(rubric.id, "down")}
                              onMoveUp={() => moveRubric(rubric.id, "up")}
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
                  <div className="flex h-9 items-center gap-2 border-b border-border px-4">
                    <Icon className="text-muted-foreground" name="repeat" size={14} />
                    <span className="text-xs font-medium text-foreground">Workflow Retry Policy</span>
                    <Pill tone={draft.loopConfig.enabled ? "success" : "default"} className="ml-auto">
                      {draft.loopConfig.enabled ? "retry enabled" : "no retry"}
                    </Pill>
                  </div>
                  <div className="grid gap-3 px-4 py-3">
                    <div className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                      When this eval is used as a QA step in a workflow, retry can send failed work back through the previous step before the workflow continues. Direct test runs on this page never retry.
                    </div>
                    <div className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_140px_180px_150px]">
                      <div className="grid gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Retry failed workflow output</span>
                        <label className="flex h-8 items-center gap-2 text-xs text-foreground">
                          <Switch
                            checked={draft.loopConfig.enabled}
                            onCheckedChange={(checked) =>
                              setDraft((current) => ({
                                ...current,
                                loopConfig: { ...current.loopConfig, enabled: checked }
                              }))
                            }
                          />
                          <span>{draft.loopConfig.enabled ? "Retry before continuing" : "Fail without retrying"}</span>
                        </label>
                      </div>
                      <Field label="Attempts" hint="Total tries.">
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
                      </Field>
                      <Field label="Stop retrying" hint="Usually stop when the eval passes.">
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
                      </Field>
                      <Field label="Delay" hint="Milliseconds between tries.">
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
                      </Field>
                    </div>
                  </div>
                </div>

                {selectedId && selected && selected.results.length > 0 && (
                  <div className="border-t border-border">
                    <div className="flex h-9 items-center gap-2 border-b border-border px-4">
                      <Icon className="text-muted-foreground" name="history" size={14} />
                      <span className="text-xs font-medium text-foreground">Results History</span>
                      <Pill className="ml-auto">{selected.results.length}</Pill>
                    </div>
                    <div className="p-4">
                      <div className="overflow-hidden rounded-md border border-border">
                        <div className="hidden border-b border-border bg-panel-raised px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:grid xl:grid-cols-[160px_90px_minmax(0,1fr)] xl:gap-3">
                          <span>Run</span>
                          <span>Score</span>
                          <span>Criteria</span>
                        </div>
                        <div className="divide-y divide-border">
                          {[...selected.results].reverse().map((result) => (
                            <ResultRow key={result.id} result={result} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
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

function CriteriaRow({
  canMoveDown,
  canMoveUp,
  index,
  onDelete,
  onMoveDown,
  onMoveUp,
  onUpdate,
  rubric
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  index: number;
  onDelete: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onUpdate: (patch: Partial<Rubric>) => void;
  rubric: Rubric;
}) {
  const config = CHECK_TYPES[rubric.type];

  return (
    <div className="grid gap-3 bg-background px-3 py-3 xl:grid-cols-[minmax(220px,1.1fr)_190px_minmax(260px,1.4fr)_84px_84px_76px] xl:items-start">
      <div className="grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">
          Criterion
        </span>
        <div className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-right text-[10px] font-mono text-muted-foreground">
            {index + 1}
          </span>
          <Input
            className="h-8 text-xs font-medium"
            onChange={(event) => onUpdate({ label: event.target.value })}
            placeholder="Grounding"
            value={rubric.label}
          />
        </div>
        <Input
          className="ml-7 h-7 text-xs"
          onChange={(event) => onUpdate({ description: event.target.value })}
          placeholder="Optional note for teammates"
          value={rubric.description}
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">
          Check
        </span>
        <NativeSelect
          ariaLabel="Criterion check"
          onChange={(value) =>
            onUpdate({
              type: value as Rubric["type"],
              value: value === rubric.type ? rubric.value : ""
            })
          }
          options={RUBRIC_TYPES.map((type) => ({ label: CHECK_TYPES[type].label, value: type }))}
          value={rubric.type}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">{config.helper}</p>
      </div>

      <div className="grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">
          Condition
        </span>
        <CriterionValueEditor
          config={config}
          onChange={(value) => onUpdate({ value })}
          value={rubric.value}
        />
      </div>

      <Field label="Weight">
        <Input
          className="h-8 text-xs"
          onChange={(event) => onUpdate({ weight: Number(event.target.value) })}
          min={1}
          type="number"
          value={rubric.weight}
        />
      </Field>

      <Field label="Pass">
        <Input
          className="h-8 text-xs"
          onChange={(event) => onUpdate({ passThreshold: Number(event.target.value) })}
          min={0}
          max={100}
          type="number"
          value={rubric.passThreshold}
        />
      </Field>

      <div className="grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">
          Actions
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip content="Move up" side="bottom">
            <button
              aria-label="Move criterion up"
              className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-30"
              disabled={!canMoveUp}
              onClick={onMoveUp}
              type="button"
            >
              <Icon name="chevron-right" size={12} className="-rotate-90" />
            </button>
          </Tooltip>
          <Tooltip content="Move down" side="bottom">
            <button
              aria-label="Move criterion down"
              className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-30"
              disabled={!canMoveDown}
              onClick={onMoveDown}
              type="button"
            >
              <Icon name="chevron-right" size={12} className="rotate-90" />
            </button>
          </Tooltip>
          <Tooltip content="Delete criterion" side="bottom">
            <button
              aria-label="Delete criterion"
              className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
              onClick={onDelete}
              type="button"
            >
              <Icon name="trash" size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
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
        label={config.valueLabel}
        onChange={(values) => onChange(joinRuleValues(values))}
        values={splitRuleValues(value)}
      />
    );
  }

  if (config.valueKind === "number") {
    return (
      <Field label={config.valueLabel}>
        <Input
          className="h-8 text-xs"
          min={0}
          onChange={(event) => onChange(event.target.value)}
          type="number"
          value={value}
        />
      </Field>
    );
  }

  if (config.valueKind === "textarea") {
    return (
      <Field label={config.valueLabel}>
        <Textarea
          className="min-h-20 font-mono text-xs"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      </Field>
    );
  }

  return (
    <Field label={config.valueLabel}>
      <Input
        className="h-8 font-mono text-xs"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Example: \\bproof\\b"
        value={value}
      />
    </Field>
  );
}

function EditableChips({
  label,
  onChange,
  values
}: {
  label: string;
  onChange: (values: string[]) => void;
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
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-border bg-input px-1.5 py-1">
        {values.map((value) => (
          <span
            className="inline-flex h-5 max-w-full items-center gap-1 rounded-sm bg-panel-raised px-1.5 text-[11px] text-foreground"
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
          className="h-5 min-w-32 flex-1 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
          onBlur={addValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={values.length ? "Add another" : "Type a phrase and press Enter"}
          value={draftValue}
        />
      </div>
    </div>
  );
}

function ResultRow({
  result
}: {
  result: import("../../lib/workspace-data").EvalFileResult;
}) {
  const tone = result.passed ? "success" : "destructive";
  const time = new Date(result.runAt).toLocaleTimeString();

  return (
    <div className="grid gap-3 bg-background px-3 py-3 text-xs xl:grid-cols-[160px_90px_minmax(0,1fr)] xl:items-start">
      <div className="flex items-center gap-2 xl:grid xl:gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">Run</span>
        <div className="flex items-center gap-2">
          <Pill tone={tone}>{result.passed ? "passed" : "failed"}</Pill>
          <span className="text-[11px] text-muted-foreground">{time}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 xl:block">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">Score</span>
        <span className="text-sm font-semibold text-foreground">{result.overallScore}/100</span>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">
          Criteria
        </span>
        {Object.entries(result.rubricScores).map(([label, score]) => (
          <div className="flex items-center gap-2" key={label}>
            <span className="w-28 shrink-0 truncate text-[11px] text-foreground">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
              <div
                className={cn("h-full rounded-full transition-all", score.passed ? "bg-success" : "bg-destructive")}
                style={{ width: `${Math.min(100, score.score)}%` }}
              />
            </div>
            <span className="w-12 text-right text-[10px] text-muted-foreground">{score.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultInspector({
  result,
  rubrics
}: {
  result: import("../../lib/workspace-data").EvalFileResult | null;
  rubrics: Rubric[];
}) {
  if (!result) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-[11px] text-muted-foreground">
        <Icon name="bar-chart" size={16} />
        <div>No eval results yet.</div>
        <div>Run an eval to see results here.</div>
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Score</span>
          <Pill tone={result.passed ? "success" : "destructive"} className="ml-auto">
            {result.overallScore}/100
          </Pill>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {result.passed ? "Passed" : "Failed"} threshold at{" "}
          {rubrics.length > 0
            ? Math.round(rubrics.reduce((sum, r) => sum + r.passThreshold, 0) / rubrics.length)
            : 75}
        </div>
        <div className="mt-3 grid gap-2">
          {Object.entries(result.rubricScores).map(([label, score]) => (
            <div key={label}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-foreground">{label}</span>
                <Pill tone={score.passed ? "success" : "destructive"} className="text-[10px]">
                  {score.score}
                </Pill>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className={cn("h-full rounded-full transition-all", score.passed ? "bg-success" : "bg-destructive")}
                  style={{ width: `${Math.min(100, score.score)}%` }}
                />
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{score.notes}</div>
            </div>
          ))}
        </div>
      </div>

      {result.findings.length > 0 && (
        <div className="border-b border-border p-3">
          <span className="text-xs font-semibold text-foreground">Findings</span>
          <div className="mt-2 grid gap-1">
            {result.findings.map((finding) => (
              <div className="text-[11px]" key={`${finding.label}-${finding.notes}`}>
                <span className="text-foreground">{finding.label}: </span>
                <span className="text-muted-foreground">{finding.notes}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.recommendations.length > 0 && (
        <div className="border-b border-border p-3">
          <span className="text-xs font-semibold text-foreground">Recommendations</span>
          <div className="mt-2 grid gap-1">
            {result.recommendations.map((rec, i) => (
              <div className="text-[11px] text-muted-foreground" key={i}>
                - {rec}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
