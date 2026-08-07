import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  PointerOperationFact,
  ReadonlySourceFactResolver,
} from "@tsonic/tsts";

export interface PythonUnsupportedTypedLocationOperation {
  readonly kind: "unsupported-typed-location";
  readonly operation: PointerOperationFact["operation"];
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
