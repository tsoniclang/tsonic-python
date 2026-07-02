import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type { Node, SourceFile } from "@tsonic/tsts";
import type {
  TargetArtifact,
  TargetCompileInput,
  TargetCompileResult,
  TargetDiagnostic,
  TargetSourceFile,
} from "@tsonic/target-api";
import {
  KindEndOfFile,
  KindFunctionDeclaration,
  KindImportDeclaration,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import { readPythonOutputType, readPythonPackageName } from "../../options/python-target-options.js";
import { isPythonNoneCarrier } from "../../source/python-target-types.js";
import { createPythonModule } from "../python-ast/nodes.js";
import type { PythonStatement } from "../python-ast/nodes.js";
import { printPythonModule } from "../../print/python-printer.js";
import { printPyprojectManifest } from "../../print/pyproject-printer.js";
import { planPyprojectManifest } from "./pyproject.js";
import { unsupportedStatementDiagnostic } from "./diagnostics.js";
import { isValidPythonModuleName } from "../../common/python-names.js";
import { planFunctionDeclaration } from "./functions.js";
import type { PythonImportRequirement, PythonPlanContext } from "./plan-context.js";

export function planPythonArtifacts(input: TargetCompileInput): TargetCompileResult {
  const diagnostics: TargetDiagnostic[] = [];
  const moduleNameByFileName = planModuleNames(input, diagnostics);
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const moduleStatements = new Map<string, readonly PythonStatement[]>();
  for (const sourceFile of input.sourceFiles) {
    const fileName = input.ast.getFileName(sourceFile);
    const moduleName = moduleNameByFileName.get(fileName);
    if (moduleName === undefined) {
      continue;
    }
    const collectedImports = new Map<string, PythonImportRequirement>();
    const context: PythonPlanContext = {
      input,
      sourceFile,
      moduleName,
      moduleNameByFileName,
      diagnostics,
      collectedImports,
    };
    const planned = planModuleStatements(context);
    moduleStatements.set(moduleName, [...renderCollectedImports(collectedImports), ...planned]);
  }

  const manifestPlan = planPyprojectManifest(input.target, input.runtimeReferences);
  if (manifestPlan.manifest === undefined) {
    return { artifacts: [], diagnostics: [...diagnostics, ...manifestPlan.diagnostics] };
  }

  const outputType = readPythonOutputType(input.target);
  const scriptEntry = outputType === "script"
    ? resolveScriptEntry(input, moduleNameByFileName, diagnostics)
    : undefined;

  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const packageName = readPythonPackageName(input.target);
  const sortedModuleNames = [...moduleStatements.keys()].sort((left, right) => left.localeCompare(right, "en"));
  const artifacts: TargetArtifact[] = [
    {
      kind: "project",
      path: "pyproject.toml",
      text: printPyprojectManifest(manifestPlan.manifest),
    },
    pythonSourceArtifact(`src/${packageName}/__init__.py`, printPythonModule(createPythonModule([]))),
  ];
  for (const moduleName of sortedModuleNames) {
    const statements = moduleStatements.get(moduleName) ?? [];
    artifacts.push(pythonSourceArtifact(
      `src/${packageName}/${moduleName}.py`,
      printPythonModule(createPythonModule(statements)),
    ));
  }
  if (outputType === "script" && scriptEntry !== undefined) {
    const mainModule = createPythonModule([
      {
        kind: "from-import",
        module: `${packageName}.${scriptEntry.moduleName}`,
        names: [{ name: scriptEntry.functionName }],
      },
      {
        kind: "expr",
        expression: { kind: "call", callee: { kind: "name", name: scriptEntry.functionName }, args: [] },
      },
    ]);
    artifacts.push(pythonSourceArtifact(`src/${packageName}/__main__.py`, printPythonModule(mainModule)));
  }
  return { artifacts, diagnostics: [] };
}

function pythonSourceArtifact(path: string, text: string): TargetSourceFile {
  return { kind: "source", path, language: "python", text };
}

function planModuleNames(
  input: TargetCompileInput,
  diagnostics: TargetDiagnostic[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const sourceFile of input.sourceFiles) {
    const fileName = input.ast.getFileName(sourceFile);
    if (fileName.endsWith(".d.ts")) {
      continue;
    }
    const moduleName = pythonModuleNameForFile(fileName);
    if (moduleName === undefined) {
      diagnostics.push(moduleNameDiagnostic(input, sourceFile, `Source file '${fileName}' does not map to a valid Python module name.`));
      continue;
    }
    const existing = seen.get(moduleName);
    if (existing !== undefined) {
      diagnostics.push(moduleNameDiagnostic(input, sourceFile, `Source files '${existing}' and '${fileName}' both map to Python module '${moduleName}'.`));
      continue;
    }
    seen.set(moduleName, fileName);
    names.set(fileName, moduleName);
  }
  return names;
}

export function pythonModuleNameForFile(fileName: string): string | undefined {
  const base = fileName.split("/").pop() ?? "";
  const stem = base.replace(/\.(ts|mts|cts|tsx)$/u, "");
  if (stem.length === 0) {
    return undefined;
  }
  const sanitized = stem
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "_");
  if (!isValidPythonModuleName(sanitized)) {
    return undefined;
  }
  return sanitized;
}

