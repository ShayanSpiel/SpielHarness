"use client";

import { CONTEXT_ICON, ENTITY_ICONS, Icon } from "@spielos/design-system/components";
import { Spinner } from "@spielos/design-system";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  useMessagePartText
} from "@assistant-ui/react";
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
import { ArtifactFullscreenButton, ArtifactWorkbench } from "./artifact-workbench";
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
import { useRuntimeAdapter } from "../../lib/external-store-adapter";
import { consumeSseStream } from "../../lib/sse-stream-consumer";
import { useRuntimeStore } from "../../lib/runtime-store";
import { useDomainStore } from "../../lib/use-domain-store";
import { useUiStore } from "../../lib/use-ui-store";
import { buildObjectReferences, mentionText, type ObjectReference } from "../../lib/object-references";
import { getTextAroundCursor } from "../mention-textarea";
import { MentionDropdown } from "../mention-dropdown";
import { ContextChips } from "./context-chips";
import { ContextPicker } from "./context-picker";
import { MarkdownContent } from "./markdown-content";
import { capabilitiesForModel, type Artifact, type ExecutionMode, type HumanInputQuestion, type HumanInputRequest, type RunEvent, type RunStatus } from "@spielos/core";
import { ReasoningEffortControl, type ReasoningEffort } from "../reasoning-effort-control";
import { ChatModelPicker } from "../chat-model-picker";
import {
  compactRunEvents,
  isFailureEvent,
  isStartEvent,
  isSuccessEvent,
  isWaitingEvent,
  orderRunEvents,
  runtimeEventIcon,
} from "../../lib/run-events";

function ComposerAddContext({ count }: { count: number }) {
  return (
    <Button
      aria-label="Open context deck"
      icon={CONTEXT_ICON}
      onClick={() => useRuntimeStore.getState().setPickerOpen(true)}
      size="sm"
      type="button"
      variant="subtle"
    >
      Context
      <Pill className="ms-0.5 h-4 text-3xs" tone={count > 0 ? "info" : "default"}>{count}</Pill>
    </Button>
  );
}

type ActiveProjectMetadata = {
  id: string;
  title: string;
  workflowId: string | null;
  artifactId: string | null;
  status: string;
};

function readActiveProject(value: unknown): ActiveProjectMetadata | null {
  if (!value || typeof value !== "object") return null;
  const project = value as Record<string, unknown>;
  if (typeof project.id !== "string" || typeof project.title !== "string") return null;
  return {
    id: project.id,
    title: project.title,
    workflowId: typeof project.workflowId === "string" ? project.workflowId : null,
    artifactId: typeof project.artifactId === "string" ? project.artifactId : null,
    status: typeof project.status === "string" ? project.status : "active"
  };
}

