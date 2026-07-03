import type { TargetCompileInput, TargetDiagnostic } from "@tsonic/target-api";
import type { Node, SourceFile } from "@tsonic/tsts";
import {
  isPythonReservedIdentifier,
  isValidPythonIdentifier,
  manglePythonReservedName,
} from "../../common/python-names.js";

// Structured import requirement collected during planning. The planner emits
// deduped, sorted import statements from these entries; imports are never
// inferred from rendered text.
export type PythonImportRequirement =
  | { readonly kind: "import"; readonly module: string }
  | { readonly kind: "from-import"; readonly module: string; readonly name: string };

// Generated module-level helpers that carry closed Tsonic semantics Python
// operators do not provide directly (truncating integer division/remainder
// per the shared integer contract, versus Python's flooring // and %).
export type PythonRuntimeHelper = "int-div" | "int-rem" | "index-of";

export const pythonHelperNames: Readonly<Record<PythonRuntimeHelper, string>> = {
  "int-div": "_tsonic_int_div",
  "int-rem": "_tsonic_int_rem",
  "index-of": "_tsonic_index_of",
};

// Reserved prefix for generated helper bindings; source names in this
// namespace are unrepresentable and fail closed.
export const pythonGeneratedNamePrefix = "_tsonic_";

export interface PythonPlanContext {
  readonly input: TargetCompileInput;
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly diagnostics: TargetDiagnostic[];
  // Emitted binding names in the enclosing function scope. Python function
  // scope is flat, so duplicate bindings (including reserved-name mangling
  // collisions) fail closed instead of silently merging.
  readonly localNames?: Set<string>;
  // Name that `this` lowers to inside class instance method bodies; `this`
  // outside such a body fails closed.
  readonly selfName?: string;
  // Await expressions are representable only inside an async def body.
  readonly insideAsync?: boolean;
  // Call nodes planned as operands of a proven await expression; calls to
  // async declarations lower only through this set.
  readonly awaitedCalls?: WeakSet<object>;
  // Structured import requirements keyed by a stable dedup key.
  readonly collectedImports?: Map<string, PythonImportRequirement>;
  // Module-level generated helpers required by planned expressions.
  readonly usedHelpers?: Set<PythonRuntimeHelper>;
}

export function diagnosticInput(context: PythonPlanContext, node: Node) {
  return { ast: context.input.ast, sourceFile: context.sourceFile, node };
}

// Local/parameter naming policy: valid source names pass through unchanged
// (no case conversion, ever); reserved names mangle deterministically with a
// trailing underscore; anything else is unrepresentable and the caller fails
// closed.
export function pythonLocalName(name: string): string | undefined {
  if (name.startsWith(pythonGeneratedNamePrefix)) {
    return undefined;
  }
  if (isValidPythonIdentifier(name)) {
    return name;
  }
  return isPythonReservedIdentifier(name) ? manglePythonReservedName(name) : undefined;
}

export function collectHelper(context: PythonPlanContext, helper: PythonRuntimeHelper): void {
  context.usedHelpers?.add(helper);
  if (helper === "int-rem") {
    // The remainder helper is defined in terms of the division helper.
    context.usedHelpers?.add("int-div");
  }
}

export function collectModuleImport(context: PythonPlanContext, module: string): void {
  context.collectedImports?.set(`import:${module}`, { kind: "import", module });
}

export function collectFromImport(context: PythonPlanContext, module: string, name: string): void {
  context.collectedImports?.set(`from:${module}:${name}`, { kind: "from-import", module, name });
}
