import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MemoryNativeInput, MemoryWorkspaceContext } from "../contracts";
import { createHindsightClient, type HindsightClient } from "./client";
import type { HindsightOperation } from "./operations";
import { record, type NativeTask } from "./types";

type TrackedTask = NativeTask & { operation_id: string };

export function useHindsight(context: MemoryWorkspaceContext) {
  return useMemo(() => createHindsightClient(context), [context]);
}
// Poll serially only after a successful read. A failed read remains visible and
// requires an explicit refresh; mutations never enter this polling path.
export function useHindsightRead<T = unknown>(
  client: HindsightClient, operation: HindsightOperation, input: MemoryNativeInput = {},
  options: { enabled?: boolean; poll?: (value: T) => boolean } = {},
) {
  const inputKey = typeof input === "string" ? input : JSON.stringify(input);
  const key = `${client.context.identity}:${operation}:${inputKey}`;
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown; loading: boolean }>({ key, loading: true });
  const [revision, setRevision] = useState(0);
  const poll = useRef(options.poll);
  poll.current = options.poll;
  const enabled = options.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false, active = true, failed = false, shouldPoll = false;
    const signal = AbortSignal.any([controller.signal, client.context.signal]);
    const load = async () => {
      if (!active || signal.aborted || loading) return;
      loading = true;
      setState(previous => previous.key === key ? { ...previous, loading: true, error: undefined } : { key, loading: true });
      try {
        const value = await client.json<T>(operation, inputKey, signal);
        if (!active || signal.aborted) return;
        setState({ key, data: value, loading: false });
        shouldPoll = Boolean(poll.current?.(value));
        if (shouldPoll && document.visibilityState !== "hidden") timer = setTimeout(() => { void load(); }, 3000);
      } catch (error) {
        failed = true;
        if (active && !signal.aborted) setState(previous => ({
          ...(previous.key === key ? previous : { key }), error, loading: false,
        }));
      } finally { loading = false; }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden" && shouldPoll && !failed) void load();
    };
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => { active = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [client, operation, inputKey, key, revision, enabled]);
  return {
    ...(state.key === key ? state : { key, loading: enabled }),
    refresh: useCallback(() => setRevision(value => value + 1), []),
  };
}
export function useHindsightMutation(client: HindsightClient) {
  const [state, setState] = useState<{ busy: boolean; completed?: boolean; result?: unknown; error?: unknown }>({ busy: false });
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [client]);
  const run = async (operation: HindsightOperation, input: MemoryNativeInput, upload?: FormData) => {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || pending.current) return undefined;
    pending.current = true;
    setState({ busy: true });
    try {
      const result = await client.json(operation, input, controller.signal, upload);
      if (controller.signal.aborted || client.context.signal.aborted) return undefined;
      setState({ busy: false, completed: true, result });
      return { data: result };
    } catch (error) {
      if (!controller.signal.aborted && !client.context.signal.aborted) setState({ busy: false, error });
      return undefined;
    } finally { pending.current = false; }
  };
  return { ...state, run };
}
export function useHindsightTasks(client: HindsightClient, accepted: ReadonlyMap<string, number>) {
  const acceptedKey = JSON.stringify([...accepted]), key = JSON.stringify([client.context.identity, acceptedKey]);
  const [state, setState] = useState<{ key: string; tasks: TrackedTask[]; error?: unknown }>({ key, tasks: [] });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const taskIDs = (JSON.parse(acceptedKey) as [string, number][]).map(([id]) => id);
    if (!taskIDs.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, loading = false, failed = false, shouldPoll = false;
    const signal = AbortSignal.any([controller.signal, client.context.signal]);
    const load = async () => {
      if (signal.aborted || loading) return;
      loading = true;
      try {
        const tasks: TrackedTask[] = [];
        for (const id of taskIDs) {
          const value = record(await client.json("get_operation_status", { path: { operation_id: id } }, signal));
          tasks.push({ ...value, operation_id: id, status: typeof value.status === "string" ? value.status : "unknown" });
        }
        if (signal.aborted) return;
        setState({ key, tasks });
        shouldPoll = tasks.some(task => ["pending", "processing"].includes(task.status));
        if (shouldPoll && document.visibilityState !== "hidden") {
          timer = setTimeout(() => { void load(); }, 3000);
        }
      } catch (error) {
        failed = true;
        if (!signal.aborted) setState({ key, tasks: [], error });
      } finally { loading = false; }
    };
    const visibility = () => { clearTimeout(timer); if (document.visibilityState !== "hidden" && shouldPoll && !failed) void load(); };
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [client, acceptedKey, key, revision]);
  return { ...(state.key === key ? state : { key, tasks: [] }), refresh: () => setRevision(value => value + 1) };
}
