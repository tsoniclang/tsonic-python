import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePython } from "./helpers/python-session.mjs";

function assertFailsClosed(result, pattern) {
  assert.equal(result.artifacts.length, 0, "diagnostics must never coexist with artifacts");
  assert.ok(result.diagnostics.length > 0, "expected at least one diagnostic");
  if (pattern !== undefined) {
    assert.ok(
      result.diagnostics.some((diagnostic) => pattern.test(`${diagnostic.code} ${diagnostic.message}`)),
      `no diagnostic matched ${pattern}: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
}

test("bare side-effect imports fail closed", () => {
  const { result } = compilePython({
    files: {
      "setup.ts": `
export function noop(): void {}
`,
      "index.ts": `
import "./setup.js";

export function nothing(): void {}
`,
    },
  });

  assertFailsClosed(result, /PYTHON_UNSUPPORTED_AST/u);
});

test("unresolved global calls have no facts and fail closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { float64 } from "@tsonic/core/types.js";

export function down(value: float64): float64 {
  return Math.floor(value);
}
`,
    },
  });

  assertFailsClosed(result);
});

test("class declarations fail closed without a class policy lane", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export class Point {
  x: number = 0;
}
`,
    },
  });

  assertFailsClosed(result, /PYTHON_UNSUPPORTED_AST/u);
});

test("async functions fail closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export async function later(): Promise<string> {
  return "soon";
}
`,
    },
  });

  assertFailsClosed(result, /python\.backend\.async|PYTHON_MISSING_TARGET_FACT|PYTHON_UNSUPPORTED_AST/u);
});

test("sparse array literals fail closed in strict-native mode", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function sparse(): int32 {
  const xs = [1, , 3];
  return xs.length;
}
`,
    },
  });

  assertFailsClosed(result);
});

test("JS array semantics without facts fail closed: includes and length writes", () => {
  const includes = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function has(xs: int32[], value: int32): boolean {
  return xs.includes(value);
}
`,
    },
  });
  assertFailsClosed(includes.result);

  const lengthWrite = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function clear(xs: int32[]): void {
  xs.length = 0;
}
`,
    },
  });
  assertFailsClosed(lengthWrite.result);
});

test("template literals fail closed without a lane", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function shout(name: string): string {
  return \`hey \${name}\`;
}
`,
    },
  });

  assertFailsClosed(result);
});

test("reserved public function names are rejected, never silently renamed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function match(value: int32): int32 {
  return value;
}
`,
    },
  });

  assertFailsClosed(result, /python\.backend\.naming|PYTHON_UNSUPPORTED_AST/u);
});

test("reserved-name mangling collisions fail closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function clash(match: int32, match_: int32): int32 {
  return match + match_;
}
`,
    },
  });

  assertFailsClosed(result, /python\.backend\.naming|PYTHON_UNSUPPORTED_AST/u);
});

test("missing operator facts fail closed instead of guessing from tokens", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32, float64 } from "@tsonic/core/types.js";

export function mixed(a: int32, b: float64): float64 {
  return a + b;
}
`,
    },
  });

  assertFailsClosed(result);
});
