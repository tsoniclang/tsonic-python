import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  ReadonlySourceFactResolver,
} from "@tsonic/tsts";

export interface PythonUnsupportedTypedLocationOperation {
  readonly kind: "unsupported-typed-location";
  readonly operation: "address-of" | "allocate" | "load" | "store";
}

export function selectPythonTypedLocationDisposition(
  facts: ReadonlySourceFactResolver,
  subject: ExtensionFactSubject,
): PythonUnsupportedTypedLocationOperation | undefined {
  const sourceOperation = facts.getFact(subject, pointerOperationFactKey);
  return sourceOperation === undefined
    ? undefined
    : {
        kind: "unsupported-typed-location",
        operation: sourceOperation.operation,
      };
}
