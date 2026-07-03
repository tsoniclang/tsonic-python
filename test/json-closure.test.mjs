import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compilePython } from "./helpers/python-session.mjs";

// Typed JSON closure: @python/json is target-owned, so no capability
// selection is needed. `dumps` records facts only for proven
// JSON-serializable argument carriers; everything else fails closed.

function assertFailsClosed(result) {
  assert.equal(result.artifacts.length, 0, "diagnostics must never coexist with artifacts");
  assert.ok(result.diagnostics.length > 0, "expected at least one diagnostic");
}

test("json dumps of dict[str,int] lowers to json.dumps with a module import", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { dumps } from "@python/json";

export function encode(): string {
  const table: Record<string, int32> = { a: 1, b: 2 };
  return dumps(table);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /import json/u);
  assert.match(text, /return json\.dumps\(table\)/u);
});

test("json dumps of list[int] lowers to json.dumps", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { dumps } from "@python/json";

export function encode(): string {
  const xs: int32[] = [1, 2, 3];
  return dumps(xs);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /import json/u);
  assert.match(text, /return json\.dumps\(xs\)/u);
});

test("json dumps accepts primitives, tuples, and optional payloads", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { dumps } from "@python/json";

export function encode(flag: boolean): string {
  const t: [int32, string] = [7, "x"];
  let maybe: string | null = null;
  if (flag) {
    maybe = "y";
  }
  return dumps("hi") + dumps(1.5) + dumps(true) + dumps(t) + dumps(maybe);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /json\.dumps\("hi"\)/u);
  // The numeric-literal lowering proves per-overload signature identity: the
  // literal only resolves through the number signature's row expectation.
  assert.match(text, /json\.dumps\(1\.5\)/u);
  assert.match(text, /json\.dumps\(True\)/u);
  assert.match(text, /json\.dumps\(t\)/u);
  assert.match(text, /json\.dumps\(maybe\)/u);
});

test("json dumps of a generated record value fails closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { dumps } from "@python/json";

export interface Size {
  w: int32;
  h: int32;
}

export function encode(): string {
  const s: Size = { w: 1, h: 2 };
  return dumps(s);
}
`,
    },
  });

  assertFailsClosed(result);
});

test("json dumps of an unknown value fails closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { dumps } from "@python/json";

export function encode(u: unknown): string {
  return dumps(u);
}
`,
    },
  });

  assertFailsClosed(result);
});

test("json dumps of a class instance fails closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import { dumps } from "@python/json";

export class Point {
  x: string;

  constructor(x: string) {
    this.x = x;
  }
}

export function encode(): string {
  const p = new Point("a");
  return dumps(p);
}
`,
    },
  });

  assertFailsClosed(result);
});

test("json dumps of non-primitive collection payloads fails closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { dumps } from "@python/json";

export function encode(): string {
  const rows: Record<string, int32>[] = [];
  return dumps(rows);
}
`,
    },
  });

  assertFailsClosed(result);
});
