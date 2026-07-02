import type {
  TargetSelection,
  TargetTypescriptCompatibilityMode,
} from "@tsonic/target-api";
import { pythonReservedIdentifiers } from "../common/python-names.js";

export type PythonOutputType = "package" | "script";

export type PythonVersion = "3.12" | "3.13";

const supportedPythonTargetOptionKeys = Object.freeze([
  "outputType",
  "packageName",
  "pythonVersion",
  "typescriptCompatibility",
]);

const packageNamePattern = /^[a-z][a-z0-9_]*$/u;

export function validatePythonTargetOptions(target: TargetSelection): void {
  const options = target.options;
  if (options === undefined) {
    return;
  }
  const allowedKeys = new Set(supportedPythonTargetOptionKeys);
  for (const key of Object.keys(options)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Python target option 'options.${key}' is not supported.`);
    }
  }
  readPythonPackageName(target);
  readPythonVersion(target);
  readPythonOutputType(target);
  readPythonTypescriptCompatibilityMode(target);
}

export function readPythonPackageName(target: TargetSelection): string {
  const value = readOptionalStringOption(target, "packageName");
  if (value === undefined) {
    return "tsonic_generated";
  }
  if (!packageNamePattern.test(value)) {
    throw new Error(`Python target option 'packageName' must match ${packageNamePattern.source}; use lowercase ASCII letters, digits, and underscores.`);
  }
  if (pythonReservedIdentifiers.has(value)) {
    throw new Error(`Python target option 'packageName' must not be the reserved Python name '${value}'.`);
  }
  return value;
}

export function readPythonVersion(target: TargetSelection): PythonVersion {
  const value = readOptionalStringOption(target, "pythonVersion");
  if (value === undefined) {
    return "3.12";
  }
  if (value !== "3.12" && value !== "3.13") {
    throw new Error("Python target option 'pythonVersion' must be either '3.12' or '3.13'.");
  }
  return value;
}

export function readPythonOutputType(target: TargetSelection): PythonOutputType {
  const value = readOptionalStringOption(target, "outputType");
  if (value === undefined) {
    return "package";
  }
  if (value !== "package" && value !== "script") {
    throw new Error("Python target option 'outputType' must be either 'package' or 'script'.");
  }
  return value;
}

export function readPythonTypescriptCompatibilityMode(target: TargetSelection): TargetTypescriptCompatibilityMode {
  const value = target.options?.typescriptCompatibility;
  if (value === undefined) {
    return "strict-native";
  }
  if (value !== "strict-native" && value !== "compat") {
    throw new Error("Python target option 'typescriptCompatibility' must be either 'strict-native' or 'compat'.");
  }
  return value;
}

function readOptionalStringOption(target: TargetSelection, key: string): string | undefined {
  const value = target.options?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Python target option '${key}' must be a non-empty string.`);
  }
  return value;
}
