import { useMemo, useRef } from "react";
import { discardMemoryResponse, memoryRequest, type MemoryBridge, type MemoryNativeInput,
 type MemoryWorkspace, type MemoryProvider, type MemoryProject, type MemoryIdentity, type MemoryUserPage } from "./memory/contracts";
const prefix = "/v1";
export function createMemoryBridge(identity: string, current: () => boolean, accountID?: string) {
  const accountHeaders: Record<string, string> = accountID ? { "X-Memory-Account": accountID } : {};
  const lifetime = new AbortController();
  const request = <T,>(signal: AbortSignal, call: (signal: AbortSignal) => Promise<T>) =>
    memoryRequest(lifetime.signal, signal, async linked => {
      if (!current()) throw new DOMException("Memory identity changed", "AbortError");
      const value = await call(linked);
      if (!current()) {
        const error = new DOMException("Memory identity changed", "AbortError");
        discardMemoryResponse(value, error); throw error;
      }
      return value;
    });
  const projectPath = (project: string) => `${prefix}/projects/${encodeURIComponent(project)}`;
  const json = <T,>(path: string, method: string, body: unknown, signal: AbortSignal) => request(signal, async linked => {
    const response = await fetch(path, {
      method, credentials: "same-origin", signal: linked,
      headers: { ...accountHeaders, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Memory project request failed");
    return (response.status === 204 ? undefined : await response.json()) as T;
  });
  const post = (path: string, user: string, input: MemoryNativeInput, signal: AbortSignal, upload?: FormData) =>
    request(signal, linked => {
      if (typeof input === "string") {
        const parsed: unknown = JSON.parse(input);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Native memory input must be a JSON object");
      }
      const data = typeof input === "string" ? input : JSON.stringify(input);
      return fetch(path + (upload ? `?${new URLSearchParams({ request: data })}` : ""), {
        method: "POST", credentials: "same-origin", signal: linked,
        headers: { ...accountHeaders, "X-User-Id": encodeURIComponent(user), ...(!upload ? { "Content-Type": "application/json" } : {}) },
        body: upload ?? data,
      });
    });
  const bridge: MemoryBridge = {
    identity,
    providers: signal => request(signal, async linked => (await json<{ providers: MemoryProvider[] }>(`${prefix}/providers`, "GET", undefined, linked)).providers),
    workspaces: signal => request(signal, async linked => (await json<{workspaces:MemoryWorkspace[]}>(`${prefix}/workspaces`,"GET",undefined,linked)).workspaces),
    createWorkspace: (name,signal)=>json<MemoryWorkspace>(`${prefix}/workspaces`,"POST",{name},signal),
    projects: signal => request(signal, async linked => (await json<{ projects: MemoryProject[] }>(`${prefix}/projects`, "GET", undefined, linked)).projects),
    createProject: (name, provider, signal, workspace_id) => json(`${prefix}/projects`, "POST", { name, provider, workspace_id }, signal),
    deleteProject: (project, signal) => json(projectPath(project), "DELETE", undefined, signal),
    updateProject: (project, patch, signal) => json(projectPath(project), "PATCH", patch, signal),
    rotateCredential: (project, signal) => json(`${projectPath(project)}/credentials/rotate`, "POST", {}, signal),
    revokeCredential: (project, signal) => json(`${projectPath(project)}/credentials`, "DELETE", undefined, signal),
    users: (project, after, signal) => request(signal, linked => json<MemoryUserPage>(`${projectPath(project)}/users?${new URLSearchParams({ after })}`, "GET", undefined, linked)),
    resolveUser: (project, user, signal) => json<MemoryIdentity>(`${projectPath(project)}/identity`, "POST", { user_id: user }, signal),
    schema: (project, user, operation, signal) => request(signal, async linked => {
      const response = await fetch(`${projectPath(project)}/schemas/${encodeURIComponent(operation)}`, {
        credentials: "same-origin", signal: linked, headers: { ...accountHeaders, "X-User-Id": encodeURIComponent(user) },
      });
      if (!response.ok) throw new Error("Native schema unavailable"); return response.json();
    }),
    invoke: (project, user, operation, input, signal, upload) => post(`${projectPath(project)}/requests/${encodeURIComponent(operation)}`, user, input, signal, upload),
  };
  return { bridge, dispose: () => lifetime.abort() };
}

export function useMemoryBridge(identity: string, accountID?: string): MemoryBridge {
 const current = useRef(identity); current.current = identity;
 return useMemo(() => createMemoryBridge(identity, () => current.current === identity, accountID).bridge, [identity, accountID]);
}
