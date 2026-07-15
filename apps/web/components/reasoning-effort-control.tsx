"use client";

import { Icon } from "@spielos/design-system/components";
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from "@spielos/design-system";
import type { ModelCapabilities } from "@spielos/core";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./reasoning-effort-control.css";

export type ReasoningEffort = ModelCapabilities["reasoningEffort"];

const REASONING_LEVELS: Array<{ value: ReasoningEffort; label: string; detail: string }> = [
  { value: "low", label: "Low", detail: "Fastest" },
  { value: "auto", label: "Auto", detail: "Adaptive" },
  { value: "medium", label: "Medium", detail: "Balanced" },
  { value: "high", label: "High", detail: "Deep" },
  { value: "xhigh", label: "Ultra", detail: "Frontier" },
  { value: "max", label: "Max", detail: "Long horizon" }
];

export function reasoningLabel(value: ReasoningEffort): string {
  return REASONING_LEVELS.find((level) => level.value === value)?.label ?? "Auto";
}

export function ReasoningEffortControl({
  value,
  onChange,
  running = false,
  className
}: {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  compact?: boolean;
  running?: boolean;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [dragging, setDragging] = useState(false);
  const previewValue = useRef(value);
  const committedValue = useRef(value);

  useEffect(() => {
    setLocalValue(value);
    previewValue.current = value;
    committedValue.current = value;
  }, [value]);

  const activeIndex = Math.max(0, REASONING_LEVELS.findIndex((level) => level.value === localValue));
  const active = REASONING_LEVELS[activeIndex];
  const fill = `${(activeIndex / (REASONING_LEVELS.length - 1)) * 100}%`;
  const maximum = localValue === "max";
  const style = { "--reasoning-fill": fill } as CSSProperties;

  function preview(next: ReasoningEffort) {
    previewValue.current = next;
    setLocalValue(next);
  }

  function commit(next = previewValue.current) {
    if (next === committedValue.current) return;
    committedValue.current = next;
    onChange(next);
  }

  function select(next: ReasoningEffort) {
    preview(next);
    commit(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className={cn("reasoning-trigger", className)}
          data-max={maximum}
          data-running={running}
          icon={maximum ? "zap" : "brain"}
          size="sm"
          type="button"
          variant="subtle"
        >
          <span className="text-muted-foreground">Reasoning</span>
          <span>{active.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80" side="top">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-md bg-panel", maximum ? "text-info" : "text-muted-foreground")}>
            <Icon name={maximum ? "zap" : "brain"} size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Reasoning power</div>
            <div className="text-3xs text-muted-foreground">Drag to tune quality, speed, and token spend.</div>
          </div>
          <span className={cn("text-xs font-semibold", maximum ? "text-info" : "text-foreground")}>{active.label}</span>
        </div>

        <div className="reasoning-slider mt-4" data-dragging={dragging} data-max={maximum} style={style}>
          <div aria-hidden className="reasoning-slider__track">
            <span className="reasoning-slider__fill" />
            <span className="reasoning-slider__surge" key={localValue} />
          </div>
          <input
            aria-label="Reasoning power"
            aria-valuetext={`${active.label}: ${active.detail}`}
            className="reasoning-slider__input"
            max={REASONING_LEVELS.length - 1}
            min={0}
            onBlur={() => {
              setDragging(false);
              commit();
            }}
            onChange={(event) => preview(REASONING_LEVELS[Number(event.target.value)].value)}
            onKeyUp={() => commit()}
            onPointerDown={() => setDragging(true)}
            onPointerCancel={() => {
              setDragging(false);
              commit();
            }}
            onPointerUp={() => {
              setDragging(false);
              commit();
            }}
            step={1}
            type="range"
            value={activeIndex}
          />
          {maximum ? (
            <span aria-hidden className="reasoning-slider__electricity">
              <Icon className="reasoning-slider__spark reasoning-slider__spark--one" name="zap" size={10} />
              <Icon className="reasoning-slider__spark reasoning-slider__spark--two" name="zap" size={9} />
              <Icon className="reasoning-slider__spark reasoning-slider__spark--three" name="zap" size={8} />
            </span>
          ) : null}
        </div>

        <div className="mt-2 grid grid-cols-6 gap-1">
          {REASONING_LEVELS.map((level, index) => (
            <button
              aria-label={`Set reasoning to ${level.label}`}
              className={cn("truncate rounded-sm px-0.5 py-1 text-center text-3xs transition-colors duration-[var(--duration)]", index === activeIndex ? "bg-selected font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground")}
              key={level.value}
              onClick={() => select(level.value)}
              type="button"
            >
              {level.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-3xs text-muted-foreground">
          <span>{active.detail}</span>
          <span>{activeIndex + 1} / {REASONING_LEVELS.length}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
