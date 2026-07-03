import type { TargetDiagnostic, TargetRuntimeReference, TargetSelection } from "@tsonic/target-api";
import {
  readPythonPackageName,
  readPythonVersion,
} from "../../options/python-target-options.js";
import type { PythonVersion } from "../../options/python-target-options.js";
import { missingRuntimeReferenceDiagnostic } from "./diagnostics.js";

export const pythonPackageReferenceKind = "python-package";

// PEP 508 distribution name and a conservative version character shape (a
// strict subset of PEP 440; not full PEP 440 validation). A version value
// may carry a single leading comparator (>=3.0 style constraints from host
// contributions); a bare value pins with ==. Names or versions outside
// these shapes are rejected, never passed through to pyproject dependency
// strings.
const pythonPackageNamePattern = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const pythonPackageVersionPattern = /^(==|!=|<=|>=|~=|<|>)?[0-9][0-9A-Za-z.!+]*$/u;

export interface PythonDependency {
  readonly name: string;
  readonly version?: string;
}

export interface PyprojectManifestPlan {
  readonly packageName: string;
  readonly pythonVersion: PythonVersion;
  readonly dependencies: readonly PythonDependency[];
}

export interface PyprojectManifestPlanResult {
  readonly manifest?: PyprojectManifestPlan;
  readonly diagnostics: readonly TargetDiagnostic[];
}

export function planPyprojectManifest(
  target: TargetSelection,
  runtimeReferences: readonly TargetRuntimeReference[],
): PyprojectManifestPlanResult {
  const diagnostics: TargetDiagnostic[] = [];
  const dependenciesByName = new Map<string, PythonDependency>();
  for (const reference of runtimeReferences) {
    if (reference.kind !== pythonPackageReferenceKind || !pythonPackageNamePattern.test(reference.include)) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    if (reference.version !== undefined && !pythonPackageVersionPattern.test(reference.version)) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    const existing = dependenciesByName.get(reference.include);
    if (existing !== undefined && existing.version !== reference.version) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    dependenciesByName.set(reference.include, {
      name: reference.include,
      ...(reference.version === undefined ? {} : { version: reference.version }),
    });
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }
  return {
    manifest: {
      packageName: readPythonPackageName(target),
      pythonVersion: readPythonVersion(target),
      dependencies: [...dependenciesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "en")),
    },
    diagnostics: [],
  };
}
