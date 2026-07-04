import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readPythonOutputType,
  readPythonPackageName,
  readPythonTypescriptCompatibilityMode,
  readPythonVersion,
  validatePythonTargetOptions,
} from "../dist/index.js";

function target(options) {
  return { id: "python", ...(options === undefined ? {} : { options }) };
}

test("python target options default deterministically", () => {
  assert.equal(readPythonPackageName(target()), "tsonic_generated");
  assert.equal(readPythonVersion(target()), "3.12");
  assert.equal(readPythonOutputType(target()), "package");
  assert.equal(readPythonTypescriptCompatibilityMode(target()), "strict-native");
});

test("python target options accept explicit supported values", () => {
  const selection = target({
    packageName: "my_app",
    pythonVersion: "3.13",
    outputType: "script",
    typescriptCompatibility: "strict-native",
  });

  validatePythonTargetOptions(selection);
  assert.equal(readPythonPackageName(selection), "my_app");
  assert.equal(readPythonVersion(selection), "3.13");
  assert.equal(readPythonOutputType(selection), "script");
  assert.equal(readPythonTypescriptCompatibilityMode(selection), "strict-native");
});

test("compat mode selects the wired python-js runtime lane", () => {
  assert.equal(
    readPythonTypescriptCompatibilityMode(target({ typescriptCompatibility: "compat" })),
    "compat",
  );
  validatePythonTargetOptions(target({ typescriptCompatibility: "compat" }));
});

test("python target options reject unknown keys", () => {
  assert.throws(
    () => validatePythonTargetOptions(target({ crateName: "x" })),
    /Python target option 'options\.crateName' is not supported\./,
  );
});

test("python target options reject invalid values", () => {
  assert.throws(() => readPythonPackageName(target({ packageName: "My-App" })), /packageName/);
  assert.throws(() => readPythonPackageName(target({ packageName: "" })), /non-empty string/);
  assert.throws(() => readPythonPackageName(target({ packageName: "match" })), /reserved Python name/);
  assert.throws(() => readPythonPackageName(target({ packageName: "import" })), /reserved Python name/);
  assert.throws(() => readPythonVersion(target({ pythonVersion: "3.11" })), /'3\.12', '3\.13', or '3\.14'/);
  assert.throws(() => readPythonOutputType(target({ outputType: "Exe" })), /'package' or 'script'/);
  assert.throws(
    () => readPythonTypescriptCompatibilityMode(target({ typescriptCompatibility: "loose" })),
    /'strict-native' or 'compat'/,
  );
  assert.throws(() => validatePythonTargetOptions(target({ packageName: "My-App" })), /packageName/);
});
