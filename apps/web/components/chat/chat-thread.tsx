"use client";

import { CONTEXT_ICON, ENTITY_ICONS, EVENT_ICONS, Icon } from "@spielos/design-system/components";
import { Spinner } from "@spielos/design-system";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  useMessagePartText
} from "@assistant-ui/react";
import { usePathname } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import type { ThreadMessageLike } from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import { ToolCallCard } from "./tool-call";
import {
  Button,
  ChoiceButton,
  Notice,
  Panel,
  Pill,
  StatusIcon,
  Tooltip,
  cn,
  toast
} from "@spielos/design-system";
import remarkGfm from "remark-gfm";
import { useSpielosChatAdapter } from "../../lib/chat-adapter";
import { useRunContext } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import { buildObjectReferences, mentionText, type ObjectReference } from "../../lib/object-references";
import { getTextAroundCursor } from "../mention-textarea";
import { MentionDropdown } from "../mention-dropdown";
import { ContextChips } from "./context-chips";
import { ContextPicker } from "./context-picker";
import { capabilitiesForModel, type Artifact, type HumanInputQuestion, type HumanInputRequest, type RunEvent, type RunStatus } from "@spielos/core";
import { ReasoningEffortControl, type ReasoningEffort } from "../reasoning-effort-control";
import { ChatModelPicker } from "../chat-model-picker";
import {
  compactRunEvents,
  isFailureEvent,
  isStartEvent,
  isSuccessEvent,
  isWaitingEvent,
  orderRunEvents,
  runtimeEventIcon
} from "../../lib/run-events";

function ComposerAddContext({ count }: { count: number }) {
  const run = useRunContext();
  return (
    <Button
      aria-label="Open context deck"
      icon={CONTEXT_ICON}
      onClick={() => run.setPickerOpen(true)}
      size="sm"
      type="button"
      variant="subtle"
    >
      Context
      <Pill className="ml-0.5 h-4 text-3xs" tone={count > 0 ? "info" : "default"}>{count}</Pill>
    </Button>
  );
}

function ComposerSend() {
  const empty = useAuiState((s) => s.composer.isEmpty);
  return (
    <Tooltip content={empty ? "Type a message" : "Send"} side="top">
      <ComposerPrimitive.Send asChild>
        <Button
          aria-label="Send message"
          disabled={empty}
          size="icon"
        >
          <Icon name="arrow-up" size={16} />
        </Button>
      </ComposerPrimitive.Send>
    </Tooltip>
  );
}

