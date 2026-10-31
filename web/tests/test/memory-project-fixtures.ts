import { vi } from "vitest";
import { emptyMemoryBridge, type MemoryBridge, type MemoryProject, type MemoryProvider } from "../../src/memory/contracts";

export function memoryProject(provider = "hindsight", id = "project"): MemoryProject {
  return { id, name: `Project ${id}`, provider, app_key: `mp_${id}`, enabled: true, revoked: false, created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z" };
}
export function projectBridge(provider: MemoryProvider, mapping: Record<string, string> = {}): MemoryBridge {
  const project = memoryProject(provider.provider);
  return {
    ...emptyMemoryBridge, identity: "test-project-session", providers: vi.fn(async () => [provider]), projects: vi.fn(async () => [project]),
    users: vi.fn(async () => ({ items: [{ user_id: "one", provisioned: true }, { user_id: "two", provisioned: true }], next_cursor: "" })),
    resolveUser: vi.fn(async (project_id, user_id) => ({ project_id, user_id, provider, mapping: { ...mapping, ...(provider.provider === "hindsight" ? { bank_id: `bank-${user_id}` } : {}) } })),
    schema: vi.fn(async () => ({})), invoke: vi.fn(async () => Response.json({})),
  };
}
