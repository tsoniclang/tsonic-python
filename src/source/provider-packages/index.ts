import { TstsProviderContractVersion } from "@tsonic/tsts";
import type {
  CompilerExtension,
  ProviderDeclarationModel,
  ProviderExportDeclaration,
  ProviderModuleResolution,
  ProviderSymbolIdentity,
  TargetBindingProvider,
  TargetIdentity,
  TargetTypeRef,
} from "@tsonic/tsts";
import type {
  TargetProviderPackageImplementation,
  TargetRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetRuntimeReference,
} from "@tsonic/target-api";
import { pythonPackageReferenceKind } from "../../backend/planner/pyproject.js";
import type { PythonProviderOperationForm } from "../python-facts/keys.js";

// Generic Python provider-package model. Concrete module specifiers, export
// names, and Python import paths live only in package definitions (product
// packages or test fakes), never in generic mapping code.

export interface PythonProviderModuleDefinition {
  readonly moduleSpecifier: string;
  readonly providerModuleId: string;
  readonly exports: readonly ProviderExportDeclaration[];
}

export interface PythonProviderOperationRow {
  readonly exportId: string;
  readonly memberId?: string;
  readonly signatureId?: string;
  readonly receiverTypeId?: string;
  readonly operationKind: "method" | "constructor" | "property" | "indexer";
  readonly target: PythonProviderOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly TargetTypeRef[];
  // Async provider operations lower only as await operands; the result
  // carrier is the awaited payload. Supported on method rows only.
  readonly isAsync?: boolean;
}

export interface PythonProviderDependencyDefinition {
  readonly name: string;
  readonly version?: string;
}

export interface PythonProviderPackageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly requiredSurfaces?: readonly string[];
  readonly modules: readonly PythonProviderModuleDefinition[];
  readonly operations: readonly PythonProviderOperationRow[];
  readonly dependencies: readonly PythonProviderDependencyDefinition[];
  readonly targetIdentities?: Readonly<Record<string, string>>;
}

export interface PythonProviderOperationContributor {
  pythonProviderOperations(): readonly PythonProviderOperationRow[];
}

export type PythonProviderPackageImplementation =
  TargetProviderPackageImplementation & PythonProviderOperationContributor;

const pythonIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const pythonModulePathPattern = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/u;

// Hard Python keywords are invalid in any name position. Soft keywords
// (match, case, type) stay allowed: providers legitimately map names like
// re.match.
const pythonHardKeywords: ReadonlySet<string> = new Set([
  "False", "None", "True",
  "and", "as", "assert", "async", "await",
  "break", "class", "continue",
  "def", "del",
  "elif", "else", "except",
  "finally", "for", "from",
  "global",
  "if", "import", "in", "is",
  "lambda",
  "nonlocal", "not",
  "or",
  "pass",
  "raise", "return",
  "try",
  "while", "with",
  "yield",
]);

function isRenderablePythonName(name: string): boolean {
  return pythonIdentifierPattern.test(name) && !pythonHardKeywords.has(name);
}

function isRenderablePythonModulePath(path: string): boolean {
  return pythonModulePathPattern.test(path) && path.split(".").every((segment) => !pythonHardKeywords.has(segment));
}

function validatePythonProviderPackageDefinition(definition: PythonProviderPackageDefinition): void {
  const packageId = definition.id;
  const seenSpecifiers = new Set<string>();
  const seenModuleIds = new Set<string>();
  const declaredExportIds = new Set<string>();
  for (const module of definition.modules) {
    if (module.moduleSpecifier.length === 0) {
      throw new Error(`Provider package '${packageId}': module specifiers must be non-empty.`);
    }
    if (module.providerModuleId.length === 0) {
      throw new Error(`Provider package '${packageId}': provider module ids must be non-empty.`);
    }
    if (seenSpecifiers.has(module.moduleSpecifier)) {
      throw new Error(`Provider package '${packageId}': duplicate module specifier '${module.moduleSpecifier}'.`);
    }
    seenSpecifiers.add(module.moduleSpecifier);
    if (seenModuleIds.has(module.providerModuleId)) {
      throw new Error(`Provider package '${packageId}': duplicate provider module id '${module.providerModuleId}'.`);
    }
    seenModuleIds.add(module.providerModuleId);
    for (const exportDeclaration of module.exports) {
      if (declaredExportIds.has(exportDeclaration.id)) {
        throw new Error(`Provider package '${packageId}': duplicate export id '${exportDeclaration.id}'.`);
      }
      declaredExportIds.add(exportDeclaration.id);
    }
  }
  const seenRows = new Set<string>();
  for (const row of definition.operations) {
    if (!declaredExportIds.has(row.exportId)) {
      throw new Error(`Provider package '${packageId}': operation row references undeclared export '${row.exportId}'.`);
    }
    const rowLabel = row.memberId ?? row.exportId;
    const rowKey = [row.exportId, row.memberId ?? "", row.signatureId ?? "", row.receiverTypeId ?? "", row.operationKind].join("|");
    if (seenRows.has(rowKey)) {
      throw new Error(`Provider package '${packageId}': duplicate operation row for '${rowLabel}' (${row.operationKind}).`);
    }
    seenRows.add(rowKey);
    if ((row.resultCarrier as unknown) === undefined) {
      throw new Error(`Provider package '${packageId}': operation row '${rowLabel}' is missing a result carrier.`);
    }
    if (row.isAsync === true && row.operationKind !== "method") {
      throw new Error(`Provider package '${packageId}': isAsync is supported only on method operations (row '${rowLabel}').`);
    }
    const receiverForms = new Set(["method", "property", "index", "builtin-call"]);
    if (receiverForms.has(row.target.form) && (row.receiverTypeId === undefined || row.receiverTypeId.length === 0)) {
      throw new Error(`Provider package '${packageId}': operation row '${rowLabel}' uses a receiver form and requires a receiverTypeId.`);
    }
    validatePythonProviderOperationForm(packageId, rowLabel, row.target);
  }
}

