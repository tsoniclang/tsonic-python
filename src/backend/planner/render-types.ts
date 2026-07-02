import type { TargetTypeRef } from "@tsonic/tsts";
import type { PythonTypeAnnotation } from "../python-ast/nodes.js";
import {
  isPythonListCarrier,
  isPythonNoneCarrier,
  isPythonStrCarrier,
  pythonPrimitiveTypeName,
} from "../../source/python-target-types.js";
import { pythonSourceTypeCarrierValue } from "../../source/python-facts/keys.js";
import { isValidPythonIdentifier } from "../../common/python-names.js";
import { collectFromImport } from "./plan-context.js";
import type { PythonPlanContext } from "./plan-context.js";

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

// Resolves a project-source declared type carrier to its generated class
// name, collecting a package-relative from-import when the declaring module
// differs from the module being planned. The name comes from the finalized
// carrier value, never from source spelling at the use site.
export function pythonSourceTypeName(
  carrier: TargetTypeRef | undefined,
  context: PythonPlanContext,
): string | undefined {
  const value = pythonSourceTypeCarrierValue(carrier);
  if (value === undefined || !isValidPythonIdentifier(value.typeName)) {
    return undefined;
  }
  const declarationModule = context.moduleNameByFileName.get(value.fileName);
  if (declarationModule === undefined) {
    return undefined;
  }
  if (declarationModule !== context.moduleName) {
    collectFromImport(context, `.${declarationModule}`, value.typeName);
  }
  return value.typeName;
}

// Context-aware rendering: source-type carriers render as the generated
// class name (with any required structural import); containers compose
// recursively so lists of source types render as list[Name].
export function pythonTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: PythonPlanContext,
): PythonTypeAnnotation | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  const value = pythonSourceTypeCarrierValue(carrier);
  if (value !== undefined) {
    const sourceTypeName = pythonSourceTypeName(carrier, context);
    if (sourceTypeName === undefined) {
      return undefined;
    }
    const declarationModule = context.moduleNameByFileName.get(value.fileName);
    if (declarationModule === context.moduleName) {
      // Annotations evaluate at definition time on the targeted Python
      // version; same-module names quote so self- and forward-references
      // (a method returning its own class) do not fail at import time.
      return { kind: "name", name: `"${sourceTypeName}"` };
    }
    return { kind: "name", name: sourceTypeName };
  }
  if (isPythonListCarrier(carrier)) {
    const element = pythonTypeFromCarrierInContext(carrier.element, context);
    return element === undefined ? undefined : { kind: "subscript", name: "list", arguments: [element] };
  }
  return pythonTypeFromCarrier(carrier);
}
