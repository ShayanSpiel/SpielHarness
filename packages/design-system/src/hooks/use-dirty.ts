"use client";

import { useRef, useState, useCallback } from "react";

export function useDirty<T>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const originalRef = useRef<T>(initial);

  const dirty = JSON.stringify(draft) !== JSON.stringify(originalRef.current);

  const reset = useCallback((next?: T) => {
    const value = next ?? originalRef.current;
    originalRef.current = value;
    setDraft(value);
  }, []);

  const markSaved = useCallback(() => {
    originalRef.current = draft;
  }, [draft]);

  return { draft, setDraft, dirty, reset, markSaved };
}
