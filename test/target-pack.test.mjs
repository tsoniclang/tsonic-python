import { test } from "node:test";
import assert from "node:assert/strict";
import { createTargetRegistry } from "@tsonic/target-api";
import { createPythonTargetPack, pythonTargetId } from "../dist/index.js";

test("python target pack registers under the python target id", () => {
  const registry = createTargetRegistry([createPythonTargetPack()]);
  const pack = registry.get("python");

  assert.ok(pack);
  assert.equal(pack.id, pythonTargetId);
  assert.equal(pack.displayName, "Python");
});

test("python target pack declares no surfaces or provider packages yet", () => {
  const pack = createPythonTargetPack();

  assert.deepEqual(pack.surfaces, []);
  assert.deepEqual(pack.packages, []);
});

test("python provider creates the target semantics extension and validates options", () => {
  const pack = createPythonTargetPack();
  const context = {
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "python", options: {} },
    targetPack: pack,
    selectedPackages: [],
    selectedSurfaces: [],
  };

  const extensions = pack.provider.createExtensions(context);
  assert.equal(extensions.length, 1);
  assert.equal(extensions[0].identity.id, "tsonic.python.target-semantics");
  assert.throws(
    () => pack.provider.createExtensions({ ...context, target: { id: "python", options: { unknown: true } } }),
    /Python target option 'options\.unknown' is not supported\./,
  );
});

test("createBackend and createToolchain validate target options", () => {
  const pack = createPythonTargetPack();
  const badContext = {
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "python", options: { unknown: true } },
  };

  assert.throws(() => pack.createBackend(badContext), /not supported/);
  assert.throws(() => pack.createToolchain(badContext), /not supported/);
});

test("toolchain prepare reports compiled artifact paths without executing tools", () => {
  const pack = createPythonTargetPack();
  const toolchain = pack.createToolchain({
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "python", options: {} },
  });
  const result = toolchain.prepare({
    artifactsRoot: "out/python",
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "python", options: {} },
    compileResult: {
      artifacts: [
        { kind: "project", path: "pyproject.toml", text: "" },
        { kind: "source", language: "python", path: "src/tsonic_generated/__init__.py", text: "" },
      ],
      diagnostics: [],
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.producedArtifacts, ["pyproject.toml", "src/tsonic_generated/__init__.py"]);
});