function moduleNameDiagnostic(input: TargetCompileInput, sourceFile: SourceFile, message: string): TargetDiagnostic {
  return {
    code: "PYTHON_MODULE_NAME",
    category: "error",
    source: "tsonic-python",
    message,
    evidence: [
      "target.capability=python.backend.module-name",
      `source.file=${input.ast.getFileName(sourceFile)}`,
    ],
  };
}

function planModuleStatements(context: PythonPlanContext): readonly PythonStatement[] {
  const { ast } = context.input;
  const statements: PythonStatement[] = [];
  for (const statement of ast.statements(context.sourceFile)) {
    if (statement === undefined) {
      continue;
    }
    const kind = ast.kindName(statement);
    if (kind === KindEndOfFile) {
      continue;
    }
    if (kind === KindImportDeclaration) {
      planImportDeclaration(statement, context);
      continue;
    }
    if (kind === KindFunctionDeclaration) {
      const planned = planFunctionDeclaration(statement, context);
      if (planned !== undefined) {
        statements.push(planned);
      }
      continue;
    }
    context.diagnostics.push(unsupportedStatementDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "python.backend.statement",
    ));
  }
  return statements;
}

// Type-only imports are erased. Value imports are erased only when every
// imported binding is proven (a target binding fact from a provider package,
// or a resolution to a compiled project source module); reference sites
// re-derive their own structural imports. Anything else, including bare
// side-effect imports, fails closed.
function planImportDeclaration(statement: Node, context: PythonPlanContext): void {
  const { ast } = context.input;
  if (ast.isTypeOnlyImportDeclaration(statement)) {
    return;
  }
  const bindingNames = collectImportBindingNames(statement, context);
  const proven = bindingNames.length > 0 &&
    bindingNames.every((nameNode) => isProvenImportBinding(nameNode, context));
  if (!proven) {
    context.diagnostics.push(unsupportedStatementDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "python.backend.import",
    ));
  }
}

