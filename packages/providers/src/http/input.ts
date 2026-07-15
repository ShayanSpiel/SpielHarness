export function readToolInput(input: string, keys: string[]): string {
  const trimmed = input.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    // Plain strings remain valid tool input.
  }
  return trimmed;
}

export function readToolNumber(
  input: string,
  keys: string[],
  fallback: number,
  range: { min?: number; max?: number } = {}
): number {
  let value = fallback;
  try {
    const parsed = JSON.parse(input.trim()) as Record<string, unknown>;
    for (const key of keys) {
      const candidate = parsed[key];
      const numeric = typeof candidate === "number"
        ? candidate
        : typeof candidate === "string"
          ? Number(candidate)
          : NaN;
      if (Number.isFinite(numeric)) {
        value = numeric;
        break;
      }
    }
  } catch {
    // Plain-string tool inputs use the fallback.
  }
  const min = range.min ?? 1;
  const max = range.max ?? 100;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
