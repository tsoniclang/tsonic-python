import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("real host discovery loads, registers, compiles, and executes from installed layout", async () => {
  // Simulated installed project: the target plugin and a third-party
  // capability plugin in node_modules, discovered by the REAL host
  // discovery path — no Python-special discovery code.
  const projectRoot = join(repositoryRoot, ".temp", "installed-project");
  rmSync(projectRoot, { recursive: true, force: true });
  mkdirSync(join(projectRoot, "node_modules", "@tsonic"), { recursive: true });
  mkdirSync(join(projectRoot, "node_modules", "@acme"), { recursive: true });
  symlinkSync(repositoryRoot, join(projectRoot, "node_modules", "@tsonic", "target-python"), "dir");
  cpSync(
    join(repositoryRoot, "test", "fixtures", "npm", "acme-tsonic-python-files"),
    join(projectRoot, "node_modules", "@acme", "tsonic-python-files"),
    { recursive: true },
  );
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
    name: "installed-project-proof",
    private: true,
    type: "module",
    dependencies: {
      "@tsonic/target-python": "0.0.1",
      "@acme/tsonic-python-files": "1.0.0",
    },
  }, null, 2));

  const { discoverInstalledTsonicPlugins } = await import("@tsonic/host");
  const registry = await discoverInstalledTsonicPlugins(join(projectRoot, "package.json"));

  assert.deepEqual(registry.diagnostics, []);
  assert.deepEqual(registry.targets.map((plugin) => plugin.id), ["@tsonic/target-python"]);
  assert.deepEqual(registry.capabilities.map((capability) => capability.id), ["@acme/tsonic-python-files"]);

  const targetRegistry = registry.createTargetRegistry();
  const pack = targetRegistry.get("python");
  assert.ok(pack);
  assert.equal(pack.displayName, "Python");

  // Selection through compile through execution, using the discovered
  // capability object exactly as the host would select it.
  const { result } = compilePython({
    files: {
      "index.ts": `
import { readText } from "@acme/files";

export function load(path: string): string {
  return readText(path) + "!";
}
`,
    },
    capabilities: [...registry.capabilities],
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/tsonic_generated/index.py"), /from acme_files import read_text/u);
  const pyproject = artifactText(result, "pyproject.toml");
  assert.match(pyproject, /"acme-files",/u);

  const generatedRoot = join(projectRoot, "generated");
  for (const artifact of result.artifacts) {
    const filePath = join(generatedRoot, artifact.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, artifact.text);
  }
  const noteFile = join(generatedRoot, "note.txt");
  writeFileSync(noteFile, "installed-hello");
  const runnerFile = join(generatedRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from tsonic_generated.index import load",
    "",
    `assert load(${JSON.stringify(noteFile)}) == "installed-hello!"`,
    'print("INSTALLED-OK")',
    "",
  ].join("\n"));
  const run = spawnSync("python3", [runnerFile], {
    cwd: generatedRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: [join(generatedRoot, "src"), join(repositoryRoot, "test", "fixtures", "pypackages")].join(":"),
    },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /INSTALLED-OK/u);
});

test("duplicate capability module ownership fails closed", async () => {
  const { discoverInstalledTsonicPlugins } = await import("@tsonic/host");
  const projectRoot = join(repositoryRoot, ".temp", "installed-project");
  const registry = await discoverInstalledTsonicPlugins(join(projectRoot, "package.json"));
  const duplicate = { ...registry.capabilities[0], id: "@acme/tsonic-python-files-clone" };

  assert.throws(
    () => compilePython({
      files: { "index.ts": "export function idle(): void {}\n" },
      capabilities: [...registry.capabilities, duplicate],
    }),
    /claims module '@acme\/files', already owned by '@acme\/tsonic-python-files'/u,
  );
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
