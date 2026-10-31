import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { MemoryWorkspaceContext } from "../contracts";
import { memoryPath, memoryProjectSearch } from "../routes";
import { isAbort } from "./client";

export type ReadState<T> = { data?: T; error?: unknown; loading: boolean; reload(): void };

// Each read owns its controller/timer. No private result is cached outside the
// resolved workspace. A poll starts after the previous request settles.
export function useOVRead<T>(
  context: MemoryWorkspaceContext, key: string, load: (signal: AbortSignal) => Promise<T>,
  enabled = true, interval?: (value: T) => number | false,
): ReadState<T> {
  const loader = useRef(load); loader.current = load;
  const poll = useRef(interval); poll.current = interval;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown; loading: boolean }>({ key, loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => { controller.abort(); clearTimeout(timer); };
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    const run = async () => {
      try {
        controller.signal.throwIfAborted();
        const data = await loader.current(controller.signal);
        controller.signal.throwIfAborted();
        setState({ key, data, loading: false });
        const delay = poll.current?.(data);
        if (delay) timer = setTimeout(() => { void run(); }, delay);
      } catch (error) {
        if (!controller.signal.aborted && !isAbort(error)) setState({ key, error, loading: false });
      }
    };
    setState({ key, loading: true });
    void run();
    return () => {
      controller.abort(); clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
    };
  }, [context, key, enabled, revision]);
  const current = enabled && state.key === key ? state : { loading: enabled };
  return { ...current, reload: useCallback(() => setRevision(value => value + 1), []) };
}

export function useOVMutation(context: MemoryWorkspaceContext) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = () => controller.current?.abort();
    context.signal.addEventListener("abort", abort, { once: true });
    return () => { abort(); context.signal.removeEventListener("abort", abort); };
  }, [context]);
  const run = async <T,>(action: (signal: AbortSignal) => Promise<T>, success?: (result: T) => void) => {
    if (controller.current || context.signal.aborted) return;
    const active = new AbortController(); controller.current = active;
    setPending(true); setError(undefined);
    try {
      const value = await action(active.signal);
      active.signal.throwIfAborted(); context.signal.throwIfAborted();
      success?.(value);
    } catch (error) {
      if (!active.signal.aborted && !context.signal.aborted && !isAbort(error)) setError(error);
    } finally {
      if (controller.current === active) controller.current = null;
      if (!active.signal.aborted && !context.signal.aborted) setPending(false);
    }
  };
  return { pending, error, run };
}

export function useOVLocation() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const set = (patch: Record<string, string | number | null>, replace = false) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key); else next.set(key, String(value));
    }
    navigate({ pathname: location.pathname, search: next.toString() }, { replace });
  };
  const go = (page: string, values: Record<string, string> = {}) => {
    const next = new URLSearchParams(memoryProjectSearch(location.search));
    for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
    navigate(memoryPath("openviking", page, next.toString()));
  };
  return { params, set, go, navigationKey: location.key };
}
export function offsetParam(params: URLSearchParams, name = "offset") {
  const number = Number(params.get(name));
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
