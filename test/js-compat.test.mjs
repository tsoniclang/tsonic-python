import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compilePython } from "./helpers/python-session.mjs";

const compatTarget = { id: "python", options: { typescriptCompatibility: "compat" } };

test("compat pyproject carries the tsonic-python-js dependency; strict-native does not", () => {
  const source = {
    "index.ts": `
export function idle(): void {}
`,
  };
  const compat = compilePython({ files: source, target: compatTarget });
  assert.deepEqual(compat.result.diagnostics, []);
  assert.match(artifactText(compat.result, "pyproject.toml"), /"tsonic-python-js",/u);

  const strict = compilePython({ files: source });
  assert.deepEqual(strict.result.diagnostics, []);
  assert.doesNotMatch(artifactText(strict.result, "pyproject.toml"), /tsonic-python-js/u);
});

test("undefined and strict equality lower through the runtime under compat", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function firstOrUndefined(index: number): boolean {
  const values = [1, , 3];
  const candidate = values.at(index);
  return candidate !== undefined;
}
`,
    },
    target: compatTarget,
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /from tsonic_python_js import/u);
  assert.match(text, /strict_equal/u);
  assert.match(text, /not strict_equal/u);
});

test("sparse array literals lower to the JsArray builder with an undefined hole", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function sparse(): number {
  const xs = [1, , 3];
  return xs.length;
}
`,
    },
    target: compatTarget,
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /JsArray\(\[1\.0, tsonic_python_js\.undefined, 3\.0\]\)/u);
  assert.match(text, /\.length/u);
});

test("string, math, and number helpers lower to runtime calls", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function probe(text: string, value: number): number {
  const code: number = text.charCodeAt(0);
  const rounded: number = Math.floor(value);
  if (Number.isFinite(value) && text.includes("x")) {
    return code + rounded;
  }
  return rounded;
}
`,
    },
    target: compatTarget,
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /char_code_at\(text, 0\)/u);
  assert.match(text, /math_floor\(value\)/u);
  assert.match(text, /number_is_finite|is_finite/u);
});

test("Map, Set, Date, JSON, and typed arrays lower under compat", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function collections(): number {
  const table = new Map<string, number>();
  table.set("a", 1);
  const tags = new Set<string>();
  tags.add("x");
  const when = new Date(86400000);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setInt32(0, 42);
  return table.size + tags.size + when.getUTCFullYear() + view.getInt32(0);
}
`,
    },
    target: compatTarget,
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /JsMap\(\)/u);
  assert.match(text, /JsSet\(\)/u);
  assert.match(text, /JsDate\(86400000(\.0)?\)/u);
  assert.match(text, /ArrayBuffer\(8\)/u);
  assert.match(text, /DataView\(buffer\)/u);
});

test("strict-native output stays free of the compat runtime and fails closed on JS lanes", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function sparse(): number {
  const xs = [1, , 3];
  return xs.length;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test("hard-rejected JS lanes fail closed under compat with zero artifacts", () => {
  const cases = [
    ["symbols", `
export function tag(): void {
  const marker = Symbol("tag");
}
`],
    ["WeakMap", `
export function weak(): void {
  const cache = new WeakMap<object, string>();
}
`],
    ["console", `
export function log(): void {
  console.log("hello");
}
`],
    ["timers", `
export function later(): void {
  setTimeout(() => {}, 100);
}
`],
  ];
  for (const [label, source] of cases) {
    const { result } = compilePython({ files: { "index.ts": source }, target: compatTarget });
    assert.equal(result.artifacts.length, 0, `${label} must produce zero artifacts`);
    assert.ok(result.diagnostics.length > 0, `${label} must diagnose`);
  }
});

test("regexp literals lower to the runtime subset engine under compat", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function find(text: string): boolean {
  return /ab+c/i.test(text);
}

export function tidy(text: string): string {
  return text.replace(/\\s/g, "-");
}
`,
    },
    target: compatTarget,
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/tsonic_generated/index.py");
  assert.match(text, /from tsonic_python_js import JsRegExp/u);
  assert.match(text, /JsRegExp\("ab\+c", "i"\)\.test\(text\)/u);
  assert.match(text, /JsRegExp\("\\\\s", "g"\)\.replace\(text, "-"\)/u);
});

test("dynamic RegExp construction fails closed", () => {
  const { result } = compilePython({
    files: {
      "index.ts": `
export function build(pattern: string): boolean {
  const re = new RegExp(pattern);
  return re.test("x");
}
`,
    },
    target: compatTarget,
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});
