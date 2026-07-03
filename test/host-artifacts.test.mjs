import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergePythonHostArtifacts } from "../dist/index.js";
import { compilePython } from "./helpers/python-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function materializeHost(name, artifacts) {
  const projectRoot = join(repositoryRoot, ".temp", "generated", name);
  rmSync(projectRoot, { recursive: true, force: true });
  for (const artifact of artifacts) {
    const filePath = join(projectRoot, artifact.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, artifact.text);
  }
  return projectRoot;
}

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

test("conflicting host dependency versions fail closed", () => {
  const base = compiledBase();
  const merged = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: base,
    contributions: [
      { modules: [], dependencies: [{ name: "triton", version: "3.0.0" }] },
      { modules: [], dependencies: [{ name: "triton", version: "3.1.0" }] },
    ],
  });
  assert.equal(merged.artifacts.length, 0);
  assert.equal(merged.diagnostics[0].code, "PYTHON_UNSUPPORTED_RUNTIME_REFERENCE");
});

test("merged host kernels place deterministically and import at runtime", () => {
  const merged = mergePythonHostArtifacts({
    target,
    runtimeReferences: [],
    compileResult: compiledBase(),
    contributions: [
      {
        modules: [
          { name: "zeta_kernel", language: "python", text: "def launch():\n    return 7\n" },
          { name: "alpha_kernel", language: "python", text: "def launch():\n    return 5\n" },
        ],
        dependencies: [],
      },
    ],
  });

  assert.deepEqual(merged.diagnostics, []);
  const kernelPaths = merged.artifacts
    .map((artifact) => artifact.path)
    .filter((path) => path.includes("/kernels/") && !path.endsWith("__init__.py"));
  assert.deepEqual(kernelPaths, [
    "src/tsonic_generated/kernels/alpha_kernel.py",
    "src/tsonic_generated/kernels/zeta_kernel.py",
  ]);

  const projectRoot = materializeHost("exec_host_kernels", merged.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from tsonic_generated.kernels import alpha_kernel, zeta_kernel",
    "from tsonic_generated.index import host",
    "",
    "assert alpha_kernel.launch() == 5",
    "assert zeta_kernel.launch() == 7",
    "assert host(1) == 2",
    'print("HOST-KERNELS-OK")',
    "",
  ].join("\n"));
  const run = spawnSync("python3", [runnerFile], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /HOST-KERNELS-OK/u);
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
