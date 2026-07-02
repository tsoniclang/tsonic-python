import { test } from "node:test";
import assert from "node:assert/strict";
import { createPythonBackend } from "../dist/index.js";
import { fakeCompileInput, fakeSourceFile, fakeStatement } from "./helpers/fake-compile-input.mjs";

const backendContext = {
  project: { entryPoint: "src/index.ts", targets: [] },
  target: { id: "python", options: {} },
};

test("any source statement fails closed with a deterministic diagnostic and no artifacts", () => {
  const backend = createPythonBackend(backendContext);
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [fakeSourceFile({
      fileName: "src/app.ts",
      text: "const x = 1;\n",
      statements: [fakeStatement({ pos: 0, end: 12, kindName: "KindVariableStatement" })],
    })],
  }));

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "PYTHON_UNSUPPORTED_AST");
  assert.equal(diagnostic.category, "error");
  assert.equal(diagnostic.source, "tsonic-python");
  assert.match(diagnostic.message, /KindVariableStatement/);
  assert.deepEqual(diagnostic.sourceSpan, {
    fileName: "src/app.ts",
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 13,
  });
  assert.ok(diagnostic.evidence.includes("target.capability=python.backend.statement"));
  assert.ok(diagnostic.evidence.includes("source.byteSpan=0-12"));
});

test("every statement in every source file produces its own diagnostic", () => {
  const backend = createPythonBackend(backendContext);
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [
      fakeSourceFile({
        fileName: "src/a.ts",
        text: "let a;\nlet b;\n",
        statements: [
          fakeStatement({ pos: 0, end: 6, kindName: "KindVariableStatement" }),
          fakeStatement({ pos: 7, end: 13, kindName: "KindVariableStatement" }),
        ],
      }),
      fakeSourceFile({
        fileName: "src/b.ts",
        text: "export {};\n",
        statements: [fakeStatement({ pos: 0, end: 10, kindName: "KindExportDeclaration" })],
      }),
    ],
  }));

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 3);
  const secondSpan = result.diagnostics[1].sourceSpan;
  assert.equal(secondSpan.line, 2);
  assert.equal(secondSpan.column, 1);
});

test("diagnostic spans track multi-byte source text by utf-8 byte offsets", () => {
  const backend = createPythonBackend(backendContext);
  const text = 'const s = "héllo";\n';
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [fakeSourceFile({
      fileName: "src/unicode.ts",
      text,
      // 'é' is two utf-8 bytes; the statement spans the full first line.
      statements: [fakeStatement({ pos: 0, end: 19, kindName: "KindVariableStatement" })],
    })],
  }));

  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.sourceSpan.endLine, 1);
  assert.equal(diagnostic.sourceSpan.endColumn, 19);
});

test("type-only imports are erased and do not fail the compile", () => {
  const backend = createPythonBackend(backendContext);
  const statement = fakeStatement({ pos: 0, end: 40, kindName: "KindImportDeclaration" });
  statement.isTypeOnly = true;
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [fakeSourceFile({
      fileName: "src/index.ts",
      text: 'import type { x } from "./x.js";\n',
      statements: [statement],
    })],
  }));

  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.artifacts.length > 0);
});

test("value and side-effect imports fail closed without a lowering lane", () => {
  const backend = createPythonBackend(backendContext);
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [fakeSourceFile({
      fileName: "src/index.ts",
      text: 'import "./side-effect.js";\n',
      statements: [fakeStatement({ pos: 0, end: 26, kindName: "KindImportDeclaration" })],
    })],
  }));

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "PYTHON_UNSUPPORTED_AST");
  assert.ok(result.diagnostics[0].evidence.includes("target.capability=python.backend.import"));
});