function ComposerCancel() {
  return (
    <Tooltip content="Stop" side="top">
      <ComposerPrimitive.Cancel asChild>
        <Button aria-label="Stop generating" size="icon">
          <Icon name="square" className="fill-current" size={14} />
        </Button>
      </ComposerPrimitive.Cancel>
    </Tooltip>
  );
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement | null, value: string) {
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function answerDraft(question: HumanInputQuestion, answer: unknown): string {
  if (question.kind === "text") return typeof answer === "string" ? answer : "";
  const optionIds = new Set(question.options?.map((option) => option.id) ?? []);
  if (question.kind === "single") {
    return typeof answer === "string" && !optionIds.has(answer) ? answer : "";
  }
  if (question.kind === "multi" && Array.isArray(answer)) {
    return answer.filter((value): value is string => typeof value === "string" && !optionIds.has(value)).join(", ");
  }
  return "";
}

function useHumanInputFlow(
  request: HumanInputRequest | null,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
) {
  const run = useRunContext();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAnswers({});
    setStep(0);
    setDraft("");
    setSubmitting(false);
    setError(null);
    setNativeTextareaValue(textareaRef.current, "");
  }, [request?.id, textareaRef]);

  const question = request?.questions[step] ?? null;
  const acceptsText = Boolean(
    question && (question.kind === "text" || ((question.kind === "single" || question.kind === "multi") && question.allowCustom))
  );

  const savedAnswer = question ? answers[question.id] : undefined;
  const canAdvance = Boolean(
    question &&
      (question.kind === "none" ||
        (question.kind === "text" && draft.trim()) ||
        (question.kind === "single" && (typeof savedAnswer === "string" || (question.allowCustom && draft.trim()))) ||
        (question.kind === "multi" &&
          ((Array.isArray(savedAnswer) && savedAnswer.length > 0) || (question.allowCustom && draft.trim()))))
  );

  const clearDraft = useCallback(() => {
    setDraft("");
    setNativeTextareaValue(textareaRef.current, "");
  }, [textareaRef]);

  const selectOption = useCallback((optionId: string) => {
    if (!question) return;
    setAnswers((current) => {
      if (question.kind === "multi") {
        const selected = Array.isArray(current[question.id]) ? current[question.id] as string[] : [];
        return {
          ...current,
          [question.id]: selected.includes(optionId)
            ? selected.filter((id) => id !== optionId)
            : [...selected, optionId]
        };
      }
      return { ...current, [question.id]: optionId };
    });
    clearDraft();
  }, [clearDraft, question]);

  const submitAnswers = useCallback(async (finalAnswers: Record<string, unknown>) => {
    if (!request || !run.activeRunId) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${run.activeRunId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.id, answers: finalAnswers })
      });
      if (!response.ok || !response.body) {
        let message = `Unable to continue (${response.status}).`;
        try {
          const body = await response.json() as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Keep the transport message.
        }
        throw new Error(message);
      }

      run.setHumanInputRequest(null);
      run.setRunStatus("running");
      run.setActivity(null);
      clearDraft();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminalStatus: RunStatus | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const item = JSON.parse(line.slice(6)) as {
            kind: string;
            runId?: string;
            event?: RunEvent;
            artifact?: import("@spielos/core").Artifact;
            request?: HumanInputRequest;
            text?: string;
            message?: string;
            status?: string;
          };
          if (item.kind === "run" && item.runId) run.setActiveRunId(item.runId);
          if (item.kind === "event" && item.event) {
            run.appendEvent(item.event);
            if (item.event.type === "run_completed") terminalStatus = "completed";
            if (item.event.type === "run_failed") terminalStatus = "failed";
            if (item.event.type === "run_cancelled") terminalStatus = "cancelled";
          }
          if (item.kind === "artifact" && item.artifact) run.appendArtifact(item.artifact);
          if (item.kind === "human_input" && item.request) {
            run.setHumanInputRequest(item.request);
            run.setRunStatus("waiting_human");
            terminalStatus = "waiting_human";
          }
          if (item.kind === "status" && item.message) run.setActivity(item.message);
          if (item.kind === "text" && item.text) run.appendContinuationText(item.text);
          if (
            item.kind === "done" &&
            item.status &&
            ["running", "waiting_human", "completed", "failed", "cancelled"].includes(item.status)
          ) {
            terminalStatus = item.status as RunStatus;
            run.setRunStatus(terminalStatus);
          }
          if (item.kind === "error") throw new Error(item.message ?? "Unable to resume the run.");
        }
      }
      if (!terminalStatus) run.setRunStatus("failed");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to resume the run.";
      setError(message);
      run.setRunStatus("failed");
      toast.error("The run could not continue", { description: message });
    } finally {
      setSubmitting(false);
    }
  }, [clearDraft, request, run]);

  const advance = useCallback(async () => {
    if (!request || !question || !canAdvance || submitting) return;
    let value = answers[question.id];
    const custom = draft.trim();
    if (question.kind === "text") value = custom;
    if (question.kind === "single" && custom) value = custom;
    if (question.kind === "multi" && custom) {
      const selected = Array.isArray(value) ? value : [];
      value = [...selected, custom];
    }
    const nextAnswers = { ...answers, [question.id]: value };
    setAnswers(nextAnswers);
    if (step < request.questions.length - 1) {
      const nextQuestion = request.questions[step + 1];
      const nextDraft = answerDraft(nextQuestion, nextAnswers[nextQuestion.id]);
      setStep((current) => current + 1);
      setDraft(nextDraft);
      setNativeTextareaValue(textareaRef.current, nextDraft);
      return;
    }
    await submitAnswers(nextAnswers);
  }, [answers, canAdvance, draft, question, request, step, submitAnswers, submitting, textareaRef]);

  const back = useCallback(() => {
    if (step === 0 || submitting) return;
    const previousQuestion = request?.questions[step - 1];
    if (!previousQuestion) return;
    const previousDraft = answerDraft(previousQuestion, answers[previousQuestion.id]);
    setStep((current) => current - 1);
    setDraft(previousDraft);
    setNativeTextareaValue(textareaRef.current, previousDraft);
  }, [answers, request, step, submitting, textareaRef]);

  return {
    request,
    question,
    answers,
    step,
    draft,
    setDraft,
    submitting,
    error,
    acceptsText,
    canAdvance,
    selectOption,
    advance,
    back
  };
}

type HumanInputFlow = ReturnType<typeof useHumanInputFlow>;

