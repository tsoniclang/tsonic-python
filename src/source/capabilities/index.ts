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
  TargetCapabilityRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetRuntimeReference,
  TsonicTargetCapabilityPlugin,
} from "@tsonic/target-api";
import { pythonPackageReferenceKind } from "../../backend/planner/pyproject.js";
import type { PythonCapabilityOperationForm } from "../python-facts/keys.js";

// Generic Python capability model. Concrete module specifiers, export
// names, and Python import paths live only in package definitions (product
// packages or test fakes), never in generic mapping code.

export interface PythonCapabilityModuleDefinition {
  readonly moduleSpecifier: string;
  readonly providerModuleId: string;
  readonly exports: readonly ProviderExportDeclaration[];
}

export interface PythonCapabilityOperationRow {
  readonly exportId: string;
  readonly memberId?: string;
  readonly signatureId?: string;
  readonly receiverTypeId?: string;
  readonly operationKind: "method" | "constructor" | "property" | "indexer";
  readonly target: PythonCapabilityOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly TargetTypeRef[];
  // Async provider operations lower only as await operands; the result
  // carrier is the awaited payload. Supported on method rows only.
  readonly isAsync?: boolean;
  // Rows with an argument contract record facts only when every argument
  // resolves a proven carrier accepted by the named contract; anything else
  // records nothing and fails closed. Supported on method rows only.
  readonly argumentContract?: "json-serializable";
}

export interface PythonCapabilityDependency {
  readonly name: string;
  readonly version?: string;
}

export interface PythonCapabilityDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly requiredSurfaces?: readonly string[];
  readonly modules: readonly PythonCapabilityModuleDefinition[];
  readonly operations: readonly PythonCapabilityOperationRow[];
  readonly dependencies: readonly PythonCapabilityDependency[];
  readonly targetIdentities?: Readonly<Record<string, string>>;
}

export interface PythonCapabilityOperationContributor {
  pythonCapabilityOperations(): readonly PythonCapabilityOperationRow[];
}

// A Python target capability is an installed target-capability plugin that
// additionally exposes Python-owned operation rows. The generic
// TargetCapabilityOperationMapper is not the operation interface: rows are
// interpreted only by the Python target.
export type PythonTargetCapability =
  TsonicTargetCapabilityPlugin & PythonCapabilityOperationContributor;

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

function validatePythonCapabilityDefinition(definition: PythonCapabilityDefinition): void {
  const packageId = definition.id;
  const seenSpecifiers = new Set<string>();
  const seenModuleIds = new Set<string>();
  const declaredExportIds = new Set<string>();
  const declaredMemberIdsByExport = new Map<string, Set<string>>();
  const declaredSignatureIdsByExport = new Map<string, Set<string>>();
  const declaredSignatureIdsByMember = new Map<string, Set<string>>();
  const declaredTargetIdentityIds = new Set(Object.values(definition.targetIdentities ?? {}));
  for (const module of definition.modules) {
    if (module.moduleSpecifier.length === 0) {
      throw new Error(`Target capability '${packageId}': module specifiers must be non-empty.`);
    }
    if (module.providerModuleId.length === 0) {
      throw new Error(`Target capability '${packageId}': provider module ids must be non-empty.`);
    }
    if (seenSpecifiers.has(module.moduleSpecifier)) {
      throw new Error(`Target capability '${packageId}': duplicate module specifier '${module.moduleSpecifier}'.`);
    }
    seenSpecifiers.add(module.moduleSpecifier);
    if (seenModuleIds.has(module.providerModuleId)) {
      throw new Error(`Target capability '${packageId}': duplicate provider module id '${module.providerModuleId}'.`);
    }
    seenModuleIds.add(module.providerModuleId);
    for (const exportDeclaration of module.exports) {
      if (declaredExportIds.has(exportDeclaration.id)) {
        throw new Error(`Target capability '${packageId}': duplicate export id '${exportDeclaration.id}'.`);
      }
      declaredExportIds.add(exportDeclaration.id);
      const memberIds = new Set<string>();
      const exportSignatureIds = new Set<string>();
      for (const signature of exportDeclaration.signatures ?? []) {
        exportSignatureIds.add(signature.id);
      }
      for (const member of exportDeclaration.members ?? []) {
        memberIds.add(member.id);
        const memberSignatureIds = new Set<string>();
        for (const signature of member.signatures ?? []) {
          memberSignatureIds.add(signature.id);
        }
        declaredSignatureIdsByMember.set(`${exportDeclaration.id}|${member.id}`, memberSignatureIds);
      }
      declaredMemberIdsByExport.set(exportDeclaration.id, memberIds);
      declaredSignatureIdsByExport.set(exportDeclaration.id, exportSignatureIds);
    }
  }
  const seenRows = new Set<string>();
  for (const row of definition.operations) {
    if (!declaredExportIds.has(row.exportId)) {
      throw new Error(`Target capability '${packageId}': operation row references undeclared export '${row.exportId}'.`);
    }
    const rowLabel = row.memberId ?? row.exportId;
    const rowKey = [row.exportId, row.memberId ?? "", row.signatureId ?? "", row.receiverTypeId ?? "", row.operationKind].join("|");
    if (seenRows.has(rowKey)) {
      throw new Error(`Target capability '${packageId}': duplicate operation row for '${rowLabel}' (${row.operationKind}).`);
    }
    seenRows.add(rowKey);
    if ((row.resultCarrier as unknown) === undefined) {
      throw new Error(`Target capability '${packageId}': operation row '${rowLabel}' is missing a result carrier.`);
    }
    if (row.isAsync === true && row.operationKind !== "method") {
      throw new Error(`Target capability '${packageId}': isAsync is supported only on method operations (row '${rowLabel}').`);
    }
    if (row.argumentContract !== undefined && row.operationKind !== "method") {
      throw new Error(`Target capability '${packageId}': argument contracts are supported only on method operations (row '${rowLabel}').`);
    }
    const receiverForms = new Set(["method", "property", "index", "builtin-call"]);
    if (receiverForms.has(row.target.form) && (row.receiverTypeId === undefined || row.receiverTypeId.length === 0)) {
      throw new Error(`Target capability '${packageId}': operation row '${rowLabel}' uses a receiver form and requires a receiverTypeId.`);
    }
    validatePythonCapabilityOperationForm(packageId, rowLabel, row.target);
    // Row identities must prove against the declaration model: bad metadata
    // fails at package creation, never as a downstream missing-fact failure.
    if (row.memberId !== undefined && declaredMemberIdsByExport.get(row.exportId)?.has(row.memberId) !== true) {
      throw new Error(`Target capability '${packageId}': operation row references undeclared member '${row.memberId}' on export '${row.exportId}'.`);
    }
    if (row.signatureId !== undefined) {
      const declaredSignatureIds = row.memberId === undefined
        ? declaredSignatureIdsByExport.get(row.exportId)
        : declaredSignatureIdsByMember.get(`${row.exportId}|${row.memberId}`);
      if (declaredSignatureIds?.has(row.signatureId) !== true) {
        throw new Error(`Target capability '${packageId}': operation row references undeclared signature '${row.signatureId}' on '${row.memberId ?? row.exportId}'.`);
      }
    }
    if (row.receiverTypeId !== undefined && !declaredTargetIdentityIds.has(row.receiverTypeId)) {
      throw new Error(`Target capability '${packageId}': operation row '${rowLabel}' uses receiverTypeId '${row.receiverTypeId}', which is not a declared target identity.`);
    }
  }
}

