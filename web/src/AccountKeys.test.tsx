import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";
import { AccountKeys } from "./AccountKeys";
import i18n from "./i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, node: HTMLDivElement | undefined;
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); node?.remove(); vi.unstubAllGlobals();
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

it("keeps a newly issued account key through failed changes and revocation of another key", async () => {
  await i18n.changeLanguage("en");
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  let fail = false;
  const keys = [{ id: "other", name: "Other", prefix: "ma_other", created_at: "2026-10-31", revoked_at: null as string | null }];
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    if (!options?.method) return Response.json({ keys });
    if (fail) return Response.json({ error: "unavailable" }, { status: 503 });
    if (options.method === "POST") {
      const key = { ...keys[0]!, id: "issued", name: "Issued" }; keys.push(key);
      return Response.json({ key, secret: "ma_keep_this_secret" });
    }
    keys.find(key => path.endsWith("/"+key.id))!.revoked_at = "2026-10-31";
    return new Response(null, { status: 204 });
  }));
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(<MemoryRouter><I18nextProvider i18n={i18n}><AccountKeys accountID="account" /></I18nextProvider></MemoryRouter>));
  const submit = async () => {
    await act(async () => {
      const input = node!.querySelector("input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Issued");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => node!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  };
  const revoke = async (name: string) => {
    const article = [...node!.querySelectorAll("article")].find(item => item.querySelector("strong")?.textContent === name)!;
    await act(async () => article.querySelector("button")!.click());
  };
  const secret = () => node!.querySelector(".memory-secret code")?.textContent;
  await submit(); expect(secret()).toBe("ma_keep_this_secret");
  fail = true;
  await submit(); expect(node.querySelector('[role="alert"]')).not.toBeNull(); expect(secret()).toBe("ma_keep_this_secret");
  await revoke("Other"); expect(secret()).toBe("ma_keep_this_secret");
  fail = false;
  await revoke("Other"); expect(secret()).toBe("ma_keep_this_secret");
  await revoke("Issued"); expect(secret()).toBeUndefined();
});