function HumanInputPrompt({ flow }: { flow: HumanInputFlow }) {
  const { request, question } = flow;
  if (!request || !question) return null;
  const selected = flow.answers[question.id];
  const finalStep = flow.step === request.questions.length - 1;

  return (
    <Panel
      aria-labelledby="human-input-title"
      aria-modal="false"
      className="mb-2 overflow-hidden bg-panel-strong shadow-popover"
      role="dialog"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <StatusIcon icon="user" tone="warning" size={14} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground" id="human-input-title">
            {request.header ?? "Input required"}
          </div>
        </div>
        {request.questions.length > 1 ? (
          <Pill tone="warning">{flow.step + 1} / {request.questions.length}</Pill>
        ) : null}
      </div>
      <div className="px-3 py-3">
        <div className="text-sm font-medium leading-5 text-foreground">{question.question}</div>
        {question.options?.length ? (
          <div
            aria-label={question.question}
            className="mt-2.5 grid gap-1.5"
            role={question.kind === "single" ? "radiogroup" : "group"}
          >
            {question.options.map((option) => {
              const isSelected = question.kind === "multi"
                ? Array.isArray(selected) && selected.includes(option.id)
                : selected === option.id;
              return (
                <ChoiceButton
                  description={option.description}
                  disabled={flow.submitting}
                  key={option.id}
                  onClick={() => flow.selectOption(option.id)}
                  selected={isSelected}
                  selectionMode={question.kind === "multi" ? "multiple" : "single"}
                >
                  {option.label}
                </ChoiceButton>
              );
            })}
          </div>
        ) : null}
        {flow.acceptsText ? (
          <div className="mt-2 text-2xs text-muted-foreground">
            {question.placeholder ?? (question.options?.length ? "Or type a custom answer below." : "Type your answer below, then continue.")}
          </div>
        ) : null}
        {flow.error ? <Notice className="mt-2.5" tone="destructive">{flow.error}</Notice> : null}
      </div>
      <div className="flex items-center justify-between border-t border-border bg-panel-raised px-3 py-2">
        <Button disabled={flow.step === 0 || flow.submitting} onClick={flow.back} size="sm" type="button" variant="ghost">
          <Icon name="arrow-left" size={12} />
          Back
        </Button>
        <Button disabled={!flow.canAdvance || flow.submitting} onClick={() => void flow.advance()} size="sm" type="button">
          {flow.submitting ? <Spinner size="xs" /> : null}
          {finalStep ? "Confirm" : "Next"}
          {!finalStep ? <Icon name="arrow-right" size={12} /> : null}
        </Button>
      </div>
    </Panel>
  );
}

