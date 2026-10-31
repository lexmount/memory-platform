import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemoryNativeInput, MemoryOperation } from "../../src/memory/contracts";

type OVFixture = {
  case: string;
  operation: string;
  input: MemoryNativeInput;
  result: unknown;
};

type OVManifest = {
  version: string;
  operations: Omit<MemoryOperation, "permission">[];
};

// Read the native wire fixtures when tests run. Production typechecking
// must not require these test-only JSON files in the Web Docker build context.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const fixtures: OVFixture[] = JSON.parse(readFileSync(
  resolve(repositoryRoot, "internal/projects/testdata/openviking-ui.json"), "utf8",
));
export const manifest: OVManifest = JSON.parse(readFileSync(
  resolve(repositoryRoot, "internal/profiles/openviking/manifest.json"), "utf8",
));
