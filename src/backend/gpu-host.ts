// Python host integration for the tsonic-gpu host artifact contract. GPU
// core owns kernel extraction and backend lowering; this integration only
// validates requests, decides package placement, and merges the results
// through the host artifact layer. Anything outside the contract fails
// closed with diagnostics and zero artifacts.

import type {
  GpuHostArtifactRequest,
  GpuHostIntegration,
  GpuHostPackagingResult,
} from "@tsonic/target-gpu";
import type {
  TargetCompileResult,
  TargetDiagnostic,
  TargetRuntimeReference,
  TargetSelection,
} from "@tsonic/target-api";
import { pythonTargetId } from "../descriptor/python-target-pack.js";
import { isValidPythonModuleName } from "../common/python-names.js";
import { mergePythonHostArtifacts } from "./host-artifacts.js";
import type { PythonHostArtifactContribution, PythonHostModuleContribution, PythonHostWrapperExport } from "./host-artifacts.js";
import type { PythonDependency } from "./planner/pyproject.js";

export interface PythonGpuHostOptions {
  readonly target: TargetSelection;
  readonly runtimeReferences: readonly TargetRuntimeReference[];
  readonly compileResult: TargetCompileResult;
}

const pythonDependencyEcosystem = "python";

function unsupportedGpuRequestDiagnostic(message: string, evidence: readonly string[]): TargetDiagnostic {
  return {
    code: "PYTHON_UNSUPPORTED_HOST_ARTIFACT",
    category: "error",
    source: "tsonic-python",
    message,
    evidence: ["target.capability=python.host.gpu", ...evidence],
  };
}

// Backend module paths must be flat <module>.py entries; the Python host
// decides the package placement (src/<package>/kernels/), never the backend.
function kernelModuleName(path: string): string | undefined {
  if (!path.endsWith(".py") || path.includes("/") || path.includes("\\")) {
    return undefined;
  }
  const stem = path.slice(0, -3);
  return isValidPythonModuleName(stem) ? stem : undefined;
}

export function createPythonGpuHostIntegration(options: PythonGpuHostOptions): GpuHostIntegration {
  return {
    hostTargetId: pythonTargetId,
    packageArtifacts(request: GpuHostArtifactRequest): GpuHostPackagingResult {
      const diagnostics: TargetDiagnostic[] = [];
      if (request.hostTargetId !== pythonTargetId) {
        return {
          artifacts: [],
          diagnostics: [unsupportedGpuRequestDiagnostic(
            `GPU host request targets '${request.hostTargetId}', not '${pythonTargetId}'.`,
            [`host.request.target=${request.hostTargetId}`, `host.request.backend=${request.backendId}`],
          )],
        };
      }

      const modules: PythonHostModuleContribution[] = [];
      const moduleNames = new Set<string>();
      for (const module of request.modules) {
        const name = kernelModuleName(module.path);
        if (name === undefined) {
          diagnostics.push(unsupportedGpuRequestDiagnostic(
            `GPU backend module path '${module.path}' does not map to a flat Python kernel module.`,
            [`host.module.path=${module.path}`, `host.request.backend=${request.backendId}`],
          ));
          continue;
        }
        moduleNames.add(name);
        modules.push({ name, language: module.language, text: module.text });
      }

      const dependencies: PythonDependency[] = [];
      for (const dependency of request.dependencies) {
        if (dependency.ecosystem !== pythonDependencyEcosystem) {
          diagnostics.push(unsupportedGpuRequestDiagnostic(
            `GPU backend dependency '${dependency.name}' targets ecosystem '${dependency.ecosystem}', not '${pythonDependencyEcosystem}'.`,
            [`host.dependency=${dependency.name}`, `host.ecosystem=${dependency.ecosystem}`],
          ));
          continue;
        }
        dependencies.push({
          name: dependency.name,
          ...(dependency.versionConstraint === undefined ? {} : { version: dependency.versionConstraint }),
        });
      }

      const wrapperExports: PythonHostWrapperExport[] = [];
      for (const wrapper of request.launchWrappers) {
        if (!moduleNames.has(wrapper.kernelName)) {
          diagnostics.push(unsupportedGpuRequestDiagnostic(
            `GPU launch wrapper '${wrapper.hostFunctionName}' references kernel '${wrapper.kernelName}', which contributed no module.`,
            [`host.wrapper=${wrapper.hostFunctionName}`, `host.kernel=${wrapper.kernelName}`],
          ));
          continue;
        }
        wrapperExports.push({ module: wrapper.kernelName, name: wrapper.hostFunctionName });
      }

      if (diagnostics.length > 0) {
        return { artifacts: [], diagnostics };
      }

      const contribution: PythonHostArtifactContribution = { modules, dependencies, wrapperExports };
      return mergePythonHostArtifacts({
        target: options.target,
        runtimeReferences: options.runtimeReferences,
        compileResult: options.compileResult,
        contributions: [contribution],
      });
    },
  };
}
