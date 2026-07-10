"use client";

import { useMemo, useState } from "react";
import { Button, EmptyState, Field, Input, Pill, Textarea, Tooltip, cn } from "@spielos/design-system";
import { Icon } from "../../components/icons";
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
    label: "New Rubric",
    description: "What this rubric checks",
    type: "contains",
    value: "",
    weight: 10,
    passThreshold: 75
  };
}

const TARGET_TYPES: { value: import("../../lib/workspace-data").EvalTargetType; label: string; icon: string }[] = [
  { value: "draft", label: "Draft", icon: "file-text" },
  { value: "prompt", label: "Prompt", icon: "message-square" },
  { value: "workflow", label: "Workflow", icon: "git-branch" },
  { value: "skill", label: "Skill", icon: "sparkles" },
  { value: "role", label: "Role", icon: "users" }
];

const RUBRIC_TYPES = ["contains", "missing", "min_words", "max_words", "regex", "llm_judge"] as const;

export default function EvalsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.evalFiles[0]?.id ?? null);
  const selected = store.evalFiles.find((ef) => ef.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Omit<import("../../lib/workspace-data").EvalFile, "id" | "updatedAt" | "results"> | import("../../lib/workspace-data").EvalFile>(
    selected ?? blankEvalFile()
  );
  const [query, setQuery] = useState("");
  const [sample, setSample] = useState("Paste content here to test your rubrics against.");
  const [running, setRunning] = useState(false);
  const isNew = selectedId === null;

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
    setDraft(ef);
  }

  function createFile() {
    setSelectedId(null);
    setDraft(blankEvalFile());
  }

  function save() {
    if (isNew) {
      const created = store.addEvalFile(draft as Omit<import("../../lib/workspace-data").EvalFile, "id" | "updatedAt" | "results">);
      setSelectedId(created.id);
      setDraft(created);
    } else {
      store.updateEvalFile((draft as import("../../lib/workspace-data").EvalFile).id, draft as Partial<import("../../lib/workspace-data").EvalFile>);
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
    if (isNew || draft.rubrics.length === 0) return;

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

  function saveAsSkill() {
    const slug = `eval.${draft.name.toLowerCase().replace(/\s+/g, "-")}`;
    store.addSkill({
      name: `${draft.name} (skill)`,
      slug,
      description: `Eval skill: ${draft.name}`,
      category: "evaluation",
      status: "active",
      auth: "none",
      sideEffect: "none",
      inputSchema: '{ "input": "string" }',
      outputSchema: '{ "score": "number", "passed": "boolean" }',
      implementation: `Scores input with ${draft.rubrics.length} rubrics.`,
      evalRubrics: draft.rubrics,
      overallThreshold: draft.overallThreshold
    });
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
        <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-panel-raised text-foreground">
            <Icon name="bar-chart" size={14} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">Evals</h1>
          </div>
          <div className="ml-auto hidden w-80 md:block">
            <SearchInput query={query} setQuery={setQuery} />
          </div>
          <InspectorToggle label="Open inspector" />
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-background">
            <div className="border-b border-border p-3 md:hidden">
              <SearchInput query={query} setQuery={setQuery} />
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
                          <Icon className="text-muted-foreground" name={TARGET_TYPES.find((t) => t.value === ef.targetType)?.icon ?? "file-text"} size={14} />
                          <span className="truncate text-sm font-medium text-foreground">{ef.name}</span>
                          <Pill tone={ef.status === "active" ? "success" : "default"} className="ml-auto text-[10px]">
                            {ef.status}
                          </Pill>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{ef.rubrics.length} rubrics</span>
                          <span className="text-border">|</span>
                          <span>threshold {ef.overallThreshold}</span>
                          <span className="text-border">|</span>
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
                <Pill tone={draft.status === "active" ? "success" : "default"}>{draft.status}</Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Tooltip content="Save eval as a skill (kind=eval)" side="bottom">
                  <Button onClick={saveAsSkill} size="sm" variant="outline">
                    <Icon name="sparkles" size={14} /> Save as skill
                  </Button>
                </Tooltip>
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
                  disabled={isNew || draft.rubrics.length === 0 || running}
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
                <Button onClick={save} size="md">
                  <Icon name="save" size={14} />
                  Save
                </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid gap-3 border-b border-border bg-panel-raised px-4 py-3 xl:grid-cols-[minmax(0,1fr)_160px]">
                  <Field label="Eval name">
                    <Input
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      value={draft.name}
                    />
                  </Field>
                  <Field label="Target type">
                    <NativeSelect
                      ariaLabel="Target type"
                      onChange={(value) => setDraft((d) => ({ ...d, targetType: value as import("../../lib/workspace-data").EvalTargetType }))}
                      options={TARGET_TYPES.map((t) => ({ label: t.label, value: t.value }))}
                      value={draft.targetType}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 px-4 py-3">
                  <Field label="Description">
                    <Input
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      value={draft.description}
                    />
                  </Field>

                  <div className="flex items-center gap-3">
                    <div className="w-32">
                      <Field label="Overall threshold">
                        <Input
                          onChange={(e) => setDraft((d) => ({ ...d, overallThreshold: Number(e.target.value) }))}
                          type="number"
                          min={0}
                          max={100}
                          value={draft.overallThreshold}
                        />
                      </Field>
                    </div>
                    <div className="w-32">
                      <Field label="Status">
                        <NativeSelect
                          ariaLabel="Status"
                          onChange={(value) => setDraft((d) => ({ ...d, status: value as import("../../lib/workspace-data").EvalFile["status"] }))}
                          options={["active", "draft", "archived"].map((v) => ({ label: v, value: v }))}
                          value={draft.status}
                        />
                      </Field>
                    </div>
                  </div>

                  <Field label="Sample content to evaluate">
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
                    <span className="text-xs font-medium text-foreground">Rubrics</span>
                    <Pill className="ml-auto">{draft.rubrics.length}</Pill>
                    <Button className="ml-1 h-7" onClick={addRubric} size="sm" variant="outline">
                      <Icon name="plus" size={14} />
                      Rubric
                    </Button>
                  </div>
                  <div className="grid gap-1 p-4">
                    {draft.rubrics.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                        No rubrics yet. Add one to start scoring.
                      </div>
                    ) : (
                      draft.rubrics.map((rubric, idx) => (
                        <div
                          className="grid items-center gap-2 rounded-md border border-border bg-panel-raised p-3 xl:grid-cols-[minmax(0,1fr)_100px_minmax(120px,1fr)_60px_60px_64px]"
                          key={rubric.id}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground">{idx + 1}</span>
                            <Input
                              className="h-7 text-xs"
                              onChange={(e) => updateRubric(rubric.id, { label: e.target.value })}
                              value={rubric.label}
                            />
                          </div>
                          <NativeSelect
                            ariaLabel="Rubric type"
                            className="h-7"
                            onChange={(value) => updateRubric(rubric.id, { type: value as Rubric["type"] })}
                            options={RUBRIC_TYPES.map((t) => ({ label: t, value: t }))}
                            value={rubric.type}
                          />
                          <Input
                            className="h-7 font-mono text-xs"
                            onChange={(e) => updateRubric(rubric.id, { value: e.target.value })}
                            placeholder="values, comma-separated"
                            value={rubric.value}
                          />
                          <Input
                            className="h-7 text-xs"
                            onChange={(e) => updateRubric(rubric.id, { weight: Number(e.target.value) })}
                            type="number"
                            min={1}
                            value={rubric.weight}
                          />
                          <Input
                            className="h-7 text-xs"
                            onChange={(e) => updateRubric(rubric.id, { passThreshold: Number(e.target.value) })}
                            type="number"
                            min={0}
                            max={100}
                            value={rubric.passThreshold}
                          />
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              className="rounded p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-30"
                              disabled={idx === 0}
                              onClick={() => moveRubric(rubric.id, "up")}
                              type="button"
                            >
                              <Icon name="chevron-right" size={12} className="-rotate-90" />
                            </button>
                            <button
                              className="rounded p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-30"
                              disabled={idx === draft.rubrics.length - 1}
                              onClick={() => moveRubric(rubric.id, "down")}
                              type="button"
                            >
                              <Icon name="chevron-right" size={12} className="rotate-90" />
                            </button>
                            <button
                              className="rounded p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground"
                              onClick={() => deleteRubric(rubric.id)}
                              type="button"
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-t border-border">
                  <div className="flex h-9 items-center gap-2 border-b border-border px-4">
                    <Icon className="text-muted-foreground" name="repeat" size={14} />
                    <span className="text-xs font-medium text-foreground">Loop Config</span>
                    <Pill tone={draft.loopConfig.enabled ? "success" : "default"} className="ml-auto">
                      {draft.loopConfig.enabled ? "enabled" : "disabled"}
                    </Pill>
                  </div>
                  <div className="grid gap-3 px-4 py-3 xl:grid-cols-4">
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        checked={draft.loopConfig.enabled}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            loopConfig: { ...current.loopConfig, enabled: event.target.checked }
                          }))
                        }
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                      />
                      Enable loop retry
                    </label>
                    <Field label="Max attempts">
                      <Input
                        className="h-7 text-xs"
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
                    <Field label="Break condition">
                      <NativeSelect
                        ariaLabel="Break condition"
                        className="h-7"
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            loopConfig: { ...current.loopConfig, breakCondition: value as "on_pass" | "on_fail" }
                          }))
                        }
                        options={[
                          { label: "on pass", value: "on_pass" },
                          { label: "on fail", value: "on_fail" }
                        ]}
                        value={draft.loopConfig.breakCondition}
                      />
                    </Field>
                    <Field label="Retry delay (ms)">
                      <Input
                        className="h-7 text-xs"
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

                {selectedId && selected && selected.results.length > 0 && (
                  <div className="border-t border-border">
                    <div className="flex h-9 items-center gap-2 border-b border-border px-4">
                      <Icon className="text-muted-foreground" name="history" size={14} />
                      <span className="text-xs font-medium text-foreground">Results History</span>
                      <Pill className="ml-auto">{selected.results.length}</Pill>
                    </div>
                    <div className="grid gap-2 p-4">
                      {[...selected.results].reverse().map((result) => (
                        <ResultCard key={result.id} result={result} />
                      ))}
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

function SearchInput({ query, setQuery }: { query: string; setQuery: (value: string) => void; }) {
  return (
    <div className="relative">
      <Icon
        name="search"
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={14}
      />
      <Input
        className="h-8 pl-7 text-xs"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search evals"
        value={query}
      />
    </div>
  );
}

function ResultCard({
  result
}: {
  result: import("../../lib/workspace-data").EvalFileResult;
}) {
  const tone = result.passed ? "success" : "destructive";
  const time = new Date(result.runAt).toLocaleTimeString();

  return (
    <div className="rounded-md border border-border bg-panel-raised p-3">
      <div className="flex items-center gap-2">
        <Pill tone={tone}>{result.passed ? "PASSED" : "FAILED"}</Pill>
        <span className="text-sm font-semibold text-foreground">{result.overallScore}/100</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{time}</span>
      </div>
      <div className="mt-2 grid gap-1">
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
    <div className="grid gap-3 p-3">
      <div className="rounded-md border border-border bg-panel-raised p-3">
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
        <div className="rounded-md border border-border bg-panel-raised p-3">
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
        <div className="rounded-md border border-border bg-panel-raised p-3">
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

function NativeSelect({
  ariaLabel,
  className,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-label={ariaLabel}
        className="h-8 w-full appearance-none rounded-md border border-border bg-input px-2.5 pr-8 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-right"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-muted-foreground"
        size={14}
      />
    </div>
  );
}

function InspectorToggle({ label }: { label?: string }) {
  const store = useWorkspaceStore();
  return (
    <Tooltip content={store.inspectorOpen ? "Close panel" : (label ?? "Open panel")} side="bottom">
      <Button
        aria-label={store.inspectorOpen ? "Close panel" : (label ?? "Open panel")}
        onClick={() => store.toggleInspector()}
        size="icon"
        variant="ghost"
      >
        <Icon name={store.inspectorOpen ? "panel-right-close" : "panel-right-open"} size={14} />
      </Button>
    </Tooltip>
  );
}
