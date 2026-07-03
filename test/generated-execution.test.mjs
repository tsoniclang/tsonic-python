import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  acmeAioCapability,
  acmeFilesCapability,
  acmeMathCapability,
  acmePathsCapability,
  acmePlatformCapability,
  compilePython,
  fixturePackagesRoot,
  pythonJsRuntimeRoot,
} from "./helpers/python-session.mjs";
import {
  createPythonAsyncioCapability,
  createPythonMathCapability,
  createPythonOsCapability,
  createPythonPathlibCapability,
} from "../dist/source/capabilities/stdlib.js";

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
    capabilities: [acmeMathCapability(), acmeFilesCapability(), acmePlatformCapability()],
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

test("stdlib-style provider class executes against its fixture package", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { FilePath } from "@acme/paths";

export function rename(path: string, ext: string): string {
  const file = new FilePath(path);
  const next = file.withSuffix(ext);
  return next.suffix + FilePath.sep;
}
`,
    },
    capabilities: [acmePathsCapability()],
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_paths", result.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from tsonic_generated.index import rename",
    "",
    'assert rename("notes.txt", ".md") == ".md/", rename("notes.txt", ".md")',
    'assert rename("archive", ".tar") == ".tar/"',
    'print("PATHS-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONPATH: [join(projectRoot, "src"), fixturePackagesRoot].join(":"),
    },
  });
  assert.match(run.stdout, /PATHS-OK/u);
});

test("async provider rows execute against a real async fixture package", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { fetchText } from "@acme/aio";

export async function load(key: string): Promise<string> {
  const body: string = await fetchText(key);
  return body + "!";
}
`,
    },
    capabilities: [acmeAioCapability()],
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_aio", result.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "import asyncio",
    "",
    "from tsonic_generated.index import load",
    "",
    'assert asyncio.run(load("news")) == "aio:news!"',
    'print("AIO-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONPATH: [join(projectRoot, "src"), fixturePackagesRoot].join(":"),
    },
  });
  assert.match(run.stdout, /AIO-OK/u);
});

test("stdlib provider rows execute against the real Python standard library", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { sqrt, floor } from "@python/math";
import { Path } from "@python/pathlib";
import { getcwd, os } from "@python/os";
import type { float64, int64 } from "@tsonic/core/types.js";

export function root(x: float64): float64 {
  return sqrt(x);
}

export function wholes(x: float64): int64 {
  return floor(x);
}

export function renamed(p: string): string {
  return new Path(p).withSuffix(".md").suffix;
}

export function separator(): string {
  return os.sep;
}

export function here(): string {
  return getcwd();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_stdlib", result.artifacts);
  runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot });
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from tsonic_generated.index import here, renamed, root, separator, wholes",
    "",
    "assert root(9.0) == 3.0, root(9.0)",
    "assert wholes(3.9) == 3, wholes(3.9)",
    "assert wholes(-1.5) == -2, wholes(-1.5)",
    'assert renamed("notes.txt") == ".md", renamed("notes.txt")',
    "assert len(separator()) == 1, separator()",
    "assert isinstance(here(), str) and len(here()) > 0",
    'print("STDLIB-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /STDLIB-OK/u);
});

test("awaited asyncio.sleep and a project async function execute through asyncio.run", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { sleep } from "@python/asyncio";
import type { int32 } from "@tsonic/core/types.js";

export async function slowDouble(value: int32): Promise<int32> {
  return value + value;
}

export async function pausedQuadruple(value: int32): Promise<int32> {
  await sleep(0.001);
  const once: int32 = await slowDouble(value);
  return await slowDouble(once);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_stdlib_async", result.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "import asyncio",
    "",
    "from tsonic_generated.index import pausedQuadruple",
    "",
    "assert asyncio.run(pausedQuadruple(3)) == 12",
    'print("STDLIB-ASYNC-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /STDLIB-ASYNC-OK/u);
});

