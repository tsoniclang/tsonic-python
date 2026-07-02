import { defineExtensionFactKey } from "@tsonic/tsts";
import type { ExtensionFactKey, TargetTypeRef } from "@tsonic/tsts";

export const pythonExtensionId = "tsonic.python";

// Python import binding for a mapped operation. The module/name values come
// from metadata rows (provider packages), never from source spelling.
export type PythonImportBinding =
  | { readonly style: "from"; readonly module: string; readonly name: string }
  | { readonly style: "module"; readonly module: string; readonly name?: string };

// Python rendering form for a mapped operation.
export type PythonProviderOperationForm =
  | { readonly form: "call"; readonly import: PythonImportBinding }
  | { readonly form: "constructor"; readonly import: PythonImportBinding }
  | { readonly form: "method"; readonly name: string }
  | { readonly form: "property"; readonly name: string }
  | { readonly form: "static-attribute"; readonly import: PythonImportBinding; readonly name: string }
  | { readonly form: "index" };

export type PythonListOperation = "index-read" | "index-write" | "len" | "append";

export type PythonTargetOperationFact =
  | {
      readonly kind: "operator-token";
      readonly operationId: string;
      readonly operator: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "string-concat";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "provider-operation";
      readonly operationId: string;
      readonly operationKind: "method" | "constructor" | "property" | "indexer";
      readonly target: PythonProviderOperationForm;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "array-literal";
      readonly operationId: string;
      readonly lane: "dense";
      readonly elementCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
      readonly length: number;
    }
  | {
      readonly kind: "list-op";
      readonly operationId: string;
      readonly op: PythonListOperation;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "for-of";
      readonly operationId: string;
      readonly elementCarrier: TargetTypeRef;
    };

function pythonTargetOperationFactEquals(left: PythonTargetOperationFact, right: PythonTargetOperationFact): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const pythonTargetOperationFactKey: ExtensionFactKey<PythonTargetOperationFact> = defineExtensionFactKey({
  extensionId: pythonExtensionId,
  name: "targetOperation",
  equals: pythonTargetOperationFactEquals,
});