function validatePythonProviderOperationForm(packageId: string, rowLabel: string, form: PythonProviderOperationForm): void {
  const rejectName = (name: string, what: string): void => {
    if (!isRenderablePythonName(name)) {
      throw new Error(`Provider package '${packageId}': operation row '${rowLabel}' has an invalid Python ${what} '${name}'.`);
    }
  };
  if (form.form === "method" || form.form === "property" || form.form === "builtin-call") {
    rejectName(form.name, "member name");
    return;
  }
  if (form.form === "index") {
    return;
  }
  const binding = form.import;
  if (!isRenderablePythonModulePath(binding.module)) {
    throw new Error(`Provider package '${packageId}': operation row '${rowLabel}' has an invalid Python module '${binding.module}'.`);
  }
  if (binding.style === "from") {
    rejectName(binding.name, "import name");
  } else if (binding.name !== undefined) {
    rejectName(binding.name, "import name");
  }
  if (form.form === "static-attribute") {
    rejectName(form.name, "attribute name");
  }
}

export function createPythonProviderPackage(definition: PythonProviderPackageDefinition): PythonProviderPackageImplementation {
  validatePythonProviderPackageDefinition(definition);
  return {
    id: definition.id,
    displayName: definition.displayName,
    ...(definition.requiredSurfaces === undefined ? {} : { requiredSurfaces: definition.requiredSurfaces }),
    moduleOwnership: definition.modules.map((module) => ({ specifierPrefix: module.moduleSpecifier })),
    createExtensions(): readonly CompilerExtension[] {
      return [createPythonProviderPackageBindingExtension(definition)];
    },
    runtimeContributions(_context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return {
        references: definition.dependencies.map((dependency): TargetRuntimeReference => ({
          kind: pythonPackageReferenceKind,
          include: dependency.name,
          ...(dependency.version === undefined ? {} : { version: dependency.version }),
        })),
      };
    },
    pythonProviderOperations(): readonly PythonProviderOperationRow[] {
      return definition.operations;
    },
  };
}

export function isPythonProviderOperationContributor(
  value: object,
): value is PythonProviderOperationContributor {
  return typeof (value as { pythonProviderOperations?: unknown }).pythonProviderOperations === "function";
}

export function collectPythonProviderOperationRows(
  selectedPackages: readonly object[],
): readonly PythonProviderOperationRow[] {
  const rows: PythonProviderOperationRow[] = [];
  for (const selectedPackage of selectedPackages) {
    if (isPythonProviderOperationContributor(selectedPackage)) {
      rows.push(...selectedPackage.pythonProviderOperations());
    }
  }
  return rows;
}

function createPythonProviderPackageBindingExtension(definition: PythonProviderPackageDefinition): CompilerExtension {
  return {
    identity: {
      id: `tsonic.python.provider-package.${definition.id}`,
      version: definition.version,
      capabilityNamespace: `tsonic.python.provider-package.${definition.id}`,
    },
    initialize(context): void {
      context.registerTargetBindingProvider(createPythonProviderPackageBindingProvider(definition));
    },
  };
}

export function createPythonProviderPackageBindingProvider(definition: PythonProviderPackageDefinition): TargetBindingProvider {
  const modulesBySpecifier = new Map(definition.modules.map((module) => [module.moduleSpecifier, module]));
  return {
    identity: {
      id: `tsonic.python.provider-package.${definition.id}.binding`,
      version: definition.version,
      target: "python",
      extensionContractVersion: TstsProviderContractVersion,
      providerKind: "binding",
    },
    ownsModule(specifier: string) {
      return modulesBySpecifier.has(specifier) ? { kind: "owned" as const } : { kind: "unowned" as const };
    },
    resolveModule(specifier: string) {
      const module = modulesBySpecifier.get(specifier);
      if (module === undefined) {
        return {
          extensionId: `tsonic.python.provider-package.${definition.id}`,
          extensionCode: "PYTHON_PROVIDER_MODULE_NOT_OWNED",
          numericCode: 0,
          category: "error" as const,
          message: `Provider package '${definition.id}' does not own module '${specifier}'.`,
        };
      }
      return {
        kind: "virtual" as const,
        moduleSpecifier: module.moduleSpecifier,
        virtualFileName: `tsts-provider://tsonic-python/${definition.id}/${encodeURIComponent(module.moduleSpecifier)}.d.ts`,
        providerModuleId: module.providerModuleId,
        packageName: module.moduleSpecifier,
        packageVersion: definition.version,
      };
    },
    getDeclarationModel(resolution: ProviderModuleResolution): ProviderDeclarationModel {
      const module = modulesBySpecifier.get(resolution.moduleSpecifier);
      if (module === undefined) {
        return { moduleSpecifier: resolution.moduleSpecifier, providerModuleId: resolution.providerModuleId, exports: [] };
      }
      return {
        moduleSpecifier: module.moduleSpecifier,
        providerModuleId: module.providerModuleId,
        exports: module.exports,
      };
    },
    getTargetIdentity(symbol: ProviderSymbolIdentity): TargetIdentity | undefined {
      const key = symbol.memberName === undefined
        ? `${symbol.moduleSpecifier}::${symbol.exportName ?? ""}`
        : `${symbol.moduleSpecifier}::${symbol.exportName ?? ""}.${symbol.memberName}`;
      const id = definition.targetIdentities?.[key];
      return id === undefined ? undefined : { target: "python", id };
    },
  };
}
