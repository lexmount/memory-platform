import { memoryProject } from "./test/memory-project-fixtures";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHindsightClient, type HindsightClient } from "../src/memory/hindsight/client";
import { useHindsightRead, useHindsightTasks } from "../src/memory/hindsight/hooks";
import type { MemoryWorkspaceContext } from "../src/memory/contracts";
import { record } from "../src/memory/hindsight/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
function setup(invoke: MemoryWorkspaceContext["invoke"]) {
  const lifetime = new AbortController();
  const context: MemoryWorkspaceContext = {
    identity: "one", signal: lifetime.signal,
    provider: { provider: "hindsight", version: "0.10.3",
      operations: [{ id: "get_operation_status", method: "GET", path: "", description: "", request_media: [], permission: "memory.read" }] },
    project: memoryProject("hindsight"), user: { project_id: "project", user_id: "one", provider: { provider: "hindsight", version: "0.10.3", operations: [] }, mapping: { bank_id: "one" } },
    invoke, schema: vi.fn(),
  };
  return { client: createHindsightClient(context), lifetime };
}
let refresh: () => void;
function ReadProbe({ client }: { client: HindsightClient }) {
  const result = useHindsightRead(client, "get_operation_status", { path: { operation_id: "one" } }, { poll: value => record(value).status === "pending" });
  useEffect(() => { refresh = result.refresh; }, [result.refresh]);
  return <output>{JSON.stringify({ data: result.data, error: Boolean(result.error) })}</output>;
}
function TasksProbe({ client, acceptance = 0 }: { client: HindsightClient; acceptance?: number }) {
  const result = useHindsightTasks(client, new Map([["one", acceptance], ["two", acceptance]]));
  useEffect(() => { refresh = result.refresh; }, [result.refresh]);
  return <output>{JSON.stringify({ tasks: result.tasks, error: Boolean(result.error) })}</output>;
}
async function advance(time = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); }
async function hidden(value: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: value ? "hidden" : "visible" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount()); node.remove();
  vi.useRealTimers(); vi.restoreAllMocks();
  if (visibility) Object.defineProperty(document, "visibilityState", visibility);
  else Reflect.deleteProperty(document, "visibilityState");
});
it("polls serially, pauses when hidden, resumes pending reads and stops on completion", async () => {
  let status = "pending";
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>(async () => Response.json({ status }));
  const { client } = setup(invoke);
  await act(async () => root.render(<ReadProbe client={client} />)); await advance();
  expect(invoke).toHaveBeenCalledTimes(1);
  await advance(3000); expect(invoke).toHaveBeenCalledTimes(2);
  await hidden(true); await advance(9000); expect(invoke).toHaveBeenCalledTimes(2);
  status = "completed";
  await hidden(false); await advance(); expect(invoke).toHaveBeenCalledTimes(3);
  await advance(9000); await hidden(true); await hidden(false); expect(invoke).toHaveBeenCalledTimes(3);
  expect(node.textContent).toContain("completed");
});
it("requires manual retry after a failed read, including visibility changes", async () => {
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>().mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => Response.json({ status: "completed" }));
  const { client } = setup(invoke);
  await act(async () => root.render(<ReadProbe client={client} />)); await advance();
  await hidden(true); await hidden(false); await advance(9000);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(node.textContent).toContain('"error":true');
  await act(async () => refresh()); await advance();
  expect(invoke).toHaveBeenCalledTimes(2); expect(node.textContent).toContain("completed");
});
it("tracks every task ID and preserves not_found instead of marking completion", async () => {
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>(async (_operation, input) => {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    return Response.json({ operation_id: parsed.path.operation_id, status: parsed.path.operation_id === "one" ? "completed" : "not_found" });
  });
  const { client } = setup(invoke);
  await act(async () => root.render(<TasksProbe client={client} />)); await advance();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(node.textContent).toContain("not_found");
  await advance(9000); await hidden(true); await hidden(false); expect(invoke).toHaveBeenCalledTimes(2);
});
it("resumes tracking when another accepted request reuses a completed task ID", async () => {
  let status = "completed";
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>(async () => Response.json({ status }));
  const { client } = setup(invoke);
  await act(async () => root.render(<TasksProbe client={client} />)); await advance();
  expect(invoke).toHaveBeenCalledTimes(2);
  status = "processing";
  await act(async () => root.render(<TasksProbe client={client} acceptance={1} />)); await advance();
  expect(invoke).toHaveBeenCalledTimes(4);
  expect(node.textContent).toContain("processing");
  await advance(3000);
  expect(invoke).toHaveBeenCalledTimes(6);
});
it("does not overlap slow polling reads or keep polling after workspace retirement", async () => {
  let release!: (response: Response) => void;
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>(() => new Promise(resolve => { release = resolve; }));
  const { client, lifetime } = setup(invoke);
  await act(async () => root.render(<ReadProbe client={client} />)); await advance(9000);
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => lifetime.abort());
  await act(async () => release(Response.json({ status: "pending", private: "late data" }))); await advance(9000);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(node.textContent).not.toContain("late data");
});
