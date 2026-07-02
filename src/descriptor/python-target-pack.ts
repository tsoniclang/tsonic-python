import type {
  TargetBackend,
  TargetBackendContext,
  TargetPack,
  TargetProviderContext,
  TargetToolchain,
  TargetToolchainContext,
} from "@tsonic/target-api";
import type { CompilerExtension } from "@tsonic/tsts";
import { createPythonBackend } from "../backend/python-backend.js";
import { createPythonTargetSemanticsExtension } from "../source/python-target-semantics/index.js";
import { createPythonStdlibProviderPackages } from "../source/provider-packages/stdlib.js";
import { validatePythonTargetOptions } from "../options/python-target-options.js";
import { createPythonToolchain } from "../toolchain/python-toolchain.js";

export const pythonTargetId = "python";

export function createPythonTargetPack(): TargetPack {
  return {
    id: pythonTargetId,
    displayName: "Python",
    provider: {
      id: "python-provider",
      displayName: "Python target provider",
      createExtensions(context: TargetProviderContext): readonly CompilerExtension[] {
        validatePythonTargetOptions(context.target);
        return [createPythonTargetSemanticsExtension(context)];
      },
    },
    packages: [...createPythonStdlibProviderPackages()],
    surfaces: [],
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