test("cross-module async calls execute through asyncio.run", () => {
  const { result } = compilePython({
    files: {
      "worker.ts": `
import type { int32 } from "@tsonic/core/types.js";

export async function crunch(value: int32): Promise<int32> {
  return value * 3;
}
`,
      "index.ts": `
import { crunch } from "./worker.js";
import type { int32 } from "@tsonic/core/types.js";

export async function orchestrate(value: int32): Promise<int32> {
  const once: int32 = await crunch(value);
  const twice: int32 = await crunch(once);
  return twice;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_async_cross", result.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "import asyncio",
    "",
    "from tsonic_generated.index import orchestrate",
    "",
    "assert asyncio.run(orchestrate(2)) == 18",
    'print("CROSS-ASYNC-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /CROSS-ASYNC-OK/u);
});

test("async script entry runs via asyncio.run under python -m", () => {
  const target = { id: "python", options: { outputType: "script", packageName: "async_cli" } };
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export async function step(value: int32): Promise<int32> {
  return value + 1;
}

export async function main(): Promise<void> {
  const first: int32 = await step(1);
  const second: int32 = await step(first);
}
`,
    },
    target,
  });

  assert.deepEqual(result.diagnostics, []);
  const mainArtifact = result.artifacts.find((artifact) => artifact.path === "src/async_cli/__main__.py");
  assert.ok(mainArtifact);
  assert.match(mainArtifact.text, /import asyncio/u);
  assert.match(mainArtifact.text, /asyncio\.run\(main\(\)\)/u);

  const projectRoot = materialize("exec_async_script", result.artifacts);
  runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot });
  runPython(["-m", "async_cli"], {
    cwd: projectRoot,
    timeout: 20000,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
});

