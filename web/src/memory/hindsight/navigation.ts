import { useSearchParams } from "react-router";

// Native navigation parameters remain separate from the selected project/user.
export function useHindsightLocation() {
  const [params, setParams] = useSearchParams();
  const get = (key: string) => params.get(`hs-${key}`) ?? "";
  const set = (values: Record<string, string | number | undefined>) => {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === "") next.delete(`hs-${key}`);
        else next.set(`hs-${key}`, String(value));
      }
      return next;
    });
  };
  return { get, set, resource: get("resource"), open: (id: string) => set({ resource: id, chunk: undefined, "chunks-offset": undefined }) };
}

export function pageOffset(value: string) {
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}
