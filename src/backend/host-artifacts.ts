// Host artifact integration for GPU backends. tsonic-gpu (and its lowering
// backends such as gpu-triton) own kernel extraction and kernel code; this
// module only decides package placement, merges dependency rows, and fails
// closed on unsupported host requests. No GPU logic lives here.

import type {
  TargetArtifact,
  TargetCompileResult,
  TargetDiagnostic,
  TargetRuntimeReference,
  TargetSelection,
  TargetSourceFile,
} from "@tsonic/target-api";
import { isValidPythonModuleName } from "../common/python-names.js";
import { readPythonPackageName } from "../options/python-target-options.js";
import { planPyprojectManifest, pythonPackageReferenceKind } from "./planner/pyproject.js";
import { printPyprojectManifest } from "../print/pyproject-printer.js";
import { createPythonModule } from "./python-ast/nodes.js";
import { printPythonModule } from "../print/python-printer.js";
import type { PythonDependency } from "./planner/pyproject.js";

export interface PythonHostModuleContribution {
  readonly name: string;
  readonly language: string;
  readonly text: string;
}

export interface PythonHostWrapperExport {
  readonly module: string;
  readonly name: string;
}

export interface PythonHostArtifactContribution {
  readonly modules: readonly PythonHostModuleContribution[];
  readonly dependencies: readonly PythonDependency[];
  // Launch wrappers re-exported from kernel modules through the kernels
  // package __init__ so hosts can import them without knowing module paths.
  readonly wrapperExports?: readonly PythonHostWrapperExport[];
}

export interface PythonHostArtifactInput {
  readonly target: TargetSelection;
  readonly runtimeReferences: readonly TargetRuntimeReference[];
  readonly compileResult: TargetCompileResult;
  readonly contributions: readonly PythonHostArtifactContribution[];
}

function unsupportedHostRequestDiagnostic(message: string, evidence: readonly string[]): TargetDiagnostic {
  return {
    code: "PYTHON_UNSUPPORTED_HOST_ARTIFACT",
    category: "error",
    source: "tsonic-python",
    message,
    evidence: ["target.capability=python.host.artifact", ...evidence],
  };
}

// Merge host contributions into a successful compile result. Kernel modules
// land under src/<package>/kernels/; contributed dependencies join the
// pyproject manifest as python-package references. Any unsupported request
// fails closed: diagnostics and zero artifacts, never partial output.
export function mergePythonHostArtifacts(input: PythonHostArtifactInput): TargetCompileResult {
  const { compileResult, contributions } = input;
  if (compileResult.diagnostics.length > 0) {
    return { artifacts: [], diagnostics: compileResult.diagnostics };
  }
  if (contributions.length === 0) {
    return compileResult;
  }

  const diagnostics: TargetDiagnostic[] = [];
  const packageName = readPythonPackageName(input.target);
  const kernelRoot = `src/${packageName}/kernels`;
  const existingPaths = new Set(compileResult.artifacts.map((artifact) => artifact.path));
  const seenModuleNames = new Set<string>();
  const kernelArtifacts: TargetSourceFile[] = [];
  const contributedReferences: TargetRuntimeReference[] = [];
  const wrapperExports = new Map<string, string>();

  for (const contribution of contributions) {
    for (const module of contribution.modules) {
      if (module.language !== "python") {
        diagnostics.push(unsupportedHostRequestDiagnostic(
          `Host artifact module '${module.name}' has unsupported language '${module.language}'.`,
          [`host.module=${module.name}`, `host.language=${module.language}`],
        ));
        continue;
      }
      if (!isValidPythonModuleName(module.name)) {
        diagnostics.push(unsupportedHostRequestDiagnostic(
          `Host artifact module name '${module.name}' is not a valid Python module name.`,
          [`host.module=${module.name}`],
        ));
        continue;
      }
      if (seenModuleNames.has(module.name)) {
        diagnostics.push(unsupportedHostRequestDiagnostic(
          `Host artifact module '${module.name}' is contributed more than once.`,
          [`host.module=${module.name}`],
        ));
        continue;
      }
      seenModuleNames.add(module.name);
      const path = `${kernelRoot}/${module.name}.py`;
      if (existingPaths.has(path)) {
        diagnostics.push(unsupportedHostRequestDiagnostic(
          `Host artifact module '${module.name}' collides with an existing artifact at '${path}'.`,
          [`host.module=${module.name}`, `host.path=${path}`],
        ));
        continue;
      }
      kernelArtifacts.push({ kind: "source", language: "python", path, text: module.text });
    }
    for (const dependency of contribution.dependencies) {
      contributedReferences.push({
        kind: pythonPackageReferenceKind,
        include: dependency.name,
        ...(dependency.version === undefined ? {} : { version: dependency.version }),
      });
    }
    for (const wrapper of contribution.wrapperExports ?? []) {
      if (!isValidPythonModuleName(wrapper.name)) {
        diagnostics.push(unsupportedHostRequestDiagnostic(
          `Host wrapper export '${wrapper.name}' is not a valid Python identifier.`,
          [`host.wrapper=${wrapper.name}`],
        ));
        continue;
      }
      if (wrapperExports.has(wrapper.name)) {
        diagnostics.push(unsupportedHostRequestDiagnostic(
          `Host wrapper export '${wrapper.name}' is contributed more than once.`,
          [`host.wrapper=${wrapper.name}`],
        ));
        continue;
      }
      wrapperExports.set(wrapper.name, wrapper.module);
    }
  }
  for (const [wrapperName, wrapperModule] of wrapperExports) {
    if (!seenModuleNames.has(wrapperModule)) {
      diagnostics.push(unsupportedHostRequestDiagnostic(
        `Host wrapper export '${wrapperName}' references module '${wrapperModule}', which was not contributed.`,
        [`host.wrapper=${wrapperName}`, `host.module=${wrapperModule}`],
      ));
    }
  }

  const manifestPlan = planPyprojectManifest(input.target, [...input.runtimeReferences, ...contributedReferences]);
  const manifest = manifestPlan.manifest;
  if (manifest === undefined) {
    return { artifacts: [], diagnostics: [...diagnostics, ...manifestPlan.diagnostics] };
  }
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const sortedKernels = [...kernelArtifacts].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const artifacts: TargetArtifact[] = [
    ...compileResult.artifacts.map((artifact) =>
      artifact.path === "pyproject.toml"
        ? { ...artifact, text: printPyprojectManifest(manifest) }
        : artifact),
    {
      kind: "source",
      language: "python",
      path: `${kernelRoot}/__init__.py`,
      text: printPythonModule(createPythonModule(
        [...wrapperExports.entries()]
          .sort(([left], [right]) => left.localeCompare(right, "en"))
          .map(([wrapperName, wrapperModule]) => ({
            kind: "from-import",
            module: `.${wrapperModule}`,
            names: [{ name: wrapperName }],
          })),
      )),
    } satisfies TargetSourceFile,
    ...sortedKernels,
  ];
  return { artifacts, diagnostics: [] };
}