test("python 3.14 target compiles, imports, and runs under the local 3.14 interpreter", () => {
  const target = { id: "python", options: { pythonVersion: "3.14", packageName: "py314_proof" } };
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function triple(value: int32): int32 {
  return value * 3;
}
`,
    },
    target,
  });

  assert.deepEqual(result.diagnostics, []);
  const pyproject = result.artifacts.find((artifact) => artifact.path === "pyproject.toml");
  assert.match(pyproject.text, /requires-python = ">=3\.14"/u);
  assert.match(pyproject.text, /target-version = "py314"/u);

  const versionCheck = runPython(["-c", "import sys; assert sys.version_info[:2] >= (3, 14); print(sys.version_info[:2])"]);
  assert.match(versionCheck.stdout, /\(3, 1[4-9]\)/u);

  const projectRoot = materialize("exec_py314", result.artifacts);
  runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot });
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from py314_proof.index import triple",
    "",
    "assert triple(14) == 42",
    'print("PY314-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /PY314-OK/u);
});

test("expansion lanes execute: f-strings, optionals, dicts, tuples, list search", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function label(name: string, count: int32): string {
  return \`\${name}: \${count}\`;
}

export function fallback(value: string | null): string {
  if (value === null) {
    return "none";
  }
  return value;
}

export function bounds(values: int32[], needle: int32): int32 {
  const table: Record<string, int32> = { low: 1 };
  table["high"] = 9;
  const pair: [int32, int32] = [table["low"], table["high"]];
  if (values.includes(needle)) {
    return values.indexOf(needle) + pair[0] + pair[1];
  }
  return values.indexOf(needle);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_expansion", result.artifacts);
  runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot });
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "from tsonic_generated.index import bounds, fallback, label",
    "",
    'assert label("jobs", 3) == "jobs: 3"',
    'assert fallback(None) == "none"',
    'assert fallback("here") == "here"',
    "assert bounds([4, 5, 6], 5) == 11, bounds([4, 5, 6], 5)",
    "assert bounds([4, 5, 6], 9) == -1",
    'print("EXPANSION-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /EXPANSION-OK/u);
});

test("typed JSON round-trips through generated Python", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { dumps } from "@python/json";
import type { int32 } from "@tsonic/core/types.js";

export function encodeTable(): string {
  const table: Record<string, int32> = { alpha: 1, beta: 2 };
  return dumps(table);
}

export function encodeReading(value: string | null): string {
  return dumps(value);
}

export function encodePair(): string {
  const pair: [string, int32] = ["level", 9];
  return dumps(pair);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const projectRoot = materialize("exec_json", result.artifacts);
  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "import json",
    "",
    "from tsonic_generated.index import encodePair, encodeReading, encodeTable",
    "",
    'assert json.loads(encodeTable()) == {"alpha": 1, "beta": 2}',
    'assert json.loads(encodeReading(None)) is None',
    'assert json.loads(encodeReading("live")) == "live"',
    'assert json.loads(encodePair()) == ["level", 9]',
    'print("JSON-ROUNDTRIP-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: join(projectRoot, "src") },
  });
  assert.match(run.stdout, /JSON-ROUNDTRIP-OK/u);
});

test("JS compat lanes execute against the real tsonic_python_js runtime", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function sparseProbe(): number {
  const xs = [10, , 30];
  xs.push(40);
  if (xs.includes(30) && xs.at(1) === undefined) {
    return xs.length;
  }
  return xs.indexOf(99);
}

export function stringProbe(text: string): number {
  if (text.startsWith("he") && text.includes("ll")) {
    return text.charCodeAt(1);
  }
  return text.charCodeAt(0);
}

export function lengthProbe(text: string): number {
  return text.length;
}

export function equalityProbe(a: number, b: number): boolean {
  return Object.is(a, b);
}

export function jsonProbe(payload: string): string {
  const value = JSON.parse(payload);
  return JSON.stringify(value);
}

export function dynamicProbe(payload: string): string {
  const value = JSON.parse(payload);
  return JSON.stringify(value["inner"]);
}

export function collectionsProbe(): number {
  const table = new Map<string, number>();
  table.set("a", 3);
  table.set("b", 4);
  const tags = new Set<string>();
  tags.add("x");
  tags.add("x");
  return table.size + tags.size;
}

export function dateProbe(): number {
  const when = new Date(86400000);
  return when.getUTCFullYear() + when.getUTCDate();
}

export function typedProbe(): number {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setInt32(0, 41);
  return view.getInt32(0) + view.byteLength;
}
`,
    },
    target: { id: "python", options: { typescriptCompatibility: "compat" } },
  });

  assert.deepEqual(result.diagnostics, []);
  const moduleText = result.artifacts.find((artifact) => artifact.path === "src/tsonic_generated/index.py").text;
  assert.match(moduleText, /tsonic_python_js/u);
  assert.match(result.artifacts.find((artifact) => artifact.path === "pyproject.toml").text, /"tsonic-python-js",/u);

  const projectRoot = materialize("exec_js_compat", result.artifacts);
  const compatEnv = {
    ...process.env,
    PYTHONPATH: [join(projectRoot, "src"), pythonJsRuntimeRoot].join(":"),
  };
  const compileRun = runPython(["-m", "compileall", "-q", "src"], { cwd: projectRoot, env: compatEnv });
  assert.equal(compileRun.status ?? 0, 0);
  runPython(["-c", `
import ast, pathlib
for path in pathlib.Path("src").rglob("*.py"):
    ast.parse(path.read_text())
print("PARSE-OK")
`], { cwd: projectRoot });

  const runnerFile = join(projectRoot, "runner.py");
  writeFileSync(runnerFile, [
    "import json",
    "",
    "from tsonic_generated.index import (",
    "    collectionsProbe,",
    "    dateProbe,",
    "    dynamicProbe,",
    "    equalityProbe,",
    "    lengthProbe,",
    "    jsonProbe,",
    "    sparseProbe,",
    "    stringProbe,",
    "    typedProbe,",
    ")",
    "",
    "assert sparseProbe() == 4, sparseProbe()",
    'assert stringProbe("hello") == 101, stringProbe("hello")',
    'assert lengthProbe("hello") == 5',
    "assert equalityProbe(2.0, 2.0) is True",
    "assert equalityProbe(2.0, 3.0) is False",
    'assert json.loads(jsonProbe(\'{"k": [1, null, true]}\')) == {"k": [1, None, True]}',
    'assert json.loads(dynamicProbe(\'{"inner": {"deep": 7}}\')) == {"deep": 7}',
    "assert collectionsProbe() == 3",
    "assert dateProbe() == 1972, dateProbe()",
    "assert typedProbe() == 49",
    'print("JS-COMPAT-OK")',
    "",
  ].join("\n"));
  const run = runPython([runnerFile], { cwd: projectRoot, env: compatEnv });
  assert.match(run.stdout, /JS-COMPAT-OK/u);
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