function ActiveProjectChip() {
  const activeChatId = useRuntimeStore((s) => s.activeChatId);
  const chats = useRuntimeStore((s) => s.chats);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const project = readActiveProject(activeChat?.metadata?.activeProject);
  const store = useRuntimeStore.getState();
  if (!project) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Active project">
      <Pill tone="info"><Icon name="layers" size={10} /> {project.title}</Pill>
      <span className="text-3xs text-muted-foreground">{project.artifactId ? "Revision mode" : project.status}</span>
      {project.workflowId ? (
        <Button
          onClick={() => store.addContext({ id: project.workflowId!, kind: "workflow", title: `Run ${project.title} again` })}
          size="sm"
          type="button"
          variant="ghost"
        >
          Run again
        </Button>
      ) : null}
      <Button
        onClick={() => {
          void store.createChat("New project");
          store.resetRun();
          store.clearContext();
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        New project
      </Button>
    </div>
  );
}

function ComposerSend() {
  const empty = useAuiState((s) => s.composer.isEmpty);
  const disabled = empty;
  const tooltip = empty ? "Type a message" : "Send";
  return (
    <Tooltip content={tooltip} side="top">
      <ComposerPrimitive.Send asChild>
        <Button
          aria-label="Send message"
          disabled={disabled}
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
        <Button aria-label="Stop generating" size="icon" type="button">
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
    const store = useRuntimeStore.getState();
    const activeRunId = store.activeRunId;
    if (!request || !activeRunId) return;
    setSubmitting(true);
    setError(null);
    const generationId = crypto.randomUUID();
    store.dispatch({ type: "human_input_submitted", runId: activeRunId, generationId });
    store.setActivity("Saving input and resuming the workflow\u2026");
    const chatId = store.activeChatId;
    let responseStarted = false;
    try {
      const response = await fetch(`/api/runs/${activeRunId}/reply`, {
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

      responseStarted = true;
      store.setActivity("Resuming from the durable checkpoint\u2026");
      clearDraft();

      await consumeSseStream(response, generationId, {
        onText: (text, runId) => {
          if (chatId) useRuntimeStore.getState().appendStreamText(chatId, runId, generationId, text);
        },
      });

      const finalStatus = useRuntimeStore.getState().runStatus;
      if (!finalStatus || finalStatus === "failed") {
        useRuntimeStore.getState().setRunStatus("failed");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to resume the run.";
      setError(message);
      if (responseStarted) {
        useRuntimeStore.getState().setRunStatus("failed");
      } else {
        useRuntimeStore.getState().setHumanInputRequest(request);
        useRuntimeStore.getState().setRunStatus("waiting_human");
      }
      toast.error("The run could not continue", { description: message });
    } finally {
      setSubmitting(false);
    }
  }, [clearDraft, request]);

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
        {request.questions.length > 1 ? (
          <ol aria-label="Question progress" className="mb-3 flex items-center">
            {request.questions.map((item, index) => {
              const completed = index < flow.step;
              const current = index === flow.step;
              return (
                <li className="flex min-w-0 flex-1 items-center last:flex-none" key={item.id}>
                  <span
                    aria-current={current ? "step" : undefined}
                    aria-label={`Step ${index + 1}: ${item.question}`}
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-3xs font-semibold tabular-nums transition-colors",
                      completed && "border-primary bg-primary text-primary-foreground",
                      current && "border-primary bg-panel-strong text-primary",
                      !completed && !current && "border-border bg-panel-raised text-muted-foreground"
                    )}
                  >
                    {completed ? <Icon name="check" size={11} /> : index + 1}
                  </span>
                  {index < request.questions.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className={cn("mx-1.5 h-px min-w-3 flex-1 bg-border", completed && "bg-primary")}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
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
  const runStatus = useRuntimeStore((s) => s.runStatus);
  const activeRunId = useRuntimeStore((s) => s.activeRunId);
  const humanInputRequest = useRuntimeStore((s) => s.humanInputRequest);
  const contextItems = useRuntimeStore((s) => s.contextItems);
  const pendingModelId = useRuntimeStore((s) => s.pendingModelId);
  const pendingReasoningEffort = useRuntimeStore((s) => s.pendingReasoningEffort);
  const pendingExecutionMode = useRuntimeStore((s) => s.pendingExecutionMode);
  const activeChatId = useRuntimeStore((s) => s.activeChatId);
  const chats = useRuntimeStore((s) => s.chats);
  const { models: domainModels } = useDomainStore();
  const terminal = runStatus === "failed" || runStatus === "cancelled" || runStatus === "completed";
  const durablyRunning = !terminal && (isRunning || (runStatus === "running" && Boolean(activeRunId)));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const mentionPortalRef = useRef<HTMLDivElement>(null);
  const human = useHumanInputFlow(humanInputRequest, textareaRef);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const enabledModels = domainModels.filter((model) => model.enabled);
  const selectedModelId = typeof activeChat?.metadata?.modelId === "string"
    ? activeChat.metadata.modelId
    : pendingModelId ?? enabledModels[0]?.id ?? "";
  const selectedModel = enabledModels.find((model) => model.id === selectedModelId) ?? enabledModels[0] ?? null;
  const selectedEffort: ReasoningEffort = typeof activeChat?.metadata?.reasoningEffort === "string"
    ? activeChat.metadata.reasoningEffort as ReasoningEffort
    : pendingReasoningEffort !== "auto"
      ? pendingReasoningEffort as ReasoningEffort
      : selectedModel ? capabilitiesForModel(selectedModel).reasoningEffort : "auto";
  const executionMode: ExecutionMode = typeof activeChat?.metadata?.executionMode === "string"
    ? activeChat.metadata.executionMode as ExecutionMode
    : pendingExecutionMode as ExecutionMode;

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionAtIndex, setMentionAtIndex] = useState(-1);

  const domainStore = useDomainStore();
  const allItems = useMemo(
    () => buildObjectReferences({
      items: domainStore.items,
      roles: domainStore.roles,
      skills: domainStore.skills,
      evalFiles: domainStore.evalFiles,
      workstreams: domainStore.workflows
    }),
    [domainStore.items, domainStore.roles, domainStore.skills, domainStore.evalFiles, domainStore.workflows]
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
    // Normal Enter submission is handled by ComposerPrimitive internally.
    // We must NOT call form.requestSubmit() here — that would trigger
    // a second onNew call via assistant-ui's form submit handler.
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
    if (human.request) {
      // Human-input: prevent page navigation and advance the flow.
      event.preventDefault();
      void human.advance();
    }
    // Normal chat: let assistant-ui's ComposerPrimitive handle submission.
    // Calling event.preventDefault() here would prevent ComposerPrimitive
    // from processing the submit, which breaks Enter-key sending.
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
      <ActiveProjectChip />
      <ContextChips items={contextItems} onRemove={(id) => useRuntimeStore.getState().removeContext(id)} isSuggestion={executionMode === "director"} />
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
              <ComposerAddContext count={contextItems.length} />
              <Tooltip content={executionMode === "director" ? "Switch to direct mode" : "Switch to director mode"}>
                <Button
                  aria-label="Toggle Director mode"
                  icon="intellect"
                  onClick={() => {
                    const next = executionMode === "director" ? "direct" : "director";
                    if (activeChat) {
                      void useRuntimeStore.getState().updateChatMetadata(activeChat.id, { executionMode: next });
                    }
                    useRuntimeStore.getState().setPendingExecutionMode(next);
                  }}
                  size="sm"
                  type="button"
                  variant={executionMode === "director" ? "primary" : "subtle"}
                >
                  {executionMode === "director" ? "Director" : "Direct"}
                </Button>
              </Tooltip>
              {enabledModels.length > 0 ? (
                <ChatModelPicker
                  models={enabledModels}
                  onChange={(modelId) => {
                    const store = useRuntimeStore.getState();
                    if (activeChat) {
                      void store.updateChatMetadata(activeChat.id, { modelId });
                    } else {
                      store.setPendingModelId(modelId);
                      const model = enabledModels.find((entry: { id: string }) => entry.id === modelId);
                      if (model) store.setPendingReasoningEffort(capabilitiesForModel(model).reasoningEffort);
                    }
                  }}
                  value={selectedModelId}
                />
              ) : null}
              {selectedModel ? (
                <ReasoningEffortControl
                  onChange={(reasoningEffort) => {
                    const store = useRuntimeStore.getState();
                    if (activeChat) {
                      void store.updateChatMetadata(activeChat.id, { reasoningEffort });
                    } else {
                      store.setPendingReasoningEffort(reasoningEffort);
                    }
                  }}
                  running={durablyRunning}
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
          ) : durablyRunning ? <ComposerCancel /> : <ComposerSend />}
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
    <MessagePrimitive.Root className="group relative grid w-full grid-cols-[1fr_auto] gap-x-3">
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
  return <MarkdownContent text={text} />;
}

function RoleAvatar({ roleId, roleName }: { roleId: string; roleName: string }) {
  const { roles } = useDomainStore();
  const role = roles.find((entry) => entry.id === roleId);
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

type RunActivitySnapshot = {
  runType: import("@spielos/core").RunType | null;
  status: import("../../lib/run-context").RunLifecycleStatus;
  running: boolean;
  activity: string | null;
  events: RunEvent[];
};

function RunActivityTimeline({ snapshot }: { snapshot?: RunActivitySnapshot } = {}) {
  const runType = useRuntimeStore((s) => s.runType);
  const runStatus = useRuntimeStore((s) => s.runStatus);
  const activity = useRuntimeStore((s) => s.activity);
  const events = useRuntimeStore((s) => s.events);
  const ui = useUiStore();
  const current: RunActivitySnapshot = snapshot ?? {
    runType,
    status: runStatus,
    running: runStatus === "running",
    activity,
    events
  };
  const terminalProblem = current.status === "failed" || current.status === "cancelled";
  const ordered = orderRunEvents(current.events);
  if (!current.running && current.status !== "waiting_human" && current.events.length === 0 && !terminalProblem) return null;
  const latestNativeActivity = [...ordered].reverse().find(isStartEvent);
  const latestTerminal = [...ordered].reverse().find((event) =>
    event.type === "run_completed" || event.type === "run_failed" || event.type === "run_cancelled"
  );
  const latestPlan = [...ordered].reverse().find((event) =>
    event.payload?.category === "planning" && Array.isArray(event.payload?.todos)
  );
  const todos = (Array.isArray(latestPlan?.payload?.todos) ? latestPlan.payload.todos : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const todo = item as Record<string, unknown>;
    const content = typeof todo.content === "string" ? todo.content.trim() : "";
    if (!content) return [];
    return [{ content, status: typeof todo.status === "string" ? todo.status : "pending" }];
  });
  const message = current.status === "failed"
    ? "Run failed."
    : current.status === "cancelled"
      ? "Run cancelled."
      : current.status === "waiting_human"
    ? "Waiting for approval…"
    : current.running
      ? current.activity ?? latestNativeActivity?.message ?? "Thinking…"
      : latestTerminal?.message ?? current.activity ?? "Completed.";
  const recentActivity = compactRunEvents(ordered)
    .filter((event) => event.message !== message)
    .slice(-3);
  return (
    <div className="mb-2 max-w-xl" aria-live="polite">
      <button
        aria-expanded={ui.inspectorOpen && ui.inspectorSection === "events"}
        aria-label={`${message} Open run events`}
        className="group flex h-8 w-full items-center gap-2 px-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => ui.openInspector("events")}
        type="button"
      >
        <StatusIcon
          busy={current.running}
          icon={current.status === "waiting_human" ? "user" : current.status === "failed" ? "x" : current.status === "cancelled" ? "square" : current.running ? "circle-dot" : "check"}
          tone={current.status === "failed" ? "destructive" : current.status === "waiting_human" ? "warning" : current.running ? "info" : "success"}
          size={12}
        />
        <span className="min-w-0 flex-1 truncate text-start font-medium">{message}</span>
        {current.events.length > 0 ? <span className="text-3xs opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60">{current.events.length}</span> : null}
        <Icon className="opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100" name={ui.inspectorOpen && ui.inspectorSection === "events" ? "chevron-down" : "chevron-right"} size={11} />
      </button>
      {recentActivity.length > 0 ? (
        <ol aria-label="Recent run activity" className="ms-1.5 border-s border-border ps-3 pb-1">
          {recentActivity.map((event) => {
            const failure = isFailureEvent(event);
            const success = isSuccessEvent(event);
            const waiting = isWaitingEvent(event);
            return (
              <li key={event.id}>
                <button
                  aria-label={`${event.message} Open event inspector`}
                  className="group flex min-h-6 w-full min-w-0 items-center gap-2 text-start text-2xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => ui.openInspector("events")}
                  type="button"
                >
                  <Icon
                    className={cn(
                      "shrink-0",
                      failure ? "text-destructive" : success ? "text-success" : waiting ? "text-warning" : "text-muted-foreground"
                    )}
                    name={failure ? "x" : success ? "check" : waiting ? "user" : runtimeEventIcon(event)}
                    size={9}
                  />
                  <span className="min-w-0 flex-1 truncate">{event.message}</span>
                  {event.nodeTitle ? <span className="hidden max-w-36 shrink-0 truncate text-3xs opacity-50 sm:block">{event.nodeTitle}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
      {todos.length > 0 && !terminalProblem ? (
        <ol className="pl-5 py-1.5">
          {todos.map((todo, index) => {
            const complete = todo.status === "completed";
            const active = todo.status === "in_progress";
            return (
              <li className="flex min-w-0 items-start gap-2 py-0.5 text-2xs" key={`${index}:${todo.content}`}>
                <Icon className={cn("mt-0.5 shrink-0", complete ? "text-success" : active ? "text-info" : "text-muted-foreground")} name={complete ? "check" : active ? "circle-dot" : "square"} size={10} />
                <span className={cn("min-w-0 text-muted-foreground", active && "font-medium text-foreground", complete && "text-muted-foreground line-through")}>{todo.content}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function ContextCleanupBoundary({ events }: { events: RunEvent[] }) {
  const cleanup = [...orderRunEvents(events)].reverse().find((event) =>
    event.type === "status" && event.payload?.category === "compaction"
  );
  if (!cleanup) return null;
  const summary = typeof cleanup.payload?.summary === "string" ? cleanup.payload.summary.trim() : "";
  return (
    <section aria-label="Context cleanup summary" className="mb-3 max-w-xl">
      <div className="flex items-center gap-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <Icon className="text-info" name="archive" size={11} />
        <span>Context cleaned up</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {summary ? (
        <div className="mt-2 rounded-md border border-border bg-panel-raised px-3 py-2.5">
          <div className="mb-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</div>
          <div className="text-xs text-foreground">
            <MarkdownContent text={summary} />
          </div>
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2 text-3xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>Conversation continues</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </section>
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
            <div className="flex items-center transition-colors hover:bg-hover">
              <button
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-start"
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
                <Icon className={cn("text-muted-foreground transition-transform", expanded && "rotate-180")} name="chevron-down" size={12} />
              </button>
              <div className="me-2 shrink-0">
                <ArtifactFullscreenButton artifact={artifact} />
              </div>
            </div>
            {expanded ? (
              <div className="border-t border-border">
                <ArtifactWorkbench artifact={artifact} compact />
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

type PersistedRunSnapshot = {
  type: import("@spielos/core").RunType;
  status: RunStatus;
  events: RunEvent[];
  artifacts: Artifact[];
};

function toPersistedRunSnapshot(payload: {
  run: { type: string; status: RunStatus };
  events: Array<{
    id: string;
    org_id: string;
    run_id: string;
    event_type: string;
    sequence: number;
    node_id: string | null;
    node_title: string | null;
    skill_id: string | null;
    skill_name: string | null;
    message: string;
    payload: Record<string, unknown>;
    event_key: string | null;
    created_at: string;
  }>;
  artifacts: Artifact[];
}): PersistedRunSnapshot {
  return {
    type: payload.run.type as import("@spielos/core").RunType,
    status: payload.run.status,
    events: payload.events.map((event) => ({
      id: event.event_key ?? event.id,
      orgId: event.org_id,
      runId: event.run_id,
      type: event.event_type as RunEvent["type"],
      sequence: Number(event.sequence),
      nodeId: event.node_id ?? undefined,
      nodeTitle: event.node_title ?? undefined,
      skillId: event.skill_id ?? undefined,
      skillName: event.skill_name ?? undefined,
      message: event.message,
      payload: event.payload ?? {},
      createdAt: event.created_at
    })),
    artifacts: payload.artifacts
  };
}

function RunTurnCard({ runId, children }: { runId: string; children?: ReactNode }) {
  const activeRunId = useRuntimeStore((s) => s.activeRunId);
  const runEvents = useRuntimeStore((s) => s.events);
  const runArtifacts = useRuntimeStore((s) => s.artifacts);
  const runType = useRuntimeStore((s) => s.runType);
  const runStatus = useRuntimeStore((s) => s.runStatus);
  const running = useRuntimeStore((s) => s.runStatus === "running");
  const activity = useRuntimeStore((s) => s.activity);
  const [persisted, setPersisted] = useState<PersistedRunSnapshot | null>(null);

  useEffect(() => {
    if (activeRunId === runId) return;
    const controller = new AbortController();
    fetch(`/api/runs/${runId}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: Parameters<typeof toPersistedRunSnapshot>[0] | null) => {
        if (payload) setPersisted(toPersistedRunSnapshot(payload));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [activeRunId, runId]);

  const live = activeRunId === runId;
  const snapshot: RunActivitySnapshot | null = live
    ? { runType, status: runStatus, running, activity, events: runEvents }
    : persisted
      ? { runType: persisted.type, status: persisted.status, running: persisted.status === "running", activity: null, events: persisted.events }
      : null;
  const artifacts = live ? runArtifacts : persisted?.artifacts ?? [];
  if (!snapshot) {
    return (
      <div>
        <div className="flex h-6 items-center gap-2 text-2xs text-muted-foreground" aria-live="polite">
          <StatusIcon busy icon="circle-dot" tone="info" size={11} />
          <span className="sr-only">Loading execution history</span>
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <ContextCleanupBoundary events={snapshot.events} />
      <RunActivityTimeline snapshot={snapshot} />
      {children}
      <InlineRunArtifacts artifacts={artifacts} />
    </div>
  );
}

function AssistantMessage() {
  const activeChatId = useRuntimeStore((s) => s.activeChatId);
  const activeRunId = useRuntimeStore((s) => s.activeRunId);
  const rawMessages = useRuntimeStore((s) => s.messages);
  const messages = useMemo(() => (activeChatId ? rawMessages[activeChatId] ?? [] : []), [activeChatId, rawMessages]);
  const chats = useRuntimeStore((s) => s.chats);
  const runStatus = useRuntimeStore((s) => s.runStatus);
  const pendingExecutionMode = useRuntimeStore((s) => s.pendingExecutionMode);
  const messageId = useAuiState((s) => s.message.id);
  const isLatest = useAuiState((s) => s.thread.messages.at(-1)?.id === s.message.id);
  const persistedMessage = messages.find((message) => message.id === messageId);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const directorMode = (typeof activeChat?.metadata?.executionMode === "string"
    ? activeChat.metadata.executionMode
    : pendingExecutionMode) === "director";
  const running = runStatus === "running";
  const events = useRuntimeStore((s) => s.events);
  const ordered = orderRunEvents(events);
  const latestStart = [...ordered].reverse().find(isStartEvent);
  const actor = isLatest && running && latestStart?.payload?.roleId ? { roleId: latestStart.payload.roleId as string, roleName: (latestStart.payload.roleName as string) ?? "Assistant" } : null;
  const { roles: domainRoles } = useDomainStore();
  const actorRole = actor ? domainRoles.find((role) => role.id === actor.roleId) : null;
  const actorName = actorRole?.name ?? actor?.roleName ?? (directorMode ? "Director" : "Assistant");
  const working = isLatest && (running || runStatus === "waiting_human");
  const persistedRunId = typeof persistedMessage?.metadata?.runId === "string"
    ? persistedMessage.metadata.runId
    : null;
  const inlineRunId = isLatest
    ? persistedRunId ?? ((running || runStatus === "waiting_human") ? activeRunId : null)
    : null;
  return (
    <MessagePrimitive.Root className="group relative grid w-full grid-cols-[auto_1fr] gap-x-3">
      {actor ? <RoleAvatar roleId={actor.roleId} roleName={actorName} /> : (
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-panel-raised text-foreground">
          <Icon name={directorMode ? "intellect" : ENTITY_ICONS.assistant} size={14} />
        </div>
      )}
      <div className="min-w-0 overflow-hidden leading-relaxed">
        <div className="flex items-center gap-2 text-2xs font-medium text-muted-foreground">
          <span>{actorName}</span>
        </div>
        <div className="mt-1">
          {inlineRunId ? (
            <RunTurnCard runId={inlineRunId}>
              <MessagePrimitive.Parts components={{ Text: MarkdownPart }} />
            </RunTurnCard>
          ) : <MessagePrimitive.Parts components={{ Text: MarkdownPart }} />}
        </div>
        {!working ? (
          <div className="mt-2 flex items-center gap-1 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100">
            <ActionBar />
          </div>
        ) : null}
        <MessagePrimitive.Error>
          <MessageError />
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
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

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const { models } = useDomainStore();
  const activeRunId = useRuntimeStore((state) => state.activeRunId);
  const runStatus = useRuntimeStore((state) => state.runStatus);
  const ownsActiveStream = useRuntimeStore((state) => Boolean(state.activeRunId && state.activeStreams.has(state.activeRunId)));
  const instanceIdRef = useRef<string | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = crypto.randomUUID();
  }

  // Reload chats from server on mount
  useEffect(() => {
    void useRuntimeStore.getState().reloadChats();
  }, []);

  // Realtime is a low-latency hint, not a correctness dependency. A run that
  // outlives its original HTTP reader (reload, tab switch, proxy timeout, or a
  // different server replica) is reconciled against the durable checkpoint.
  useEffect(() => {
    if (!activeRunId || runStatus !== "running" || ownsActiveStream) return;
    const restore = () => void useRuntimeStore.getState().restoreRun(activeRunId);
    restore();
    const interval = window.setInterval(restore, 2_000);
    return () => window.clearInterval(interval);
  }, [activeRunId, ownsActiveStream, runStatus]);

  const adapter = useRuntimeAdapter(models);
  const runtime = useExternalStoreRuntime(adapter);

  return (
    <>
      <span data-runtime-instance-id={instanceIdRef.current} style={{ display: 'none' }} />
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </>
  );
}

function RuntimeStats() {
  const contextItems = useRuntimeStore((s) => s.contextItems);
  const events = useRuntimeStore((s) => s.events);
  return (
    <span>
      {contextItems.length > 0
        ? `${contextItems.length} attached · ${events.length} events`
        : "0 attached"}
    </span>
  );
}

function ChatThreadInner() {
  const activeChatId = useRuntimeStore((s) => s.activeChatId);
  const chats = useRuntimeStore((s) => s.chats);
  const contextItems = useRuntimeStore((s) => s.contextItems);
  const hydratedContextChatId = useRef<string | null>(null);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const isEmpty = useAuiState(
    (s) => s.thread.messages.length === 0 && !s.thread.isRunning
  );

  useEffect(() => {
    if (!activeChatId || !activeChat || hydratedContextChatId.current === activeChatId) return;
    const store = useRuntimeStore.getState();
    const saved = Array.isArray(activeChat.metadata?.contextItems)
      ? activeChat.metadata.contextItems.filter((item): item is import("../../lib/runtime-store").ContextItem => {
          if (!item || typeof item !== "object") return false;
          const value = item as Record<string, unknown>;
          return typeof value.id === "string" && typeof value.kind === "string" && typeof value.title === "string";
        })
      : [];
    hydratedContextChatId.current = activeChatId;
    store.setContextItems(saved);
  }, [activeChatId, activeChat]);

  useEffect(() => {
    if (!activeChatId || hydratedContextChatId.current !== activeChatId) return;
    const saved = Array.isArray(activeChat?.metadata?.contextItems) ? activeChat.metadata.contextItems : [];
    if (JSON.stringify(saved) === JSON.stringify(contextItems)) return;
    const timer = window.setTimeout(() => {
      void useRuntimeStore.getState().updateChatMetadata(activeChatId, { contextItems })
        .catch(() => toast.error("Chat context could not be saved."));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeChatId, activeChat, contextItems]);

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
          </div>
        </div>
      </ThreadPrimitive.Viewport>
      <div className="pointer-events-none shrink-0 bg-transparent px-0 pt-6">
        <div className="pointer-events-auto mx-auto w-full max-w-3xl px-4 pb-3">
          <Composer />
          <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <RuntimeStats />
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
  return <ChatThreadInner />;
}
