import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repositoryRoot, "src");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.isFile() && path.endsWith(".ts")
      ? [path]
      : [];
  });
}

test("Python converts typed-location facts into one target-owned rejection", () => {
  const hits = sourceFiles(sourceRoot)
    .filter((path) => readFileSync(path, "utf8").includes("pointerOperationFactKey"))
    .map((path) => path.slice(repositoryRoot.length + 1));
  const semantics = readFileSync(
    join(sourceRoot, "source/python-target-semantics/index.ts"),
    "utf8",
  );
  const disposition = readFileSync(
    join(sourceRoot, "source/python-target-semantics/typed-location-disposition.ts"),
    "utf8",
  );

  assert.deepEqual(hits, [
    "src/source/python-target-semantics/typed-location-disposition.ts",
  ]);
  assert.match(semantics, /selectPythonTypedLocationDisposition/u);
  assert.match(semantics, /PYTHON_TYPED_LOCATION_UNSUPPORTED/u);
  assert.doesNotMatch(
    disposition,
    /\baddressOf\b|\ballocatePointer\b|\bequalPointer\b|\bloadPointer\b|\bstorePointer\b/u,
  );
});

test("Python introduces no target-flavoured marker alias surface", () => {
  const product = sourceFiles(sourceRoot)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.doesNotMatch(product, /@tsonic\/python\/(?:lang|types)\.js/u);
});
