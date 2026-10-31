// Lexmount Identity SDK 0.1.0: browser/server-client.ts (user-supplied integration package).
/** UI helper for server-mode apps. The backend alone owns the OIDC transaction. */
export function createServerClient(authPath = '/auth') {
  if (authPath.startsWith('//') || !/^\/[a-zA-Z0-9/_-]+$/.test(authPath)) throw new Error('Same-origin auth path required');
  const changed = `identity.${authPath}.changed`, listeners = new Set<(session: unknown) => void>();
  const errors = new Set<(error: unknown) => void>();
  let generation = 0, sequence = 0;
  const emit = (session: unknown) => { for (const fn of listeners) fn(session); };
  const announce = () => localStorage.setItem(changed, crypto.randomUUID());
  const call = async (action: string, body: unknown) => {
    const res = await fetch(authPath + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const value = await res.json(); if (!res.ok) throw new Error(value.error ?? 'Authentication unavailable'); return value;
  };
  const getSession = async () => {
    const version = generation, request = ++sequence;
    const r = await fetch(authPath + '/session', { cache: 'no-store' });
    if (!r.ok) throw new Error('Session unavailable');
    const value = (await r.json()).session;
    if (version !== generation || request !== sequence) return null;
    emit(value); return value;
  };
  const login = async (mode: 'auto' | 'login' | 'switch') => {
    const value = await call('/login', { mode, returnTo: location.pathname + location.search + '#/memory' });
    if (value.redirect) {
      generation++; emit(null);
      if (mode !== 'auto') announce();
      location.assign(value.redirect);
    }
  };
  // Local patch: a routine focus refresh must preserve drafts/accepted writes
  // when the server returns the same session. Cross-tab identity announcements
  // still retire the old surface immediately.
  const refresh = () => { generation++; void getSession().catch(error => { for (const fn of errors) fn(error); }); };
  const onStorage = (e: StorageEvent) => { if (e.key === changed) { emit(null); refresh(); } };
  window.addEventListener('focus', refresh); window.addEventListener('storage', onStorage);
  return { login: () => login('login'), autoLogin: () => login('auto'), switchAccount: () => login('switch'), getSession,
    async logout() { await call('/logout', {}); generation++; emit(null); announce(); },
    onChange(fn: (session: unknown) => void) { listeners.add(fn); return () => listeners.delete(fn); },
    onError(fn: (error: unknown) => void) { errors.add(fn); return () => errors.delete(fn); },
    dispose() { window.removeEventListener('focus', refresh); window.removeEventListener('storage', onStorage); listeners.clear(); errors.clear(); },
  };
}