function collectImportBindingNames(statement: Node, context: PythonPlanContext): readonly Node[] {
  const { ast } = context.input;
  const names: Node[] = [];
  const visit = (candidate: Node): void => {
    const kind = ast.kindName(candidate);
    if (kind === "KindImportSpecifier" || kind === "KindNamespaceImport") {
      if (!ast.isTypeOnlyImportDeclaration(candidate)) {
        names.push(Node_Name(candidate) ?? candidate);
      }
      return;
    }
    if (kind === "KindImportClause") {
      const defaultName = Node_Name(candidate);
      if (defaultName !== undefined) {
        names.push(defaultName);
      }
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  ast.forEachChild(statement, (child) => {
    if (child !== undefined) {
      visit(child);
    }
  });
  return names;
}

function isProvenImportBinding(nameNode: Node, context: PythonPlanContext): boolean {
  const { input } = context;
  if (input.targetFacts.getTargetBinding(nameNode) !== undefined) {
    return true;
  }
  if (input.targetFacts.getTargetBindingForReference(nameNode, { sourceFile: context.sourceFile }) !== undefined) {
    return true;
  }
  if (isProviderDeclaredBinding(nameNode, context)) {
    return true;
  }
  const reference = input.analysis.getProjectSourceReferenceForNode(nameNode, { sourceFile: context.sourceFile });
  if (reference === undefined) {
    return false;
  }
  return context.moduleNameByFileName.get(input.ast.getFileName(reference.sourceFile)) !== undefined;
}

// A binding is proven when its (alias-resolved) symbol declarations carry the
// provider virtual declaration fact: the module is owned by a selected
// provider package, so reference sites lower through provider-operation facts.
function isProviderDeclaredBinding(nameNode: Node, context: PythonPlanContext): boolean {
  const { input } = context;
  const options = { sourceFile: context.sourceFile };
  for (const symbol of [
    input.analysis.getSymbolAtLocation(nameNode, options),
    input.analysis.getResolvedSymbol(nameNode, options),
  ]) {
    for (const declaration of input.analysis.getSymbolDeclarations(symbol)) {
      if (input.facts.getFact(declaration, providerVirtualDeclarationFactKey) !== undefined) {
        return true;
      }
    }
  }
  return false;
}

// Deterministic import emission: from-imports of the same module merge into
// one statement with sorted names; statements sort by module, then first name.
function renderCollectedImports(
  requirements: ReadonlyMap<string, PythonImportRequirement>,
): readonly PythonStatement[] {
  const moduleImports = new Set<string>();
  const fromImports = new Map<string, Set<string>>();
  for (const requirement of requirements.values()) {
    if (requirement.kind === "import") {
      moduleImports.add(requirement.module);
      continue;
    }
    const names = fromImports.get(requirement.module) ?? new Set<string>();
    names.add(requirement.name);
    fromImports.set(requirement.module, names);
  }
  const entries: { readonly module: string; readonly name: string; readonly statement: PythonStatement }[] = [];
  for (const module of moduleImports) {
    entries.push({ module, name: "", statement: { kind: "import", module } });
  }
  for (const [module, names] of fromImports) {
    const sortedNames = [...names].sort((left, right) => left.localeCompare(right, "en"));
    entries.push({
      module,
      name: sortedNames[0] ?? "",
      statement: { kind: "from-import", module, names: sortedNames.map((name) => ({ name })) },
    });
  }
  entries.sort((left, right) =>
    left.module.localeCompare(right.module, "en") || left.name.localeCompare(right.name, "en"));
  return entries.map((entry) => entry.statement);
}

interface PythonScriptEntry {
  readonly moduleName: string;
  readonly functionName: string;
}

function resolveScriptEntry(
  input: TargetCompileInput,
  moduleNameByFileName: ReadonlyMap<string, string>,
  diagnostics: TargetDiagnostic[],
): PythonScriptEntry | undefined {
  const entryPoint = input.project.entryPoint;
  const entrySourceFile = input.sourceFiles.find((sourceFile) => {
    const fileName = input.ast.getFileName(sourceFile);
    return fileName === entryPoint || fileName.endsWith(`/${entryPoint}`);
  });
  const entryFileName = entrySourceFile === undefined ? undefined : input.ast.getFileName(entrySourceFile);
  const moduleName = entryFileName === undefined ? undefined : moduleNameByFileName.get(entryFileName);
  if (entrySourceFile === undefined || moduleName === undefined) {
    diagnostics.push({
      code: "PYTHON_MISSING_ENTRYPOINT",
      category: "error",
      source: "tsonic-python",
      message: `Script output requires entry point '${entryPoint}' to be part of the compiled sources.`,
      evidence: ["target.capability=python.backend.entrypoint"],
    });
    return undefined;
  }
  for (const statement of input.ast.statements(entrySourceFile)) {
    if (statement === undefined || input.ast.kindName(statement) !== KindFunctionDeclaration) {
      continue;
    }
    const nameNode = Node_Name(statement);
    if (nameNode === undefined || input.ast.text(nameNode) !== "main") {
      continue;
    }
    const returnTypeNode = Node_Type(statement);
    const returnCarrier = returnTypeNode === undefined
      ? undefined
      : input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
    if (!input.ast.hasModifierKind(statement, "export") || !isPythonNoneCarrier(returnCarrier) || input.ast.hasModifierKind(statement, "async")) {
      // Async entry points would require an implicit event loop selection.
      break;
    }
    return { moduleName, functionName: "main" };
  }
  diagnostics.push({
    code: "PYTHON_MISSING_ENTRYPOINT",
    category: "error",
    source: "tsonic-python",
    message: "Script output requires the entry module to export a 'main' function returning void.",
    evidence: ["target.capability=python.backend.entrypoint"],
  });
  return undefined;
}
