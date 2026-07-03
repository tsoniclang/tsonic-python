import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createTsonicPlugin } from "../dist/index.js";
import { acmeFilesCapability, artifactText, compilePython } from "./helpers/python-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("package.json carries the generic host plugin manifest and exports package.json", () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  assert.deepEqual(packageJson.tsonic, { kind: "plugin", contractVersion: 1, entry: "." });
  assert.equal(packageJson.exports["./package.json"], "./package.json");
});

test("createTsonicPlugin carries the target identity", () => {
  const plugin = createTsonicPlugin();
  assert.equal(plugin.kind, "target");
  assert.equal(plugin.id, "@tsonic/target-python");
  assert.equal(plugin.targetId, "python");
  const pack = plugin.createTargetPack();
  assert.equal(pack.id, "python");
  assert.equal("packages" in pack, false);
});

test("host discovery loads the installed package layout end to end", () => {
  // Simulated installed project: @tsonic/target-python in node_modules,
  // driven the way host discovery drives it — package.json resolved through
  // package exports, manifest validated, entry imported, plugin created,
  // and the pack registered.
  const projectRoot = join(repositoryRoot, ".temp", "installed-layout");
  rmSync(projectRoot, { recursive: true, force: true });
  mkdirSync(join(projectRoot, "node_modules", "@tsonic"), { recursive: true });
  symlinkSync(repositoryRoot, join(projectRoot, "node_modules", "@tsonic", "target-python"), "dir");
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
    name: "installed-layout-proof",
    private: true,
    type: "module",
    dependencies: { "@tsonic/target-python": "0.0.1" },
  }, null, 2));
  writeFileSync(join(projectRoot, "probe.mjs"), [
    'import { createRequire } from "node:module";',
    'import { pathToFileURL } from "node:url";',
    "",
    'const requireFromProject = createRequire(new URL("./package.json", import.meta.url));',
    "",
    'const manifestPath = requireFromProject.resolve("@tsonic/target-python/package.json");',
    'const packageJson = JSON.parse((await import("node:fs")).readFileSync(manifestPath, "utf8"));',
    "const manifest = packageJson.tsonic;",
    'if (manifest.kind !== "plugin") throw new Error("manifest kind must be plugin");',
    'if (manifest.contractVersion !== 1) throw new Error("unsupported contract version");',
    'if (typeof manifest.entry !== "string" || manifest.entry.length === 0) throw new Error("missing entry");',
    "",
    'const entryPath = requireFromProject.resolve(manifest.entry === "." ? "@tsonic/target-python" : `@tsonic/target-python/${manifest.entry}`);',
    "const module = await import(pathToFileURL(entryPath).href);",
    'if (typeof module.createTsonicPlugin !== "function") throw new Error("entry must export createTsonicPlugin()");',
    "",
    "const plugin = module.createTsonicPlugin();",
    'if (plugin.kind !== "target") throw new Error("plugin kind must be target");',
    'if (plugin.targetId !== "python") throw new Error("plugin targetId must be python");',
    "",
    'const { createTargetRegistry } = await import(pathToFileURL(requireFromProject.resolve("@tsonic/target-api")).href);',
    "const registry = createTargetRegistry([plugin.createTargetPack()]);",
    'const pack = registry.get("python");',
    'if (pack === undefined || pack.id !== "python") throw new Error("target did not register");',
    'console.log("DISCOVERY-OK", plugin.id, pack.displayName);',
    "",
  ].join("\n"));

  const run = spawnSync(process.execPath, [join(projectRoot, "probe.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /DISCOVERY-OK @tsonic\/target-python Python/u);
});

test("capability plugins expose the installed capability contract", () => {
  const capability = acmeFilesCapability();
  assert.equal(capability.kind, "target-capability");
  assert.equal(capability.targetId, "python");
  assert.ok(capability.moduleOwnership.some((entry) => entry.specifierPrefix === "@acme/files"));
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
