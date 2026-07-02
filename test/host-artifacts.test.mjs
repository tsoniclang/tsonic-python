import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePythonHostArtifacts } from "../dist/index.js";
import { compilePython } from "./helpers/python-session.mjs";

const target = { id: "python", options: {} };

function compiledBase() {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function host(value: int32): int32 {
  return value + 1;
}
`,
    },
    target,
  });
  assert.deepEqual(result.diagnostics, []);
  return result;
}

// Stands in for a tsonic-gpu/gpu-triton backend contribution: this repo only
// places the artifacts, it never inspects kernel content.
const fakeKernelContribution = {
  modules: [{
    name: "add_vectors",
    language: "python",
    text: "# fake generated kernel module\n\ndef launch():\n    return 0\n",
  }],
  dependencies: [{ name: "triton", version: "3.0.0" }],
};

test("host contributions place kernel modules and merge dependencies", () => {
  const merged = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: compiledBase(),
    contributions: [fakeKernelContribution],
  });

  assert.deepEqual(merged.diagnostics, []);
  const paths = merged.artifacts.map((artifact) => artifact.path);
  assert.ok(paths.includes("src/tsonic_generated/kernels/__init__.py"));
  assert.ok(paths.includes("src/tsonic_generated/kernels/add_vectors.py"));
  const pyproject = merged.artifacts.find((artifact) => artifact.path === "pyproject.toml");
  assert.match(pyproject.text, /"triton==3\.0\.0",/u);
  const kernel = merged.artifacts.find((artifact) => artifact.path === "src/tsonic_generated/kernels/add_vectors.py");
  assert.equal(kernel.kind, "source");
  assert.equal(kernel.language, "python");
  assert.match(kernel.text, /def launch\(\):/u);
});

test("empty contribution lists pass the compile result through unchanged", () => {
  const base = compiledBase();
  const merged = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: base,
    contributions: [],
  });
  assert.deepEqual(merged, base);
});

test("failed compiles never receive host artifacts", () => {
  const failed = {
    artifacts: [],
    diagnostics: [{ code: "PYTHON_UNSUPPORTED_AST", category: "error", message: "x", source: "tsonic-python" }],
  };
  const merged = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: failed,
    contributions: [fakeKernelContribution],
  });
  assert.equal(merged.artifacts.length, 0);
  assert.equal(merged.diagnostics.length, 1);
});

test("unsupported host requests fail closed with zero artifacts", () => {
  const base = compiledBase();

  const badLanguage = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: base,
    contributions: [{ modules: [{ name: "kern", language: "cuda-c", text: "" }], dependencies: [] }],
  });
  assert.equal(badLanguage.artifacts.length, 0);
  assert.equal(badLanguage.diagnostics[0].code, "PYTHON_UNSUPPORTED_HOST_ARTIFACT");
  assert.ok(badLanguage.diagnostics[0].evidence.includes("host.language=cuda-c"));

  const badName = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: base,
    contributions: [{ modules: [{ name: "bad name", language: "python", text: "" }], dependencies: [] }],
  });
  assert.equal(badName.artifacts.length, 0);
  assert.equal(badName.diagnostics[0].code, "PYTHON_UNSUPPORTED_HOST_ARTIFACT");

  const duplicate = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: base,
    contributions: [
      { modules: [{ name: "kern", language: "python", text: "" }], dependencies: [] },
      { modules: [{ name: "kern", language: "python", text: "" }], dependencies: [] },
    ],
  });
  assert.equal(duplicate.artifacts.length, 0);
  assert.match(duplicate.diagnostics[0].message, /contributed more than once/u);

  const badDependency = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: base,
    contributions: [{ modules: [], dependencies: [{ name: 'evil"]\n[inject' }] }],
  });
  assert.equal(badDependency.artifacts.length, 0);
  assert.equal(badDependency.diagnostics[0].code, "PYTHON_UNSUPPORTED_RUNTIME_REFERENCE");
});