function Composer() {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const run = useRunContext();
  const store = useWorkspaceStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const mentionPortalRef = useRef<HTMLDivElement>(null);
  const human = useHumanInputFlow(run.humanInputRequest, textareaRef);
  const activeChat = store.chats.find((chat) => chat.id === store.activeChatId) ?? null;
  const enabledModels = store.models.filter((model) => model.enabled);
  const selectedModelId = typeof activeChat?.metadata?.modelId === "string"
    ? activeChat.metadata.modelId
    : run.pendingModelId ?? enabledModels[0]?.id ?? "";
  const selectedModel = enabledModels.find((model) => model.id === selectedModelId) ?? enabledModels[0] ?? null;
  const selectedEffort: ReasoningEffort = typeof activeChat?.metadata?.reasoningEffort === "string"
    ? activeChat.metadata.reasoningEffort as ReasoningEffort
    : run.pendingReasoningEffort !== "auto"
      ? run.pendingReasoningEffort as ReasoningEffort
      : selectedModel ? capabilitiesForModel(selectedModel).reasoningEffort : "auto";

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionAtIndex, setMentionAtIndex] = useState(-1);

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

  const filteredItems = useMemo(() => {
    if (!mentionQuery) return allItems;
    const q = mentionQuery.toLowerCase();
    return allItems.filter(
      (ref) =>
        ref.title.toLowerCase().includes(q) ||
        ref.kind.toLowerCase().includes(q) ||
        ref.subtitle.toLowerCase().includes(q)
    );
  }, [allItems, mentionQuery]);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionAtIndex(-1);
  }, []);

  const openMention = useCallback((query: string, atIndex: number) => {
    setMentionQuery(query);
    setMentionAtIndex(atIndex);
    setMentionOpen(true);
  }, []);

  const handleComposerKeyUp = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (human.request) return;
    const textarea = event.currentTarget;
    const cursorPos = textarea.selectionStart;
    const state = getTextAroundCursor(textarea.value, cursorPos);
    if (state) {
      openMention(state.query, state.atIndex);
    } else {
      closeMention();
    }
  }, [human.request, openMention, closeMention]);

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (human.request) {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void human.advance();
      }
      return;
    }
    if (mentionOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) {
        event.preventDefault();
        const listbox = mentionPortalRef.current?.querySelector("[role='listbox']");
        if (listbox) {
          listbox.dispatchEvent(new KeyboardEvent("keydown", { key: event.key, bubbles: true }));
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMention();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const form = event.currentTarget.closest("form") as HTMLFormElement | null;
      form?.requestSubmit();
    }
  }, [human, mentionOpen, closeMention]);

  const handleComposerClick = useCallback((event: React.MouseEvent<HTMLTextAreaElement>) => {
    if (human.request) return;
    const textarea = event.currentTarget;
    const cursorPos = textarea.selectionStart;
    const state = getTextAroundCursor(textarea.value, cursorPos);
    if (state) {
      openMention(state.query, state.atIndex);
    } else {
      closeMention();
    }
  }, [human.request, openMention, closeMention]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    if (!human.request) return;
    event.preventDefault();
    void human.advance();
  }, [human]);

  const insertMention = useCallback((ref: ObjectReference) => {
    const textarea = textareaRef.current;
    if (!textarea || mentionAtIndex === -1) return;
    const mention = mentionText(ref);
    const before = textarea.value.substring(0, mentionAtIndex);
    const after = textarea.value.substring(textarea.selectionStart);
    const newValue = `${before}${mention} ${after}`;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, "value"
    )?.set;
    nativeSetter?.call(textarea, newValue);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const pos = mentionAtIndex + mention.length + 1;
    textarea.setSelectionRange(pos, pos);
    textarea.focus();
    closeMention();
  }, [mentionAtIndex, closeMention]);

  useEffect(() => {
    if (!mentionOpen) return;
    function handle(e: MouseEvent) {
      const textarea = textareaRef.current;
      const portal = mentionPortalRef.current;
      const target = e.target as Node;
      if (textarea && portal && !textarea.contains(target) && !portal.contains(target)) {
        closeMention();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [mentionOpen, closeMention]);

  return (
    <ComposerPrimitive.Root className="aui-composer relative flex w-full flex-col gap-1.5" onSubmit={handleSubmit}>
      <HumanInputPrompt flow={human} />
      <ContextChips items={run.contextItems} onRemove={run.removeContext} />
      <div
        ref={composerShellRef}
        data-slot="aui-composer-shell"
        className={cn(
          "flex w-full flex-col gap-1 overflow-hidden rounded-md border bg-panel-raised p-2 shadow-panel transition-colors",
          "border-border focus-within:border-[var(--focus-border)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]"
        )}
      >
        <ComposerPrimitive.Input
          ref={textareaRef}
          autoFocus
          className="min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          enterKeyHint="send"
          disabled={Boolean(human.request && !human.acceptsText)}
          placeholder={human.request
            ? human.question?.placeholder ?? (human.acceptsText ? "Type your answer…" : "Choose an option above")
            : "Message the team… (type @ to mention)"}
          rows={1}
          onChange={(event) => {
            if (human.request) human.setDraft(event.currentTarget.value);
          }}
          onClick={handleComposerClick}
          onKeyDown={handleComposerKeyDown}
          onKeyUp={handleComposerKeyUp}
        />
        <div className="flex items-center justify-between px-1">
          {human.request ? (
            <Pill tone="warning"><Icon name="user" size={10} /> Awaiting input</Pill>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <ComposerAddContext count={run.contextItems.length} />
              {enabledModels.length > 0 ? (
                <ChatModelPicker
                  models={enabledModels}
                  onChange={(modelId) => {
                    if (activeChat) {
                      void store.updateChatMetadata(activeChat.id, { modelId });
                    } else {
                      run.setPendingModelId(modelId);
                      const model = enabledModels.find((entry) => entry.id === modelId);
                      if (model) run.setPendingReasoningEffort(capabilitiesForModel(model).reasoningEffort);
                    }
                  }}
                  value={selectedModelId}
                />
              ) : null}
              {selectedModel ? (
                <ReasoningEffortControl
                  onChange={(reasoningEffort) => {
                    if (activeChat) {
                      void store.updateChatMetadata(activeChat.id, { reasoningEffort });
                    } else {
                      run.setPendingReasoningEffort(reasoningEffort);
                    }
                  }}
                  running={isRunning}
                  value={selectedEffort}
                />
              ) : null}
            </div>
          )}
          {human.request ? (
            human.acceptsText ? (
              <Button
                aria-label={human.step === human.request.questions.length - 1 ? "Confirm answer" : "Next question"}
                disabled={!human.canAdvance || human.submitting}
                onClick={() => void human.advance()}
                size="icon"
                type="button"
              >
                <Icon name={human.step === human.request.questions.length - 1 ? "check" : "arrow-right"} size={16} />
              </Button>
            ) : <span />
          ) : isRunning ? <ComposerCancel /> : <ComposerSend />}
        </div>
      </div>
      {!human.request && mentionOpen && composerShellRef.current && createPortal(
        <div
          ref={mentionPortalRef}
          className="fixed z-50"
          style={{
            bottom: window.innerHeight - composerShellRef.current.getBoundingClientRect().top + 4,
            left: composerShellRef.current.getBoundingClientRect().left + 8,
            width: Math.min(composerShellRef.current.getBoundingClientRect().width - 16, 320)
          }}
        >
          <MentionDropdown
            items={filteredItems}
            onSelect={insertMention}
            searchQuery={mentionQuery}
          />
        </div>,
        document.body
      )}
    </ComposerPrimitive.Root>
  );
}

function MessageError() {
  return (
    <Notice className="mt-1.5" tone="destructive">
      Something went wrong. Try again.
    </Notice>
  );
}

function ActionBar() {
  return (
    <ActionBarPrimitive.Root className="flex items-center gap-0.5">
      <ActionBarPrimitive.Copy asChild>
        <Tooltip content="Copy" side="top">
          <Button aria-label="Copy" icon="copy" size="icon-xs" variant="ghost" />
        </Tooltip>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <Tooltip content="Regenerate" side="top">
          <Button aria-label="Regenerate" icon="refresh" size="icon-xs" variant="ghost" />
        </Tooltip>
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.Edit asChild>
        <Tooltip content="Edit" side="top">
          <Button aria-label="Edit" icon="edit" size="icon-xs" variant="ghost" />
        </Tooltip>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
}

function EditComposer() {
  return (
    <MessagePrimitive.Root className="grid w-full grid-cols-[1fr_auto] gap-x-3 overflow-hidden">
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input className="min-h-9 w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground outline-none" />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <ComposerPrimitive.Cancel asChild>
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">
              Save
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function MentionText({ text }: { text: string }) {
  const segments = useMemo(() => {
    const result: Array<{ type: "text"; text: string } | { type: "mention"; label: string; kind: string; id: string }> = [];
    const regex = /@\[([^\]]+)\]\(spielos:\/\/(\w+)\/([^)]+)\)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: "text", text: text.slice(lastIndex, match.index) });
      }
      result.push({ type: "mention", label: match[1], kind: match[2], id: match[3] });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      result.push({ type: "text", text: text.slice(lastIndex) });
    }

    return result;
  }, [text]);

  return (
    <>
      {segments.map((segment, i) =>
        segment.type === "mention" ? (
          <span
            className="inline-flex items-center gap-1 rounded bg-selected px-1.5 py-0.5 text-xs font-medium text-foreground-strong"
            key={`m-${i}`}
          >
            <Icon name="at" size={10} />
            {segment.label}
          </span>
        ) : (
          <span key={`t-${i}`}>{segment.text}</span>
        )
      )}
    </>
  );
}

