import type { CompilerExtension } from "@tsonic/tsts";
import { tsonicCoreSourceExtensionId } from "@tsonic/source-core";
import type { TargetProviderContext } from "@tsonic/target-api";
import { pythonExtensionId } from "../python-facts/keys.js";
import { validatePythonTargetOptions } from "../../options/python-target-options.js";

export const pythonTargetSemanticsExtensionId = "tsonic.python.target-semantics";

export function createPythonTargetSemanticsExtension(context: TargetProviderContext): CompilerExtension {
  validatePythonTargetOptions(context.target);
  return {
    identity: {
      id: pythonTargetSemanticsExtensionId,
      version: "0.0.1",
      capabilityNamespace: pythonExtensionId,
    },
    dependencies: {
      dependsOn: [tsonicCoreSourceExtensionId],
      runsAfter: [tsonicCoreSourceExtensionId],
    },
    composition: { kind: "target", target: "python" },
  };
}
