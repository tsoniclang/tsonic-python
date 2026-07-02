import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  acmeFilesPackage,
  acmeMathPackage,
  acmePlatformPackage,
  compilePython,
  fixturePackagesRoot,
} from "./helpers/python-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoot = join(repositoryRoot, ".temp", "generated");

function materialize(name, artifacts) {
  const projectRoot = join(generatedRoot, name);
  rmSync(projectRoot, { recursive: true, force: true });
  for (const artifact of artifacts) {
    const filePath = join(projectRoot, artifact.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, artifact.text);
  }
  return projectRoot;
}

function runPython(args, options = {}) {
  const run = spawnSync("python3", args, { encoding: "utf8", ...options });
  assert.equal(run.status, 0, `python3 ${args.join(" ")} failed:\n${run.stdout}\n${run.stderr}`);
  return run;
}

test("generated package passes compileall and executes with asserted output", () => {
  const { result } = compilePython({
    files: {
      "util.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function double(value: int32): int32 {
  return value + value;
}
`,
      "index.ts": `
import { double } from "./util.js";
import { add } from "@acme/math";
import { readText } from "@acme/files";
import { Env } from "@acme/platform";
import type { int32 } from "@tsonic/core/types.js";

export function compute(): int32 {
  const values: int32[] = [1, 2, 3];
  values.push(double(2));
  let total: int32 = 0;
  for (const value of values) {
    total = total + value;
  }
  return add(total, values.length);
}

export function describe(path: string): string {
  const env = new Env();
  return readText(path) + ":" + env.homeDir;
}
`,
    },
    packages: [acmeMathPackage(), acmeFilesPackage(), acmePlatformPackage()],
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_package", result.artifacts);

  runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot });

  const noteFile = join(projectRoot, "note.txt");
  writeFileSync(noteFile, "hello-from-file");
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "import sys",
    "",
    "from tsonic_generated.index import compute, describe",
    "",
    "assert compute() == 14, compute()",
    `assert describe(${JSON.stringify(noteFile)}) == "hello-from-file:/home/acme"`,
    'print("TSONIC-PY-OK")',
    "",
  ].join("\n"));

  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONPATH: [join(projectRoot, "src"), fixturePackagesRoot].join(":"),
    },
  });
  assert.match(run.stdout, /TSONIC-PY-OK/u);
});

test("script output runs as python -m package via generated __main__", () => {
  const target = { id: "python", options: { outputType: "script", packageName: "cli_proof" } };
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const values: int32[] = [1, 2, 3];
  values.push(4);
  let total: int32 = 0;
  for (const value of values) {
    total = total + value;
  }
}
`,
    },
    target,
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_script", result.artifacts);

  runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot });
  runPython(["-m", "cli_proof"], {
    cwd: projectRoot,
    timeout: 20000,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
});

test("integer division and remainder truncate toward zero at runtime", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function quot(a: int32, b: int32): int32 {
  return a / b;
}

export function rem(a: int32, b: int32): int32 {
  return a % b;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_intmath", result.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from tsonic_generated.index import quot, rem",
    "",
    "assert quot(7, 2) == 3",
    "assert quot(-7, 2) == -3, quot(-7, 2)",
    "assert quot(7, -2) == -3, quot(7, -2)",
    "assert quot(-7, -2) == 3",
    "assert quot(-6, 2) == -3",
    "assert rem(7, 2) == 1",
    "assert rem(-7, 2) == -1, rem(-7, 2)",
    "assert rem(7, -2) == 1, rem(7, -2)",
    "assert rem(-7, -2) == -1",
    "assert rem(-6, 2) == 0",
    'print("INT-CONTRACT-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /INT-CONTRACT-OK/u);
});

test("classes, enums, records, errors, and async execute with asserted output", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export enum Level {
  Low = 1,
  High = 3,
}

export interface Point {
  x: int32;
  y: int32;
}

export class Accumulator {
  total: int32;

  constructor(start: int32) {
    this.total = start;
  }

  add(amount: int32): int32 {
    this.total = this.total + amount;
    return this.total;
  }
}

export function build(x: int32): Point {
  return { x, y: x * 2 };
}

export function sumFor(point: Point, level: Level): int32 {
  const acc = new Accumulator(0);
  const { x, y } = point;
  for (let i: int32 = 0; i < 3; i++) {
    acc.add(x + y + i);
  }
  if (level === Level.High) {
    acc.add(100);
  }
  return acc.total;
}

export function guarded(flag: boolean): string {
  try {
    if (flag) {
      throw new Error("expected-failure");
    }
    return "clean";
  } catch (error: any) {
    return error.message;
  }
}

export async function slowDouble(value: int32): Promise<int32> {
  return value + value;
}

export async function slowQuadruple(value: int32): Promise<int32> {
  const once: int32 = await slowDouble(value);
  return await slowDouble(once);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_closure", result.artifacts);

  runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot });

  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "import asyncio",
    "",
    "from tsonic_generated.index import (",
    "    Accumulator,",
    "    Level,",
    "    build,",
    "    guarded,",
    "    slowQuadruple,",
    "    sumFor,",
    ")",
    "",
    "point = build(5)",
    "assert (point.x, point.y) == (5, 10)",
    "assert sumFor(point, Level.High) == 148, sumFor(point, Level.High)",
    "assert sumFor(point, Level.Low) == 48",
    "assert Accumulator(7).add(3) == 10",
    'assert guarded(False) == "clean"',
    'assert guarded(True) == "expected-failure"',
    "assert asyncio.run(slowQuadruple(3)) == 12",
    'print("CLOSURE-OK")',
    "",
  ].join("\n"));

  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /CLOSURE-OK/u);
});

test("generated modules parse under the python ast module", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function shoutAt(name: string, loud: boolean): string {
  if (loud) {
    return name + "!";
  }
  return name;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_parse", result.artifacts);
  runPython(["-c", `
import ast, pathlib
for path in pathlib.Path("src").rglob("*.py"):
    ast.parse(path.read_text())
print("PARSE-OK")
`], { cwd: projectRoot });
});
