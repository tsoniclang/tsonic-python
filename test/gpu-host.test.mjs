import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createPythonGpuHostIntegration } from "../dist/index.js";
import { compilePython } from "./helpers/python-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tritonGoldenRoot = resolve(repositoryRoot, "../gpu-triton/test/golden");

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

function materialize(name, artifacts) {
  const projectRoot = join(repositoryRoot, ".temp", "generated", name);
  rmSync(projectRoot, { recursive: true, force: true });
  for (const artifact of artifacts) {
    const filePath = join(projectRoot, artifact.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, artifact.text);
  }
  return projectRoot;
}

test("real gpu-triton golden kernels package through the host contract", (t) => {
  const goldenPath = join(tritonGoldenRoot, "add.py");
  if (!existsSync(goldenPath)) {
    t.skip("environment: ../gpu-triton golden fixtures are not checked out");
    return;
  }
  // Real generated Triton module and the exact request shapes gpu-triton
  // emits (dependency and wrapper rows mirror its lowering tests).
  const integration = createPythonGpuHostIntegration({
    target,
    runtimeReferences: [],
    compileResult: compiledBase(),
  });
  assert.equal(integration.hostTargetId, "python");
  const packaged = integration.packageArtifacts({
    backendId: "gpu-triton",
    hostTargetId: "python",
    moduleName: "index",
    modules: [{ path: "add.py", language: "python", text: readFileSync(goldenPath, "utf8") }],
    dependencies: [{ ecosystem: "python", name: "triton" }],
    launchWrappers: [{ hostFunctionName: "add", kernelName: "add", metaParameters: [] }],
  });

  assert.deepEqual(packaged.diagnostics, []);
  const paths = packaged.artifacts.map((artifact) => artifact.path);
  assert.ok(paths.includes("src/tsonic_generated/kernels/add.py"));
  const initText = packaged.artifacts.find((artifact) => artifact.path === "src/tsonic_generated/kernels/__init__.py").text;
  assert.match(initText, /from \.add import add/u);
  const pyproject = packaged.artifacts.find((artifact) => artifact.path === "pyproject.toml");
  assert.match(pyproject.text, /"triton",/u);

  // Triton itself is dependency-gated in this environment: layout and
  // compile gates must hold without importing the kernel module.
  const projectRoot = materialize("exec_gpu_triton", packaged.artifacts);
  const compile = spawnSync("python3", ["-m", "compileall", "-q", "src"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stderr);
  assert.match(
    readFileSync(join(projectRoot, "src/tsonic_generated/kernels/add.py"), "utf8"),
    /@triton\.jit/u,
  );
});

test("pure-python wrapper path executes through the kernels package", () => {
  const integration = createPythonGpuHostIntegration({
    target,
    runtimeReferences: [],
    compileResult: compiledBase(),
  });
  const packaged = integration.packageArtifacts({
    backendId: "gpu-fake",
    hostTargetId: "python",
    moduleName: "index",
    modules: [{
      path: "scale.py",
      language: "python",
      text: "def scale(values, factor):\n    return [value * factor for value in values]\n",
    }],
    dependencies: [],
    launchWrappers: [{ hostFunctionName: "scale", kernelName: "scale", metaParameters: [] }],
  });

  assert.deepEqual(packaged.diagnostics, []);
  const projectRoot = materialize("exec_gpu_wrapper", packaged.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from tsonic_generated.kernels import scale",
    "from tsonic_generated.index import host",
    "",
    "assert scale([1, 2, 3], 4) == [4, 8, 12]",
    "assert host(1) == 2",
    'print("GPU-WRAPPER-OK")',
    "",
  ].join("\n"));
  const run = spawnSync("python3", [runnerFile], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /GPU-WRAPPER-OK/u);
});

test("unsupported GPU host requests fail closed", () => {
  const integration = createPythonGpuHostIntegration({
    target,
    runtimeReferences: [],
    compileResult: compiledBase(),
  });

  const wrongTarget = integration.packageArtifacts({
    backendId: "gpu-triton",
    hostTargetId: "rust",
    moduleName: "index",
    modules: [],
    dependencies: [],
    launchWrappers: [],
  });
  assert.equal(wrongTarget.artifacts.length, 0);
  assert.match(wrongTarget.diagnostics[0].message, /targets 'rust'/u);

  const nestedPath = integration.packageArtifacts({
    backendId: "gpu-triton",
    hostTargetId: "python",
    moduleName: "index",
    modules: [{ path: "../escape.py", language: "python", text: "" }],
    dependencies: [],
    launchWrappers: [],
  });
  assert.equal(nestedPath.artifacts.length, 0);
  assert.match(nestedPath.diagnostics[0].message, /does not map to a flat Python kernel module/u);

  const wrongEcosystem = integration.packageArtifacts({
    backendId: "gpu-triton",
    hostTargetId: "python",
    moduleName: "index",
    modules: [{ path: "k.py", language: "python", text: "" }],
    dependencies: [{ ecosystem: "cargo", name: "tsonic_gpu" }],
    launchWrappers: [],
  });
  assert.equal(wrongEcosystem.artifacts.length, 0);
  assert.match(wrongEcosystem.diagnostics[0].message, /ecosystem 'cargo'/u);

  const ghostWrapper = integration.packageArtifacts({
    backendId: "gpu-triton",
    hostTargetId: "python",
    moduleName: "index",
    modules: [{ path: "k.py", language: "python", text: "" }],
    dependencies: [],
    launchWrappers: [{ hostFunctionName: "launch", kernelName: "ghost", metaParameters: [] }],
  });
  assert.equal(ghostWrapper.artifacts.length, 0);
  assert.match(ghostWrapper.diagnostics[0].message, /contributed no module/u);
});
