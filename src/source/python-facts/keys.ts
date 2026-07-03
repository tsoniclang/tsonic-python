import { defineExtensionFactKey } from "@tsonic/tsts";
import type { ExtensionFactKey, TargetTypeRef } from "@tsonic/tsts";

export const pythonExtensionId = "tsonic.python";

// Python import binding for a mapped operation. The module/name values come
// from metadata rows (target capabilitys), never from source spelling.
export type PythonImportBinding =
  | { readonly style: "from"; readonly module: string; readonly name: string }
  | { readonly style: "module"; readonly module: string; readonly name?: string };

// Python rendering form for a mapped operation.
export type PythonCapabilityOperationForm =
  | { readonly form: "call"; readonly import: PythonImportBinding }
  | { readonly form: "constructor"; readonly import: PythonImportBinding }
  | { readonly form: "method"; readonly name: string }
  | { readonly form: "property"; readonly name: string }
  | { readonly form: "static-attribute"; readonly import: PythonImportBinding; readonly name: string }
  | {
      // Static method called on an imported class or module binding (e.g.
      // datetime.now()).
      readonly form: "static-method";
      readonly import: PythonImportBinding;
      readonly name: string;
    }
  | { readonly form: "index" }
  | {
      // Python builtin called with the receiver as sole argument (e.g. the
      // selected error policy lowers `.message` reads to str(error)).
      readonly form: "builtin-call";
      readonly name: string;
    };

export type PythonListOperation = "index-read" | "index-write" | "len" | "append" | "includes" | "index-of";

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
      readonly kind: "capability-operation";
      readonly operationId: string;
      readonly operationKind: "method" | "constructor" | "property" | "indexer";
      readonly target: PythonCapabilityOperationForm;
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
    }
  | {
      // Member access on a project-source class instance.
      readonly kind: "source-field";
      readonly operationId: string;
      readonly name: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Method call on a project-source class instance.
      readonly kind: "source-method";
      readonly operationId: string;
      readonly name: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Static method call on a project-source class.
      readonly kind: "source-static-method";
      readonly operationId: string;
      readonly name: string;
      readonly typeCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // new C(...) on a project-source class.
      readonly kind: "source-constructor";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Enum member access on a project-source enum.
      readonly kind: "source-enum-member";
      readonly operationId: string;
      readonly name: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Object literal lowering to a generated record class: field order and
      // carriers come from the finalized shape declaration.
      readonly kind: "record-literal";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
      readonly fieldNames: readonly string[];
    }
  | {
      // `throw new Error(message)` lowering under the selected error policy.
      readonly kind: "throw-op";
      readonly operationId: string;
    }
  | {
      readonly kind: "await-op";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Template literal whose parts all carry proven str/numeric/bool
      // carriers: lowers to an f-string.
      readonly kind: "string-template";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Object literal with a proven Record<string, T> carrier: lowers to a
      // dict literal.
      readonly kind: "dict-literal";
      readonly operationId: string;
      readonly valueCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "dict-op";
      readonly operationId: string;
      readonly op: "index-read" | "index-write";
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "tuple-literal";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "tuple-index";
      readonly operationId: string;
      readonly index: number;
      readonly resultCarrier: TargetTypeRef;
    };

function pythonTargetOperationFactEquals(left: PythonTargetOperationFact, right: PythonTargetOperationFact): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const pythonTargetOperationFactKey: ExtensionFactKey<PythonTargetOperationFact> = defineExtensionFactKey({
  extensionId: pythonExtensionId,
  name: "targetOperation",
  equals: pythonTargetOperationFactEquals,
});

// Async declarations lower to async def; awaited operations require await-op
// facts recorded on the await expression.
export const pythonAsyncFunctionFactKey: ExtensionFactKey<{ readonly isAsync: true }> = defineExtensionFactKey({
  extensionId: pythonExtensionId,
  name: "asyncFunction",
  equals: () => true,
});

// Carrier for a project-source declared type (class, enum, or record shape).
// The backend renders it against the module map derived from the same source
// files.
export interface PythonSourceTypeCarrierValue {
  readonly fileName: string;
  readonly typeName: string;
  readonly shape: "class" | "enum" | "record";
}

export function pythonSourceTypeCarrier(fileName: string, typeName: string, shape: PythonSourceTypeCarrierValue["shape"]): TargetTypeRef {
  return { kind: "target-specific", target: "python", name: "source-type", value: { fileName, typeName, shape } };
}

export function pythonSourceTypeCarrierValue(carrier: TargetTypeRef | undefined): PythonSourceTypeCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "python" || carrier.name !== "source-type") {
    return undefined;
  }
  return carrier.value as PythonSourceTypeCarrierValue;
}
