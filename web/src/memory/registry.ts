import type { MemoryProviderModule } from "./contracts";
import { openVikingModule } from "./openviking/Workspace";
import { hindsightModule } from "./hindsight/Workspace";

// Static, reviewed modules only. Real integrations register here in their own PR.
export const memoryProviderModules: readonly MemoryProviderModule[] = Object.freeze([openVikingModule, hindsightModule]);

export function memoryModuleRegistry(modules: readonly MemoryProviderModule[]) {
  const registry = new Map<string, MemoryProviderModule>();
  for (const module of modules) {
    if (!/^[a-z][a-z0-9_-]*$/.test(module.id) || registry.has(module.id)) {
      throw new Error(`Invalid or duplicate memory module: ${module.id}`);
    }
    const pages = module.navigation.map(item => item.id);
    if (!pages.includes(module.defaultPage) || pages.some(page => !/^[a-z][a-z0-9_-]*$/.test(page)) || new Set(pages).size !== pages.length) {
      throw new Error(`Invalid memory navigation: ${module.id}`);
    }
    registry.set(module.id, module);
  }
  return registry;
}
