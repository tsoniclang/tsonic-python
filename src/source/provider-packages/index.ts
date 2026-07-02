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

export function createPythonProviderPackage(definition: PythonProviderPackageDefinition): PythonProviderPackageImplementation {
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
