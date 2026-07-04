import type {
  TargetBackend,
  TargetBackendContext,
  TargetPack,
  TargetProviderContext,
  TargetRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetToolchain,
  TargetToolchainContext,
} from "@tsonic/target-api";
import type { CompilerExtension } from "@tsonic/tsts";
import { createPythonBackend } from "../backend/python-backend.js";
import { createPythonTargetSemanticsExtension } from "../source/python-target-semantics/index.js";
import { createPythonStdlibCapabilities } from "../source/capabilities/stdlib.js";
import { readPythonTypescriptCompatibilityMode, validatePythonTargetOptions } from "../options/python-target-options.js";
import { pythonPackageReferenceKind } from "../backend/planner/pyproject.js";
import { createPythonToolchain } from "../toolchain/python-toolchain.js";

export const pythonTargetId = "python";

// The JS compatibility runtime ships as an ordinary Python dependency; it is
// referenced only when JS compatibility is selected through the compat mode
// or the js surface. Strict-native output never references it.
const pythonJsRuntimeReference = {
  kind: pythonPackageReferenceKind,
  include: "tsonic-python-js",
} as const;

// Module ownership must be unambiguous: two installed capabilities (or a
// capability and the target-owned stdlib) claiming the same specifier would
// make import resolution order-dependent.
function rejectDuplicateModuleOwnership(selectedCapabilities: readonly { readonly id: string; readonly moduleOwnership: readonly { readonly specifierPrefix: string }[] }[]): void {
  const owners = new Map<string, string>();
  const claims = [
    ...createPythonStdlibCapabilities().map((capability) => ({ id: capability.id, moduleOwnership: capability.moduleOwnership })),
    ...selectedCapabilities,
  ];
  for (const capability of claims) {
    for (const entry of capability.moduleOwnership) {
      const existing = owners.get(entry.specifierPrefix);
      if (existing !== undefined && existing !== capability.id) {
        throw new Error(`Python capability '${capability.id}' claims module '${entry.specifierPrefix}', already owned by '${existing}'.`);
      }
      owners.set(entry.specifierPrefix, capability.id);
    }
  }
}

export function createPythonTargetPack(): TargetPack {
  return {
    id: pythonTargetId,
    displayName: "Python",
    provider: {
      id: "python-provider",
      displayName: "Python target provider",
      // Python builtins/stdlib rows are target-owned: the provider itself
      // owns their module bindings, so they are always available without
      // configuration selection. Third-party libraries arrive as installed
      // target-capability plugins selected by the host.
      moduleOwnership: createPythonStdlibCapabilities().flatMap((capability) => capability.moduleOwnership),
      runtimeContributions(context: TargetRuntimeContributionContext): TargetRuntimeContributions {
        return readPythonTypescriptCompatibilityMode(context.target) === "compat"
          ? { references: [pythonJsRuntimeReference] }
          : { references: [] };
      },
      createExtensions(context: TargetProviderContext): readonly CompilerExtension[] {
        validatePythonTargetOptions(context.target);
        rejectDuplicateModuleOwnership(context.selectedCapabilities);
        return [
          ...createPythonStdlibCapabilities().flatMap((capability) =>
            capability.createExtensions({
              project: context.project,
              target: context.target,
              targetPack: context.targetPack,
              selectedCapabilities: context.selectedCapabilities,
              selectedSurfaces: context.selectedSurfaces,
              capability,
            })),
          createPythonTargetSemanticsExtension(context),
        ];
      },
    },
    surfaces: [
      {
        id: "js",
        displayName: "JavaScript surface",
        runtimeContributions(): TargetRuntimeContributions {
          return { references: [pythonJsRuntimeReference] };
        },
      },
    ],
    createBackend(context: TargetBackendContext): TargetBackend {
      validatePythonTargetOptions(context.target);
      return createPythonBackend(context);
    },
    createToolchain(context: TargetToolchainContext): TargetToolchain {
      validatePythonTargetOptions(context.target);
      return createPythonToolchain(context);
    },
  };
}
