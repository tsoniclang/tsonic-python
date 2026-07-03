import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compilePython } from "./helpers/python-session.mjs";

test("template literals lower to f-strings", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function describe(name: string, count: int32, ready: boolean): string {
  return \`user \${name} has \${count} items (\${ready})\`;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/tsonic_generated/index.py"),
    /return f"user \{name\} has \{count\} items \(\{ready\}\)"/u,
  );
});

test("optional carriers lower to T | None annotations and is/is not checks", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function pick(value: string | null): string {
  if (value === null) {
    return "missing";
  }
  return value;
}

export function reset(): string | null {
  return null;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /def pick\(value: str \| None\) -> str:/u);
  assert.match(text, /if value is None:/u);
  assert.match(text, /def reset\(\) -> str \| None:/u);
  assert.match(text, /return None/u);
});

test("Record<string, T> lowers to dict literals, reads, and writes", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function tally(): int32 {
  const counts: Record<string, int32> = { first: 1, "second-key": 2 };
  counts["third"] = 3;
  return counts["first"] + counts["third"];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /counts: dict\[str, int\] = \{"first": 1, "second-key": 2\}/u);
  assert.match(text, /counts\["third"\] = 3/u);
  assert.match(text, /return counts\["first"\] \+ counts\["third"\]/u);
});

test("tuple carriers lower to tuple literals and literal-index reads", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { float64, int32 } from "@tsonic/core/types.js";

export function middle(): float64 {
  const triple: [int32, float64, string] = [1, 2.5, "z"];
  return triple[1];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /triple: tuple\[int, float, str\] = \(1, 2\.5, "z"\)/u);
  assert.match(text, /return triple\[1\]/u);
});

test("dense-list includes and indexOf lower to in and the index helper", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function find(values: int32[], needle: int32): int32 {
  if (values.includes(needle)) {
    return values.indexOf(needle);
  }
  return -1;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /if needle in values:/u);
  assert.match(text, /return _tsonic_index_of\(values, needle\)/u);
  assert.match(text, /def _tsonic_index_of\(items: list, value: object\) -> int:/u);
});

test("tuple access with a non-literal index fails closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function at(position: int32): int32 {
  const pair: [int32, int32] = [1, 2];
  return pair[position];
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});
