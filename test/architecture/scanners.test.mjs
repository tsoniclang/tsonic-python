import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = join(repositoryRoot, "src");

function collectFiles(root, extension) {
  const results = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (fullPath.endsWith(extension)) {
        results.push(fullPath);
      }
    }
  };
  visit(root);
  return results;
}

const sourceFiles = collectFiles(sourceRoot, ".ts").map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

test("no NUL or control bytes in product sources", () => {
  // Tab, LF, and CR are the only control characters allowed in source text;
  // invisible bytes (NUL separators and friends) are unreviewable.
  for (const { path, text } of sourceFiles) {
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        assert.fail(`${path} contains control byte 0x${code.toString(16).padStart(2, "0")} at offset ${index}`);
      }
    }
  }
});

test("no internal TSTS imports", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /from "@tsonic\/tsts\/.+"/u, `${path} imports a deep tsts path`);
    assert.doesNotMatch(text, /dist\/src\/internal/u, `${path} references tsts internals`);
  }
});

test("no source-name target guessing in the backend", () => {
  const bannedTokens = [
    '"node:',
    '"@acme',
    '"@python',
    "readText",
    "readFileSync",
    '"Math"',
    '"console"',
    '"push"',
    '"readFile"',
    '"torch"',
    '"numpy"',
    '"pathlib"',
  ];
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    for (const token of bannedTokens) {
      assert.ok(!text.includes(token), `${path} contains banned source-name token ${token}`);
    }
  }
});

test("no other-target references in Python target code", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /csharp|roslyn|dotnet|cargo|rustc/iu, `${path} references another target`);
  }
});

test("no embedded JS engine or runtime interpretation dependencies", () => {
  const packageJson = readFileSync(join(repositoryRoot, "package.json"), "utf8");
  const banned = /quickjs|boa_engine|deno_core|"v8"|pyodide|mini_racer|pythonmonkey/iu;
  assert.doesNotMatch(packageJson, banned);
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, banned, `${path} references an embedded JS engine`);
  }
});

test("no runtime python code inside tsonic-python", () => {
  const pythonFiles = collectFiles(sourceRoot, ".py");
  assert.deepEqual(pythonFiles, [], "tsonic-python src must not contain Python runtime sources");
  assert.throws(() => statSync(join(repositoryRoot, "runtime")), /ENOENT/u);
});

test("no product dependency on analysis files", () => {
  for (const { path, text } of sourceFiles) {
    assert.ok(!text.includes(".analysis/") && !text.includes('".analysis"'), `${path} references .analysis`);
  }
});

test("no Node-as-surface registration", async () => {
  const { createPythonTargetPack } = await import("../../dist/index.js");
  const pack = createPythonTargetPack();
  for (const surface of pack.surfaces ?? []) {
    assert.notEqual(surface.id, "node");
    assert.notEqual(surface.id, "nodejs");
  }
});

test("no fallback source emission: backend diagnostics never coexist with artifacts", () => {
  // Structural rule enforced in planPythonArtifacts: every early return with
  // diagnostics returns an empty artifact list. Verified behaviorally in the
  // fail-closed tests; here we pin the source pattern.
  const plannerText = readFileSync(join(sourceRoot, "backend/planner/python-planner.ts"), "utf8");
  assert.match(plannerText, /if \(diagnostics\.length > 0\) \{\s*return \{ artifacts: \[\], diagnostics \};/u);
});
