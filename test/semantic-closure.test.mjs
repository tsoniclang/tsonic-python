import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compilePython } from "./helpers/python-session.mjs";

test("classes lower to Python classes with __init__, methods, and statics", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  count: int32;

  constructor(start: int32) {
    this.count = start;
  }

  bump(step: int32): int32 {
    this.count = this.count + step;
    return this.count;
  }

  static origin(): int32 {
    return 0;
  }
}

export function useCounter(start: int32): int32 {
  const counter = new Counter(start);
  counter.bump(2);
  return counter.count + Counter.origin();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /class Counter:/u);
  assert.match(text, /count: int/u);
  assert.match(text, /def __init__\(self, start: int\) -> None:/u);
  assert.match(text, /self\.count = start/u);
  assert.match(text, /def bump\(self, step: int\) -> int:/u);
  assert.match(text, /self\.count = self\.count \+ step/u);
  assert.match(text, /@staticmethod/u);
  assert.match(text, /def origin\(\) -> int:/u);
  assert.match(text, /counter = Counter\(start\)/u);
  assert.match(text, /counter\.bump\(2\)/u);
  assert.match(text, /counter\.count \+ Counter\.origin\(\)/u);
});

test("enums lower to IntEnum classes and member access", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export enum Color {
  Red = 1,
  Green = 2,
  Blue = 4,
}

export function pick(): int32 {
  const chosen = Color.Green;
  if (chosen === Color.Green) {
    return 1;
  }
  return 0;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /from enum import IntEnum/u);
  assert.match(text, /class Color\(IntEnum\):/u);
  assert.match(text, /Red = 1/u);
  assert.match(text, /Green = 2/u);
  assert.match(text, /Blue = 4/u);
  assert.match(text, /chosen = Color\.Green/u);
  assert.match(text, /if chosen == Color\.Green:/u);
});

test("record interfaces lower to dataclasses and literals to kwargs calls", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Point {
  x: int32;
  y: int32;
}

export function makePoint(x: int32): Point {
  return { x, y: x + 1 };
}

export function sumPoint(point: Point): int32 {
  return point.x + point.y;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /from dataclasses import dataclass/u);
  assert.match(text, /@dataclass/u);
  assert.match(text, /class Point:/u);
  assert.match(text, /x: int/u);
  assert.match(text, /return Point\(x=x, y=x \+ 1\)/u);
  assert.match(text, /return point\.x \+ point\.y/u);
});

test("object and array destructuring lower to per-field reads", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Pair {
  first: int32;
  second: int32;
}

export function unpack(pair: Pair, values: int32[]): int32 {
  const { first, second } = pair;
  const [head, next] = values;
  return first + second + head + next;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /first = pair\.first/u);
  assert.match(text, /second = pair\.second/u);
  assert.match(text, /head = values\[0\]/u);
  assert.match(text, /next = values\[1\]/u);
});

test("throw/try/catch/finally lower to raise and except Exception", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function risky(flag: boolean): string {
  try {
    if (flag) {
      throw new Error("boom");
    }
    return "ok";
  } catch (error: any) {
    return error.message;
  } finally {
    const settled: boolean = true;
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /try:/u);
  assert.match(text, /raise Exception\("boom"\)/u);
  assert.match(text, /except Exception as error:/u);
  assert.match(text, /return str\(error\)/u);
  assert.match(text, /finally:/u);
});

test("async functions and await lower to async def and await", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export async function base(): Promise<int32> {
  return 21;
}

export async function doubled(): Promise<int32> {
  const value: int32 = await base();
  return value + value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /async def base\(\) -> int:/u);
  assert.match(text, /async def doubled\(\) -> int:/u);
  assert.match(text, /value: int = await base\(\)/u);
});

test("parenthesized await operands normalize to the awaited call", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export async function slow(value: int32): Promise<int32> {
  return value;
}

export async function wrapped(value: int32): Promise<int32> {
  const result: int32 = await (slow(value));
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /result: int = await slow\(value\)/u);
});

test("C-style for loops desugar to init plus while", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function total(limit: int32): int32 {
  let sum: int32 = 0;
  for (let i: int32 = 0; i < limit; i++) {
    sum += i;
  }
  return sum;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /i: int = 0/u);
  assert.match(text, /while i < limit:/u);
  assert.match(text, /sum = sum \+ i/u);
  assert.match(text, /i = i \+ 1/u);
});

test("compound assignment routes integer division through helpers", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function shrink(value: int32): int32 {
  let current: int32 = value;
  current /= 2;
  current %= 5;
  return current;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /current = _tsonic_int_div\(current, 2\)/u);
  assert.match(text, /current = _tsonic_int_rem\(current, 5\)/u);
});

test("unproven class shapes fail closed as whole declarations", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Base {
  value: int32;

  constructor() {
    this.value = 0;
  }
}

export class Derived extends Base {
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test("string enums fail closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export enum Label {
  On = "on",
  Off = "off",
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});