function UserMessageText() {
  const { text } = useMessagePartText();
  return (
    <span className="text-sm leading-7 text-foreground">
      <MentionText text={text} />
    </span>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="group fade-in slide-in-from-bottom-1 relative grid w-full grid-cols-[1fr_auto] gap-x-3 animate-in duration-[var(--duration)]">
      <div className="min-w-0 max-w-[85%] overflow-hidden rounded-md bg-panel-strong px-3 py-2 text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Parts components={{ Text: UserMessageText }} />
        <div className="mt-1.5 flex items-center justify-end gap-1 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100">
          <ActionBar />
        </div>
      </div>
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
        <Icon className="scale-x-[-1]" name={ENTITY_ICONS.profile} size={14} />
      </div>
    </MessagePrimitive.Root>
  );
}

function MarkdownPart() {
  const { text } = useMessagePartText();

  return (
    <ReactMarkdown
      className="prose-chat min-w-0 max-w-full text-sm leading-7 text-foreground"
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="mb-3 mt-1 text-2xl font-semibold leading-tight text-foreground-strong">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold leading-tight text-foreground-strong">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold leading-snug text-foreground-strong">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold leading-snug text-foreground-strong">{children}</h4>,
        p: ({ children }) => <p className="my-2 text-sm leading-7 text-foreground">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-foreground-strong">{children}</strong>,
        em: ({ children }) => <em className="italic text-foreground">{children}</em>,
        ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 text-sm leading-6">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 text-sm leading-6">{children}</ol>,
        li: ({ children }) => <li className="pl-1 text-foreground">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">{children}</blockquote>
        ),
        a: ({ children, href }) => (
          <a className="font-medium text-foreground-strong underline underline-offset-4" href={href} rel="noreferrer" target="_blank">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-3 max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-border bg-panel-raised px-2 py-1.5 font-semibold text-foreground-strong">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1.5 align-top text-foreground">{children}</td>,
        code: ({ children }) => (
          <code className="rounded-sm border border-border bg-panel-raised px-1 py-0.5 font-mono text-xs text-foreground">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-3 overflow-auto rounded-md border border-border bg-panel-raised p-3 text-xs leading-5">
            {children}
          </pre>
        )
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function RoleAvatar({ roleId, roleName }: { roleId: string; roleName: string }) {
  const store = useWorkspaceStore();
  const role = store.roles.find((entry) => entry.id === roleId);
  const configuredIcon = role?.metadata?.icon;
  const initials = roleName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <div
      aria-label={roleName}
      className="flex h-7 w-7 items-center justify-center rounded-md bg-selected text-3xs font-semibold text-foreground-strong"
      title={roleName}
    >
      {typeof configuredIcon === "string" ? <Icon name={configuredIcon} size={14} /> : initials || <Icon name={ENTITY_ICONS.assistant} size={14} />}
    </div>
  );
}

function RunActivityTimeline() {
  const run = useRunContext();
  if (run.runType === "chat") {
    if (!run.running) return null;
    const nativeActivity = [...orderRunEvents(run.events)].reverse().find(isStartEvent);
    return (
      <div className="mb-2 flex h-6 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <StatusIcon busy icon="circle-dot" tone="info" size={12} />
        {nativeActivity?.message ? <span>{nativeActivity.message}</span> : <span className="sr-only">Response in progress</span>}
      </div>
    );
  }
  if (run.running && run.events.length === 0) {
    return (
      <div className="mb-2 flex h-6 items-center" aria-live="polite">
        <StatusIcon busy icon="circle-dot" tone="info" size={12} />
        <span className="sr-only">Waiting for runtime events</span>
      </div>
    );
  }
  if (run.events.length === 0 && run.status === "idle") return null;

  const items = compactRunEvents(run.events);
  const activeItemId = run.running
    ? [...items].reverse().find(isStartEvent)?.id
    : null;

  if (items.length === 0) return null;

  return (
    <div className="mb-3 text-xs" aria-live="polite">
      <div className="ml-[5px] border-l border-border/70 pl-4">
          {items.map((event) => {
          const active = event.id === activeItemId;

          if (event.type === "tool_call_started" || event.type === "tool_call_result") {
            return <ToolCallCard active={active} event={event} key={event.id} />;
          }

          const failed = isFailureEvent(event);
          const waiting = isWaitingEvent(event);
          const success = isSuccessEvent(event);
          const tone = failed ? "destructive" : waiting ? "warning" : success ? "success" : active ? "info" : "neutral";
          const icon = runtimeEventIcon(event, EVENT_ICONS[event.type as keyof typeof EVENT_ICONS]);
          return (
            <div className="flex min-h-6 min-w-0 items-center gap-2 py-0.5 text-2xs" key={event.id}>
              <StatusIcon busy={active} icon={icon} tone={tone} size={11} />
              <span className={cn(
                "min-w-0 truncate text-muted-foreground",
                active && "text-foreground",
                failed && "text-destructive",
                waiting && "text-warning"
              )}>
                {event.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineRunArtifacts({ artifacts }: { artifacts: Artifact[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (artifacts.length === 0) return null;
  return (
    <section aria-label="Generated files" className="mt-3 grid gap-1.5">
      <div className="flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon name="layers" size={10} />
        Generated files
        <span className="tabular-nums">{artifacts.length}</span>
      </div>
      {artifacts.map((artifact) => {
        const expanded = expandedId === artifact.id;
        return (
          <article className="overflow-hidden rounded-md border border-border bg-panel" key={artifact.id}>
            <button
              aria-expanded={expanded}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-hover"
              onClick={() => setExpandedId(expanded ? null : artifact.id)}
              type="button"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel-raised text-info">
                <Icon name="file-text" size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{artifact.title}</span>
                <span className="mt-0.5 block text-3xs text-muted-foreground">Saved to Outputs · {artifact.body.length.toLocaleString()} characters</span>
              </span>
              <Pill className="uppercase tracking-wider">{artifact.type}</Pill>
              <Icon className={cn("text-muted-foreground transition-transform", expanded && "rotate-180")} name="chevron-down" size={12} />
            </button>
            {expanded ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border bg-panel-raised p-3 text-xs leading-5 text-foreground">
                {artifact.body}
              </pre>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function AssistantMessage() {
  const run = useRunContext();
  const isLatest = useAuiState((s) => s.thread.messages.at(-1)?.id === s.message.id);
  const actor = isLatest && run.running ? run.activeActor : null;
  return (
    <MessagePrimitive.Root className="group fade-in slide-in-from-bottom-1 relative grid w-full grid-cols-[auto_1fr] gap-x-3 animate-in duration-[var(--duration)]">
      {actor ? <RoleAvatar roleId={actor.roleId} roleName={actor.roleName} /> : (
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-panel-raised text-foreground">
          <Icon name={ENTITY_ICONS.assistant} size={14} />
        </div>
      )}
      <div className="min-w-0 overflow-hidden leading-relaxed">
        <div className="flex items-center gap-2 text-2xs font-medium text-muted-foreground">
          <span>{actor?.roleName ?? "Assistant"}</span>
        </div>
        <div className="mt-1">
          {isLatest ? <RunActivityTimeline /> : null}
          <MessagePrimitive.Parts components={{ Text: MarkdownPart }} />
          {isLatest ? <InlineRunArtifacts artifacts={run.artifacts} /> : null}
        </div>
        <div className="mt-2 flex items-center gap-1 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100">
          <ActionBar />
        </div>
        <MessagePrimitive.Error>
          <MessageError />
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
}

function ContinuationResponse() {
  const run = useRunContext();
  if (!run.continuationText) return null;
  return (
    <div className="grid w-full grid-cols-[auto_1fr] gap-x-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-panel-raised text-foreground">
        <Icon name={ENTITY_ICONS.assistant} size={14} />
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-2xs font-medium text-muted-foreground">Assistant</div>
        <ReactMarkdown className="prose-chat text-sm leading-7 text-foreground" remarkPlugins={[remarkGfm]}>
          {run.continuationText}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function Message() {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => Boolean(s.message.composer?.isEditing));
  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  if (role === "system") return <AssistantMessage />;
  return <AssistantMessage />;
}

function WelcomeScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-selected text-foreground-strong">
        <Icon name={CONTEXT_ICON} size={18} />
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        How can I help?
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Ask a question or start a conversation. Attach a role, skill, file, eval, or workflow only when you want the assistant to use it.
      </p>
      <div className="mt-6 max-w-md space-y-2">
        <p className="text-sm text-muted-foreground">
          Press <kbd className="rounded border border-border bg-panel-raised px-1.5 py-0.5 font-mono text-3xs">⌘K</kbd> to explore the workspace.
        </p>
      </div>
    </div>
  );
}

function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const adapter = useSpielosChatAdapter();
  const store = useWorkspaceStore();
  const initialMessages = useMemo<ThreadMessageLike[]>(() => {
    if (!store.activeChatId) return [];
    return (store.messages[store.activeChatId] ?? []).map((message) => ({
      id: message.id,
      role: message.role === "tool" ? "assistant" : message.role,
      content: message.body,
      createdAt: new Date(message.createdAt)
    }));
  }, [store.activeChatId, store.messages]);
  const runtime = useLocalRuntime(adapter, { initialMessages });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function ChatThreadInner() {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const pathname = usePathname();
  const isDedicatedRunPage = pathname.startsWith("/runs/");
  const restoredChatId = useRef<string | null>(null);
  const restoreStoreRef = useRef(store);
  const restoreRunRef = useRef(run);
  restoreStoreRef.current = store;
  restoreRunRef.current = run;
  const activeChatId = store.activeChatId;
  const updateChatMetadata = store.updateChatMetadata;
  const isEmpty = useAuiState(
    (s) => s.thread.messages.length === 0 && !s.thread.isRunning
  );

  useEffect(() => {
    const currentStore = restoreStoreRef.current;
    const currentRun = restoreRunRef.current;
    const active = currentStore.chats.find((chat) => chat.id === activeChatId) ?? null;
    const saved = Array.isArray(active?.metadata?.contextItems)
      ? active.metadata.contextItems.filter((item): item is import("../../lib/run-context").ContextItem => {
          if (!item || typeof item !== "object") return false;
          const value = item as Record<string, unknown>;
          return typeof value.id === "string" && typeof value.kind === "string" && typeof value.title === "string";
        })
      : [];
    currentRun.setContextItems(saved);
    restoredChatId.current = active?.id ?? null;
    const activeRunId = typeof active?.metadata?.activeRunId === "string" ? active.metadata.activeRunId : null;
    const lastRunId = typeof active?.metadata?.lastRunId === "string" ? active.metadata.lastRunId : null;
    const restorableRunId = activeRunId ?? lastRunId;
    currentRun.setDurableState(null);
    currentRun.setLiveUsage(null);
    currentRun.clearEvents();
    currentRun.clearArtifacts();

    // The restoration fetch owns its own AbortController. Cleanup aborts
    // any in-flight request when the chat identity changes again so a
    // stale response cannot replace fresher state.
    const restorationController = new AbortController();
    let debounceTimer: number | null = null;
    const performRestore = (runId: string) => {
      currentRun.setActiveRunId(runId);
      fetch(`/api/runs/${runId}`, { cache: "no-store", signal: restorationController.signal })
        .then((response) => response.ok ? response.json() : null)
        .then((payload: null | { run: { type: string; status: RunStatus; state: Record<string, unknown> }; events: Array<{ id: string; org_id: string; run_id: string; event_type: string; sequence: number; node_id: string | null; node_title: string | null; skill_id: string | null; skill_name: string | null; message: string; payload: Record<string, unknown>; created_at: string }>; artifacts: import("@spielos/core").Artifact[] }) => {
          if (!payload) return;
          const latestStore = restoreStoreRef.current;
          const latestRun = restoreRunRef.current;
          if (latestStore.activeChatId !== activeChatId) return;
          if (latestRun.activeRunId && latestRun.activeRunId !== runId) return;
          latestRun.setRunType(payload.run.type as import("@spielos/core").RunType);
          latestRun.setRunStatus(payload.run.status);
          latestRun.setDurableState(payload.run.state as import("../../lib/run-context").DurableRunState);
          const restoredBudget = (payload.run.state as import("../../lib/run-context").DurableRunState).budget;
          latestRun.setLiveUsage(restoredBudget ? {
            inputTokens: restoredBudget.inputTokens,
            outputTokens: restoredBudget.outputTokens,
            toolCalls: restoredBudget.toolCalls
          } : null);
          const pending = payload.run.state?.pendingHumanInput;
          latestRun.setHumanInputRequest(pending && typeof pending === "object" ? pending as HumanInputRequest : null);
          for (const event of payload.events) {
            latestRun.appendEvent({
              id: event.id, orgId: event.org_id, runId: event.run_id, type: event.event_type as RunEvent["type"], sequence: Number(event.sequence),
              nodeId: event.node_id ?? undefined, nodeTitle: event.node_title ?? undefined, skillId: event.skill_id ?? undefined, skillName: event.skill_name ?? undefined,
              message: event.message, payload: event.payload ?? {}, createdAt: event.created_at
            });
          }
          for (const artifact of payload.artifacts) latestRun.appendArtifact(artifact);
        })
        .catch((err: unknown) => {
          // AbortError is the normal cleanup path; ignore it. Other errors
          // (network, parse) are also swallowed — the chat simply starts
          // with no restored run.
          if (err instanceof DOMException && err.name === "AbortError") return;
        });
    };

    if (restorableRunId && !isDedicatedRunPage) {
      // Debounce the restore on the home page so rapid chat switches do
      // not fire a flood of /api/runs/:id calls. The dedicated run page
      // restores immediately because the URL is the run's identity.
      if (isDedicatedRunPage) {
        performRestore(restorableRunId);
      } else {
        debounceTimer = window.setTimeout(() => {
          debounceTimer = null;
          performRestore(restorableRunId);
        }, 200);
      }
    }
    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      restorationController.abort();
    };
  // Restore only when the durable chat identity changes.
  }, [activeChatId, isDedicatedRunPage]);

  useEffect(() => {
    if (!activeChatId || restoredChatId.current !== activeChatId) return;
    const timer = window.setTimeout(() => {
      void updateChatMetadata(activeChatId, { contextItems: run.contextItems });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeChatId, run.contextItems, updateChatMetadata]);

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
        turnAnchor="top"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-8 pt-6">
          {isEmpty ? <WelcomeScreen /> : null}
          <div className="flex flex-col gap-4">
            <ThreadPrimitive.Messages>
              {() => (
                <div className="flex flex-col gap-4">
                  <Message />
                </div>
              )}
            </ThreadPrimitive.Messages>
            <ContinuationResponse />
          </div>
        </div>
      </ThreadPrimitive.Viewport>
      <div className="pointer-events-none shrink-0 bg-transparent px-0 pt-6">
        <div className="pointer-events-auto mx-auto w-full max-w-3xl px-4 pb-3">
          <Composer />
          <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              {run.contextItems.length > 0 ? (
                <span>
                  {run.contextItems.length} attached · {run.events.length} events
                </span>
              ) : (
                <span>0 attached</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-panel-raised px-1 py-0.5 font-mono text-3xs">↵</kbd>
              <span className="text-3xs">send ·</span>
              <kbd className="rounded border border-border bg-panel-raised px-1 py-0.5 font-mono text-3xs">⇧↵</kbd>
              <span className="text-3xs">newline</span>
            </div>
          </div>
        </div>
      </div>
      <ContextPicker />
    </ThreadPrimitive.Root>
  );
}

export function ChatThread() {
  const store = useWorkspaceStore();
  return (
    <ChatRuntimeProvider key={store.activeChatId ?? "new-chat"}>
      <ChatThreadInner />
    </ChatRuntimeProvider>
  );
}
