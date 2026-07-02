import type { TargetBackend, TargetBackendContext, TargetCompileInput, TargetCompileResult } from "@tsonic/target-api";
import { planPythonArtifacts } from "./planner/python-planner.js";

export function createPythonBackend(_context: TargetBackendContext): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      return planPythonArtifacts(input);
    },
  };
}
