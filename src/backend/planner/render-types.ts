import type { TargetTypeRef } from "@tsonic/tsts";
import type { PythonTypeAnnotation } from "../python-ast/nodes.js";
import {
  isPythonListCarrier,
  isPythonNoneCarrier,
  isPythonStrCarrier,
  pythonPrimitiveTypeName,
} from "../../source/python-target-types.js";

// Carrier-to-annotation rendering for the static-native spine. Unknown
// carriers return undefined and the caller fails closed.
export function pythonTypeFromCarrier(carrier: TargetTypeRef | undefined): PythonTypeAnnotation | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  if (carrier.kind === "source-primitive") {
    const name = pythonPrimitiveTypeName(carrier.name);
    return name === undefined ? undefined : { kind: "name", name };
  }
  if (isPythonStrCarrier(carrier)) {
    return { kind: "name", name: "str" };
  }
  if (isPythonNoneCarrier(carrier)) {
    return { kind: "none" };
  }
  if (isPythonListCarrier(carrier)) {
    const element = pythonTypeFromCarrier(carrier.element);
    return element === undefined ? undefined : { kind: "subscript", name: "list", arguments: [element] };
  }
  return undefined;
}
