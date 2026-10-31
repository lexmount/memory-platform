const memoryRoot = "/memory";

export const memoryRoutePattern = `${memoryRoot}/:provider?/*`;

// Resource IDs, native filters and pagination belong to one workspace only.
export function memoryProjectSearch(search: string) {
  const current = new URLSearchParams(search), next = new URLSearchParams();
  for (const key of ["project", "userid"]) if (current.has(key)) next.set(key, current.get(key)!);
  return next.toString();
}

// Router-relative paths are owned by the standalone Memory HashRouter.
export function memoryPath(provider = "", page = "", search = "") {
  const segments = [memoryRoot];
  if (provider) {
    segments.push(encodeURIComponent(provider));
    if (page) segments.push(...page.split("/").map(encodeURIComponent));
  }
  return segments.join("/") + (search && !search.startsWith("?") ? "?" : "") + search;
}
