import type { SourcePrimitiveKind, TargetTypeRef } from "@tsonic/tsts";

// Python carrier identities. Carriers are TargetTypeRefs selected by facts;
// the backend renders them to Python type text only at the printer boundary.

export const pythonStrTargetId = "python.str";

// Selected error policy: source `Error` values carry the Python Exception
// identity; catch bindings and throw sites share this carrier.
export const pythonExceptionTargetId = "python.Exception";
export const pythonOptionalTargetId = "python.Optional";
export const pythonDictTargetId = "python.dict";

export function pythonSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return { kind: "source-primitive", name: kind };
}

export function pythonStrTargetType(): TargetTypeRef {
  return { kind: "target-named", id: pythonStrTargetId };
}

export function pythonExceptionTargetType(): TargetTypeRef {
  return { kind: "target-named", id: pythonExceptionTargetId };
}

export function isPythonExceptionCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === pythonExceptionTargetId;
}

export function pythonNoneTargetType(): TargetTypeRef {
  return { kind: "tuple", elements: [] };
}

export function pythonListTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "array", element };
}

export function isPythonNoneCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "tuple" && carrier.elements.length === 0;
}

export function isPythonStrCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === pythonStrTargetId;
}

export function isPythonBoolCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && carrier.name === "bool";
}

export function isPythonListCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "array" }> {
  return carrier?.kind === "array";
}

export function pythonListElementCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "array" ? carrier.element : undefined;
}

// Static-native primitive lowering: every proven integer width lowers to the
// Python arbitrary-precision int; proven binary floats lower to float. Other
// primitive kinds (char, decimal, float16, native ints) stay unmapped and
// fail closed without an owning lane.
const pythonIntegerPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
]);

const pythonFloatPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "float32",
  "float64",
]);

export function pythonPrimitiveTypeName(kind: SourcePrimitiveKind): string | undefined {
  if (kind === "bool") {
    return "bool";
  }
  if (pythonIntegerPrimitiveKinds.has(kind)) {
    return "int";
  }
  if (pythonFloatPrimitiveKinds.has(kind)) {
    return "float";
  }
  return undefined;
}

export function isPythonNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" &&
    (pythonIntegerPrimitiveKinds.has(carrier.name) || pythonFloatPrimitiveKinds.has(carrier.name));
}

export function isPythonIntegerCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && pythonIntegerPrimitiveKinds.has(carrier.name);
}

export function isPythonFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && pythonFloatPrimitiveKinds.has(carrier.name);
}

export function samePythonPrimitiveCarrier(left: TargetTypeRef | undefined, right: TargetTypeRef | undefined): boolean {
  return left?.kind === "source-primitive" && right?.kind === "source-primitive" && left.name === right.name;
}

export function pythonOptionalTargetType(inner: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: pythonOptionalTargetId, typeArguments: [inner] };
}

export function isPythonOptionalCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === pythonOptionalTargetId;
}

export function pythonOptionalInnerCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === pythonOptionalTargetId
    ? carrier.typeArguments?.[0]
    : undefined;
}

export function pythonDictTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: pythonDictTargetId, typeArguments: [pythonStrTargetType(), value] };
}

export function isPythonDictCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === pythonDictTargetId;
}

export function pythonDictValueCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === pythonDictTargetId
    ? carrier.typeArguments?.[1]
    : undefined;
}

export function pythonTupleTargetType(elements: readonly TargetTypeRef[]): TargetTypeRef {
  return { kind: "tuple", elements };
}

export function isPythonTupleCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "tuple" }> {
  return carrier?.kind === "tuple" && carrier.elements.length > 0;
}

// JSON-native carrier shapes for the closed json contract: str and mapped
// primitives serialize directly; list elements and dict values stay
// primitive/str; tuple elements and Optional payloads recurse. Everything
// else (classes, records, exceptions, unproven values) is rejected.
export function isPythonJsonPrimitiveCarrier(carrier: TargetTypeRef | undefined): boolean {
  if (isPythonStrCarrier(carrier)) {
    return true;
  }
  return carrier?.kind === "source-primitive" && pythonPrimitiveTypeName(carrier.name) !== undefined;
}

export function isPythonJsonSerializableCarrier(carrier: TargetTypeRef | undefined): boolean {
  if (isPythonJsonPrimitiveCarrier(carrier)) {
    return true;
  }
  if (isPythonOptionalCarrier(carrier)) {
    const inner = pythonOptionalInnerCarrier(carrier);
    return inner !== undefined && isPythonJsonSerializableCarrier(inner);
  }
  if (isPythonListCarrier(carrier)) {
    return isPythonJsonPrimitiveCarrier(carrier.element);
  }
  const dictValue = pythonDictValueCarrier(carrier);
  if (dictValue !== undefined) {
    return isPythonJsonPrimitiveCarrier(dictValue);
  }
  if (isPythonTupleCarrier(carrier)) {
    return carrier.elements.every((element) => isPythonJsonSerializableCarrier(element));
  }
  return false;
}
