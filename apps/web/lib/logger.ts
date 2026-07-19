type LogLevel = "debug" | "info" | "warn" | "error";

const DEBUG_ENABLED = (process.env.DEBUG ?? "").toLowerCase() === "true";

const LOG_LEVEL: LogLevel =
  (["debug", "info", "warn", "error"] as const).find(
    (l) => process.env.LOG_LEVEL?.toLowerCase() === l
  ) ?? "info";

function levelValue(lv: LogLevel): number {
  switch (lv) {
    case "debug": return 0;
    case "info": return 1;
    case "warn": return 2;
    case "error": return 3;
  }
}

const THRESHOLD = levelValue(LOG_LEVEL);

function shouldLog(lv: LogLevel): boolean {
  // error/warn/info always emit. Debug requires DEBUG env var.
  if (lv === "debug") return DEBUG_ENABLED && levelValue(lv) >= THRESHOLD;
  return levelValue(lv) >= THRESHOLD;
}

export function makeLogger(prefix: string) {
  const ts = () => new Date().toISOString();
  const log = (lv: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (!shouldLog(lv)) return;
    const line = meta
      ? `[${ts()}] [${lv.toUpperCase()}] [${prefix}] ${msg} ${JSON.stringify(meta)}`
      : `[${ts()}] [${lv.toUpperCase()}] [${prefix}] ${msg}`;
    if (lv === "error") console.error(line);
    else if (lv === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
  };
}

export type ReqLogger = ReturnType<typeof makeLogger> & {
  child: (sub: string) => ReqLogger;
  timer: (label: string) => void;
  endTimer: (label: string) => number;
  timing: (label: string, ms: number) => void;
  request: (method: string, path: string, status: number, ms: number) => void;
  llmStep: (provider: string, model: string, step: string, ms: number, meta?: Record<string, unknown>) => void;
};

export function makeReqLogger(prefix: string, requestId?: string): ReqLogger {
  const base = makeLogger(prefix);
  const spans = new Map<string, number>();
  const tag = requestId ? `${prefix}:${requestId}` : prefix;
  return {
    debug: (msg, meta) => base.debug(msg, { ...meta, rid: requestId }),
    info: (msg, meta) => base.info(msg, { ...meta, rid: requestId }),
    warn: (msg, meta) => base.warn(msg, { ...meta, rid: requestId }),
    error: (msg, meta) => base.error(msg, { ...meta, rid: requestId }),
    child: (sub: string) => makeReqLogger(`${tag}/${sub}`, requestId),
    timer: (label: string) => { spans.set(label, performance.now()); },
    endTimer: (label: string) => {
      const start = spans.get(label);
      if (start === undefined) return 0;
      const ms = performance.now() - start;
      spans.delete(label);
      return ms;
    },
    timing: (label: string, ms: number) => {
      base.debug(`timing:${label}`, { rid: requestId, ms: Math.round(ms) });
    },
    request: (method: string, path: string, status: number, ms: number) => {
      base.info(`${method} ${path} ${status}`, { rid: requestId, ms: Math.round(ms), method, path, status });
    },
    llmStep: (provider: string, model: string, step: string, ms: number, meta) => {
      base.info(`llm:${provider}/${model}/${step}`, {
        rid: requestId,
        provider,
        model,
        step,
        ms: Math.round(ms),
        ...meta
      });
    },
  };
}

export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
