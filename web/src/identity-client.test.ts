// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createServerClient } from "./identity-client";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it("keeps the same session visible while focus revalidates it, preserving native drafts", async () => {
  const session = { account: { id: "account" }, expires: 123 };
  let finish!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ session })).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })));
  const auth = createServerClient(), change = vi.fn(); auth.onChange(change);
  try {
    await auth.getSession(); change.mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(change).not.toHaveBeenCalled();
    finish(Response.json({ session }));
    await vi.waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith(session));
  } finally { auth.dispose(); }
});
it("immediately clears the old identity for a cross-tab account change", async () => {
  const session = { account: { id: "second" }, expires: 124 };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ session })));
  const auth = createServerClient(), change = vi.fn(); auth.onChange(change);
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: "identity./auth.changed" }));
    expect(change).toHaveBeenCalledExactlyOnceWith(null);
    await vi.waitFor(() => expect(change).toHaveBeenLastCalledWith(session));
  } finally { auth.dispose(); }
});
it("preserves drafts through a temporary session refresh failure and reports the error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  const auth = createServerClient(), change = vi.fn(), error = vi.fn(); auth.onChange(change); auth.onError(error);
  try {
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(change).not.toHaveBeenCalled();
  } finally { auth.dispose(); }
});
it("does not restore an old in-flight session after logout", async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValueOnce(Response.json({ ok: true })));
  const auth = createServerClient(), change = vi.fn(); auth.onChange(change);
  try {
    const pending = auth.getSession(); await auth.logout();
    finish(Response.json({ session: { account: { id: "old" } } }));
    expect(await pending).toBeNull(); expect(change).toHaveBeenCalledExactlyOnceWith(null);
  } finally { auth.dispose(); }
});
