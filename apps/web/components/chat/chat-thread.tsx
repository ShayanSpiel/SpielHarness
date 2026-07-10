"use client";

import { Icon } from "../icons";
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
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useState
} from "react";
import ReactMarkdown from "react-markdown";
import { Button, Tooltip, cn } from "@spielos/design-system";
import remarkGfm from "remark-gfm";
import { useSpielosChatAdapter } from "../../lib/chat-adapter";
import { useRunContext } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import { ContextChips } from "./context-chips";
import { ContextPicker } from "./context-picker";
import type { HumanInputOption, HumanInputQuestion } from "@spielos/core";

function ComposerAddContext() {
  const run = useRunContext();
  return (
    <Tooltip content="Add context (Roles, Skills, Library, Workstreams)" side="top">
      <Button
        aria-label="Add context"
        onClick={() => run.setPickerOpen(true)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Icon name="plus" size={16} />
      </Button>
    </Tooltip>
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

function Composer() {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const run = useRunContext();

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const form = event.currentTarget.closest("form") as HTMLFormElement | null;
      form?.requestSubmit();
    }
  };

  return (
    <ComposerPrimitive.Root className="aui-composer relative flex w-full flex-col gap-1.5">
      <ContextChips items={run.contextItems} onRemove={run.removeContext} />
      <div
        data-slot="aui-composer-shell"
        className="flex w-full flex-col gap-1 overflow-hidden rounded-xl border border-border bg-panel-raised p-2 shadow-[var(--shadow-panel)] transition-colors focus-within:border-foreground/40"
      >
        <ComposerPrimitive.Input
          autoFocus
          className="min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          enterKeyHint="send"
          placeholder="Message the team…"
          rows={1}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-between px-1">
          <ComposerAddContext />
          {isRunning ? <ComposerCancel /> : <ComposerSend />}
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

function MessageError() {
  return (
    <div className="mt-1.5 rounded-md border border-foreground bg-foreground/5 px-3 py-2 text-xs text-foreground">
      Something went wrong. Try again.
    </div>
  );
}

function ActionBar() {
  return (
    <ActionBarPrimitive.Root className="flex items-center gap-0.5">
      <ActionBarPrimitive.Copy asChild>
        <Tooltip content="Copy" side="top">
          <Button aria-label="Copy" size="icon" variant="ghost">
            <Icon name="copy" size={14} />
          </Button>
        </Tooltip>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <Tooltip content="Regenerate" side="top">
          <Button aria-label="Regenerate" size="icon" variant="ghost">
            <Icon name="refresh" size={14} />
          </Button>
        </Tooltip>
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.Edit asChild>
        <Tooltip content="Edit" side="top">
          <Button aria-label="Edit" size="icon" variant="ghost">
            <Icon name="edit" size={14} />
          </Button>
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

function UserMessage() {
  return (
    <MessagePrimitive.Root className="fade-in slide-in-from-bottom-1 relative grid w-full grid-cols-[1fr_auto] gap-x-3 animate-in duration-150">
      <div className="min-w-0 max-w-[85%] overflow-hidden rounded-xl border border-border bg-panel-strong px-3 py-2 text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Parts />
        <div className="mt-1.5 flex items-center justify-end gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <ActionBar />
        </div>
      </div>
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-foreground text-background">
        <Icon name="user" size={14} />
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
          <code className="rounded-sm border border-border bg-panel-raised px-1 py-0.5 font-mono text-[12px] text-foreground">
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

function AssistantMessage() {
  const run = useRunContext();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  return (
    <MessagePrimitive.Root className="fade-in slide-in-from-bottom-1 relative grid w-full grid-cols-[auto_1fr] gap-x-3 animate-in duration-150">
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel text-foreground">
        <Icon name="bot" size={14} />
      </div>
      <div className="min-w-0 overflow-hidden leading-relaxed">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <span>Assistant</span>
          {isRunning && run.activity ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-panel-raised px-1.5 py-0.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 animate-ping rounded-full bg-foreground" />
              <span className="truncate">{run.activity}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-1">
          <MessagePrimitive.Parts components={{ Text: MarkdownPart }} />
        </div>
        <div className="mt-2 flex items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <ActionBar />
        </div>
        <MessagePrimitive.Error>
          <MessageError />
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
}

function HumanInputRequestMessage() {
  const run = useRunContext();
  const request = run.humanInputRequest;
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
  }, [request?.id]);

  if (!request) return null;

  function setAnswer(id: string, value: unknown) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  function submit() {
    if (!request) return;
    setSubmitted(true);
    fetch(`/api/runs/${run.activeRunId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: request.id, answers })
    }).catch(() => setSubmitted(false));
  }

  const hasAnswers = request.questions.some((q) => q.kind !== "none");

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="user" className="text-muted-foreground" size={14} />
        <span className="text-xs font-semibold text-foreground">
          {request.header ?? "The team needs your input"}
        </span>
      </div>
      <div className="grid gap-4">
        {request.questions.map((question) => (
          <QuestionField
            answers={answers}
            key={question.id}
            question={question}
            setAnswer={setAnswer}
            submitted={submitted}
          />
        ))}
        <div className="flex items-center justify-end">
          <Button
            disabled={submitted}
            onClick={submit}
            size="md"
            variant="primary"
          >
            <Icon name="arrow-up" size={14} />
            {hasAnswers ? "Send answers" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuestionField({
  question,
  answers,
  setAnswer,
  submitted
}: {
  question: HumanInputQuestion;
  answers: Record<string, unknown>;
  setAnswer: (id: string, value: unknown) => void;
  submitted: boolean;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-[12px] font-medium text-foreground">{question.question}</div>
      {question.kind === "single" ? (
        <div className="grid gap-1.5">
          {question.options?.map((option: HumanInputOption) => (
            <button
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                answers[question.id] === option.id
                  ? "border-foreground-strong bg-selected"
                  : "border-border bg-background hover:bg-hover"
              )}
              disabled={submitted}
              key={option.id}
              onClick={() => setAnswer(question.id, option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
          {question.allowCustom ? (
            <textarea
              className="min-h-16 resize-none rounded-md border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              disabled={submitted}
              onChange={(e) => setAnswer(question.id, e.target.value || `custom:${question.id}`)}
              placeholder="Or write your own…"
              value={typeof answers[question.id] === "string" ? (answers[question.id] as string) : ""}
            />
          ) : null}
        </div>
      ) : null}
      {question.kind === "multi" ? (
        <div className="grid gap-1.5">
          {question.options?.map((option: HumanInputOption) => {
            const selected = Array.isArray(answers[question.id])
              ? (answers[question.id] as string[]).includes(option.id)
              : false;
            return (
              <button
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  selected
                    ? "border-foreground-strong bg-selected"
                    : "border-border bg-background hover:bg-hover"
                )}
                disabled={submitted}
                key={option.id}
                onClick={() => {
                  const current = Array.isArray(answers[question.id])
                    ? (answers[question.id] as string[])
                    : [];
                  setAnswer(
                    question.id,
                    current.includes(option.id)
                      ? current.filter((id) => id !== option.id)
                      : [...current, option.id]
                  );
                }}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {question.kind === "text" ? (
        <textarea
          className="min-h-20 resize-none rounded-md border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          disabled={submitted}
          onChange={(e) => setAnswer(question.id, e.target.value)}
          placeholder="Type your answer…"
          value={(answers[question.id] as string) ?? ""}
        />
      ) : null}
      {question.kind === "none" ? (
        <p className="text-[11px] text-muted-foreground">
          No answer needed. Hit Continue to proceed.
        </p>
      ) : null}
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
  const store = useWorkspaceStore();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-panel">
        <Icon name="sparkles" size={18} />
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        What should the marketing team do?
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Press <kbd className="rounded border border-border bg-panel-raised px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd> for search, or{" "}
        <kbd className="rounded border border-border bg-panel-raised px-1.5 py-0.5 font-mono text-[11px]">+</kbd> below
        to add roles, skills, library files, or workstreams to this run.
      </p>
      <div className="mt-6 max-w-md space-y-2">
        <p className="text-sm text-muted-foreground">
          Select roles or a workstream from <kbd className="rounded border border-border bg-panel-raised px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd> to start.
        </p>
      </div>
      {store.roles.length === 0 ? (
        <div className="mt-3 max-w-md rounded-lg border border-dashed border-border bg-panel-raised/40 px-3 py-2 text-[11px] text-muted-foreground">
          No agents in the harness yet. Create one in <a className="underline" href="/roles">/roles</a>.
        </div>
      ) : null}
    </div>
  );
}

function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const adapter = useSpielosChatAdapter();
  const runtime = useLocalRuntime(adapter);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function ChatThreadInner() {
  const run = useRunContext();
  const isEmpty = useAuiState(
    (s) => s.thread.messages.length === 0 && !s.thread.isRunning
  );
  const isRunning = useAuiState((s) => s.thread.isRunning);

  useEffect(() => {
    if (isRunning) run.setRunning(true);
  }, [isRunning, run]);

  // Inject the human input question as a chat message when one is requested
  const hasHumanInput = Boolean(run.humanInputRequest);

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
            {hasHumanInput ? <HumanInputRequestMessage /> : null}
          </div>
        </div>
      </ThreadPrimitive.Viewport>
      <div className="shrink-0 border-t border-border bg-panel-raised">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          <Composer />
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
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
              <kbd className="rounded border border-border bg-panel-raised px-1 py-0.5 font-mono text-[10px]">↵</kbd>
              <span className="text-[10px]">send ·</span>
              <kbd className="rounded border border-border bg-panel-raised px-1 py-0.5 font-mono text-[10px]">⇧↵</kbd>
              <span className="text-[10px]">newline</span>
            </div>
          </div>
        </div>
      </div>
      <ContextPicker />
    </ThreadPrimitive.Root>
  );
}

export function ChatThread() {
  return (
    <ChatRuntimeProvider>
      <ChatThreadInner />
    </ChatRuntimeProvider>
  );
}
