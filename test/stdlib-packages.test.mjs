import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compilePython } from "./helpers/python-session.mjs";
import {
  createPythonAsyncioCapability,
  createPythonDatetimeCapability,
  createPythonMathCapability,
  createPythonOsCapability,
  createPythonPathlibCapability,
  createPythonStdlibCapabilities,
  createPythonSysCapability,
} from "../dist/source/capabilities/stdlib.js";

test("stdlib target capabilities create with unique ids and no dependencies", () => {
  const packages = createPythonStdlibCapabilities();
  assert.equal(packages.length, 7);
  const ids = packages.map((providerPackage) => providerPackage.id);
  assert.deepEqual(ids, [
    "python-math",
    "python-pathlib",
    "python-os",
    "python-sys",
    "python-datetime",
    "python-asyncio",
    "python-json",
  ]);
  assert.equal(new Set(ids).size, ids.length);
  for (const providerPackage of packages) {
    assert.deepEqual(providerPackage.runtimeContributions({}).references, []);
    assert.ok(providerPackage.pythonCapabilityOperations().length > 0);
  }
});

test("math functions lower to module-attribute calls and math.pi to a module attribute", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { sqrt, floor, math } from "@python/math";
import type { float64, int64 } from "@tsonic/core/types.js";

export function circleArea(radius: float64): float64 {
  return math.pi * sqrt(radius);
}

export function wholes(x: float64): int64 {
  return floor(x);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /^import math$/mu);
  assert.match(text, /return math\.pi \* math\.sqrt\(radius\)/u);
  assert.match(text, /def wholes\(x: float\) -> int:/u);
  assert.match(text, /return math\.floor\(x\)/u);
});

test("pathlib Path constructor, chained method, and property lower through rows", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { Path } from "@python/pathlib";

export function renamed(p: string): string {
  return new Path(p).withSuffix(".md").suffix;
}

export function described(p: string): string {
  const path = new Path(p);
  return path.joinpath("child").asPosix() + path.stem + path.name;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /^from pathlib import Path$/mu);
  assert.match(text, /return Path\(p\)\.with_suffix\("\.md"\)\.suffix/u);
  assert.match(text, /path = Path\(p\)/u);
  assert.match(text, /return path\.joinpath\("child"\)\.as_posix\(\) \+ path\.stem \+ path\.name/u);
});

test("os.getcwd call and os.sep attribute lower with a single module import", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { getcwd, os } from "@python/os";

export function whereAmI(): string {
  return getcwd() + os.sep + os.linesep;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /^import os$/mu);
  assert.match(text, /return os\.getcwd\(\) \+ os\.sep \+ os\.linesep/u);
});

test("sys.platform lowers to a module attribute read", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { sys } from "@python/sys";

export function platformName(): string {
  return sys.platform;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /^import sys$/mu);
  assert.match(text, /return sys\.platform/u);
});

test("datetime.now static method chains into instance method and property rows", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { datetime } from "@python/datetime";
import type { int64 } from "@tsonic/core/types.js";

export function stamp(): string {
  return datetime.now().isoformat();
}

export function currentYear(): int64 {
  return datetime.now().year;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /^from datetime import datetime$/mu);
  assert.match(text, /return datetime\.now\(\)\.isoformat\(\)/u);
  assert.match(text, /return datetime\.now\(\)\.year/u);
});

test("asyncio.sleep lowers only as an await operand", () => {
  const awaited = compilePython({
    files: {
      "index.ts": `
import { sleep } from "@python/asyncio";

export async function pause(seconds: number): Promise<void> {
  await sleep(seconds);
}
`,
    },
  });
  assert.deepEqual(awaited.result.diagnostics, []);
  const text = artifactText(awaited.result, "src/tsonic_generated/index.py");
  assert.match(text, /^import asyncio$/mu);
  assert.match(text, /async def pause\(seconds: float\) -> None:/u);
  assert.match(text, /await asyncio\.sleep\(seconds\)/u);

  const unawaited = compilePython({
    files: {
      "index.ts": `
import { sleep } from "@python/asyncio";

export async function pause(seconds: number): Promise<void> {
  sleep(seconds);
}
`,
    },
  });
  assert.equal(unawaited.result.artifacts.length, 0);
  assert.ok(unawaited.result.diagnostics.length > 0);
  assert.ok(unawaited.result.diagnostics.every((diagnostic) => diagnostic.category === "error"));
});