function validatePythonCapabilityOperationForm(packageId: string, rowLabel: string, form: PythonCapabilityOperationForm): void {
  const rejectName = (name: string, what: string): void => {
    if (!isRenderablePythonName(name)) {
      throw new Error(`Target capability '${packageId}': operation row '${rowLabel}' has an invalid Python ${what} '${name}'.`);
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
    throw new Error(`Target capability '${packageId}': operation row '${rowLabel}' has an invalid Python module '${binding.module}'.`);
  }
  if (binding.style === "from") {
    rejectName(binding.name, "import name");
  } else if (binding.name !== undefined) {
    rejectName(binding.name, "import name");
  }
  if (form.form === "static-attribute" || form.form === "static-method") {
    rejectName(form.name, "attribute name");
  }
}

export function createPythonTargetCapability(definition: PythonCapabilityDefinition): PythonTargetCapability {
  validatePythonCapabilityDefinition(definition);
  return {
    kind: "target-capability",
    id: definition.id,
    targetId: "python",
    displayName: definition.displayName,
    ...(definition.requiredSurfaces === undefined ? {} : { requiredSurfaces: definition.requiredSurfaces }),
    moduleOwnership: definition.modules.map((module) => ({ specifierPrefix: module.moduleSpecifier })),
    createExtensions(): readonly CompilerExtension[] {
      return [createPythonCapabilityBindingExtension(definition)];
    },
    runtimeContributions(_context: TargetCapabilityRuntimeContributionContext): TargetRuntimeContributions {
      return {
        references: definition.dependencies.map((dependency): TargetRuntimeReference => ({
          kind: pythonPackageReferenceKind,
          include: dependency.name,
          ...(dependency.version === undefined ? {} : { version: dependency.version }),
        })),
      };
    },
    pythonCapabilityOperations(): readonly PythonCapabilityOperationRow[] {
      return definition.operations;
    },
  };
}

export function isPythonCapabilityOperationContributor(
  value: object,
): value is PythonCapabilityOperationContributor {
  return typeof (value as { pythonCapabilityOperations?: unknown }).pythonCapabilityOperations === "function";
}

export function collectPythonCapabilityOperationRows(
  installedCapabilities: readonly object[],
): readonly PythonCapabilityOperationRow[] {
  const rows: PythonCapabilityOperationRow[] = [];
  for (const installedCapability of installedCapabilities) {
    if (isPythonCapabilityOperationContributor(installedCapability)) {
      rows.push(...installedCapability.pythonCapabilityOperations());
    }
  }
  return rows;
}

function createPythonCapabilityBindingExtension(definition: PythonCapabilityDefinition): CompilerExtension {
  return {
    identity: {
      id: `tsonic.python.capability.${definition.id}`,
      version: definition.version,
      capabilityNamespace: `tsonic.python.capability.${definition.id}`,
    },
    initialize(context): void {
      context.registerTargetBindingProvider(createPythonCapabilityBindingProvider(definition));
    },
  };
}

export function createPythonCapabilityBindingProvider(definition: PythonCapabilityDefinition): TargetBindingProvider {
  const modulesBySpecifier = new Map(definition.modules.map((module) => [module.moduleSpecifier, module]));
  return {
    identity: {
      id: `tsonic.python.capability.${definition.id}.binding`,
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
          extensionId: `tsonic.python.capability.${definition.id}`,
          extensionCode: "PYTHON_CAPABILITY_MODULE_NOT_OWNED",
          numericCode: 0,
          category: "error" as const,
          message: `Target capability '${definition.id}' does not own module '${specifier}'.`,
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
