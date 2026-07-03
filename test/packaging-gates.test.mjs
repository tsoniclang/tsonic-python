import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { compilePython } from "./helpers/python-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function compileFor(version) {
  const target = {
    id: "python",
    options: { pythonVersion: version, packageName: `gate_${version.replace(".", "")}` },
  };
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function answer(base: int32): int32 {
  return base * 6;
}
`,
    },
    target,
  });
  assert.deepEqual(result.diagnostics, []);
  return result;
}

test("generated layout is wheel-ready and injection-free", () => {
  const result = compileFor("3.12");
  const paths = result.artifacts.map((artifact) => artifact.path);
  assert.ok(paths.includes("pyproject.toml"));
  assert.ok(paths.includes("src/gate_312/__init__.py"));
  assert.ok(paths.includes("src/gate_312/py.typed"));
  assert.ok(paths.includes("src/gate_312/index.py"));
  for (const path of paths) {
    assert.ok(path === "pyproject.toml" || path.startsWith("src/gate_312/"), `unexpected artifact path ${path}`);
  }
  const pyproject = result.artifacts.find((artifact) => artifact.path === "pyproject.toml").text;
  assert.match(pyproject, /\[build-system\]/u);
  assert.match(pyproject, /requires = \["hatchling"\]/u);

  const projectRoot = materialize("gate_toml", result.artifacts);
  const parse = spawnSync("python3", ["-c", 'import tomllib; tomllib.load(open("pyproject.toml", "rb")); print("TOML-OK")'], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.equal(parse.status, 0, parse.stderr);
  assert.match(parse.stdout, /TOML-OK/u);
});

for (const version of ["3.12", "3.13", "3.14"]) {
  test(`compile/import/runtime gates under python ${version}`, (t) => {
    const interpreter = `python${version}`;
    const probe = spawnSync(interpreter, ["--version"], { encoding: "utf8" });
    if (probe.error !== undefined || probe.status !== 0) {
      t.skip(`environment: ${interpreter} is not installed on this machine`);
      return;
    }
    const result = compileFor(version);
    const packageName = `gate_${version.replace(".", "")}`;
    const projectRoot = materialize(`gate_${version.replace(".", "")}`, result.artifacts);

    const compile = spawnSync(interpreter, ["-m", "compileall", "-q", "src"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr);

    const runnerFile = join(projectRoot, "runner.py");
    writeFileSync(runnerFile, [
      `from ${packageName}.index import answer`,
      "",
      "assert answer(7) == 42",
      `print("GATE-${version}-OK")`,
      "",
    ].join("\n"));
    const run = spawnSync(interpreter, [runnerFile], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, new RegExp(`GATE-${version.replace(".", "\\.")}-OK`, "u"));
  });
}
