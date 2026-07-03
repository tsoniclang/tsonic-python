import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TsonicTargetCapabilityPlugin, TsonicTargetPlugin } from "@tsonic/target-api";
import { createPythonTargetPack, pythonTargetId } from "./descriptor/python-target-pack.js";

export interface TsonicPluginManifest {
  readonly kind: "target";
  readonly target: string;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The tsonic manifest is declared in package.json and validated here: a
// package claiming to be a target plugin must name this target exactly.
export function readTsonicPluginManifest(): TsonicPluginManifest {
  const packageJsonPath = resolve(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    readonly name?: unknown;
    readonly tsonic?: unknown;
  };
  const manifest = packageJson.tsonic;
  if (manifest === undefined || typeof manifest !== "object" || manifest === null) {
    throw new Error("@tsonic/target-python: package.json is missing the 'tsonic' plugin manifest.");
  }
  const { kind, target } = manifest as { readonly kind?: unknown; readonly target?: unknown };
  if (kind !== "target") {
    throw new Error(`@tsonic/target-python: tsonic manifest kind must be 'target', got '${String(kind)}'.`);
  }
  if (target !== pythonTargetId) {
    throw new Error(`@tsonic/target-python: tsonic manifest target must be '${pythonTargetId}', got '${String(target)}'.`);
  }
  return { kind, target };
}

export interface TsonicCapabilityPluginManifest {
  readonly kind: "target-capability";
  readonly target: string;
  readonly id: string;
  readonly modules: readonly string[];
}

// Installed capability plugins declare a manifest; activation is
// import-driven (a capability only resolves modules the source imports), but
// the manifest must agree with the capability it ships.
export function validateTsonicCapabilityManifest(
  manifest: TsonicCapabilityPluginManifest,
  capability: TsonicTargetCapabilityPlugin,
): void {
  if (manifest.kind !== "target-capability") {
    throw new Error(`Capability plugin manifest kind must be 'target-capability', got '${String(manifest.kind)}'.`);
  }
  if (manifest.target !== capability.targetId) {
    throw new Error(`Capability plugin manifest target '${manifest.target}' does not match capability target '${capability.targetId}'.`);
  }
  if (manifest.id !== capability.id) {
    throw new Error(`Capability plugin manifest id '${manifest.id}' does not match capability id '${capability.id}'.`);
  }
  const manifestModules = [...manifest.modules].sort((left, right) => left.localeCompare(right, "en"));
  const ownedModules = capability.moduleOwnership
    .map((entry) => entry.specifierPrefix)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (JSON.stringify(manifestModules) !== JSON.stringify(ownedModules)) {
    throw new Error(`Capability plugin manifest modules [${manifestModules.join(", ")}] do not match owned modules [${ownedModules.join(", ")}].`);
  }
}

export function createTsonicPlugin(): TsonicTargetPlugin {
  const manifest = readTsonicPluginManifest();
  return {
    kind: "target",
    id: "@tsonic/target-python",
    targetId: manifest.target,
    createTargetPack: createPythonTargetPack,
  };
}
