import type { TsonicTargetPlugin } from "@tsonic/target-api";
import { createPythonTargetPack, pythonTargetId } from "./descriptor/python-target-pack.js";

// The package.json tsonic manifest is the generic host discovery contract
// ({ kind: "plugin", contractVersion, entry }); it only locates this entry
// point. Target identity lives here, on the plugin object itself.
export function createTsonicPlugin(): TsonicTargetPlugin {
  return {
    kind: "target",
    id: "@tsonic/target-python",
    targetId: pythonTargetId,
    createTargetPack: createPythonTargetPack,
  };
}
