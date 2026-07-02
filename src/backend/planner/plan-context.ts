import type { TargetCompileInput, TargetDiagnostic } from "@tsonic/target-api";
import type { SourceFile } from "@tsonic/tsts";

export interface PythonPlanContext {
  readonly input: TargetCompileInput;
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly diagnostics: TargetDiagnostic[];
}
