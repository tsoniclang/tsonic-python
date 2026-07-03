import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  createTsonicPlugin,
  readTsonicPluginManifest,
  validateTsonicCapabilityManifest,
} from "../dist/index.js";
import { acmeFilesCapability, artifactText, compilePython } from "./helpers/python-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("package.json carries the tsonic target plugin manifest", () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  assert.deepEqual(packageJson.tsonic, { kind: "target", target: "python" });
  assert.deepEqual(readTsonicPluginManifest(), { kind: "target", target: "python" });
});

test("createTsonicPlugin exposes the installed target plugin contract", () => {
  const plugin = createTsonicPlugin();
  assert.equal(plugin.kind, "target");
  assert.equal(plugin.id, "@tsonic/target-python");
  assert.equal(plugin.targetId, "python");
  const pack = plugin.createTargetPack();
  assert.equal(pack.id, "python");
  assert.equal("packages" in pack, false);
});

test("capability plugins expose the installed capability contract", () => {
  const capability = acmeFilesCapability();
  assert.equal(capability.kind, "target-capability");
  assert.equal(capability.targetId, "python");
  assert.ok(capability.moduleOwnership.some((entry) => entry.specifierPrefix === "@acme/files"));
});

test("capability manifests validate against the shipped capability", () => {
  const capability = acmeFilesCapability();
  const manifest = {
    kind: "target-capability",
    target: "python",
    id: "acme-files",
    modules: ["@acme/files"],
  };
  validateTsonicCapabilityManifest(manifest, capability);

  assert.throws(
    () => validateTsonicCapabilityManifest({ ...manifest, target: "rust" }, capability),
    /does not match capability target/u,
  );
  assert.throws(
    () => validateTsonicCapabilityManifest({ ...manifest, id: "acme-other" }, capability),
    /does not match capability id/u,
  );
  assert.throws(
    () => validateTsonicCapabilityManifest({ ...manifest, modules: ["@acme/files", "@acme/ghost"] }, capability),
    /do not match owned modules/u,
  );
});

test("capability activation is import-driven: installed but unimported capabilities do not shape output", () => {
  const source = {
    "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function pure(value: int32): int32 {
  return value + 1;
}
`,
  };
  const withCapability = compilePython({ files: source, capabilities: [acmeFilesCapability()] });
  const withoutCapability = compilePython({ files: source });

  assert.deepEqual(withCapability.result.diagnostics, []);
  assert.equal(
    artifactText(withCapability.result, "src/tsonic_generated/index.py"),
    artifactText(withoutCapability.result, "src/tsonic_generated/index.py"),
  );
});
