import type { TargetTypeRef } from "@tsonic/tsts";
import type { PythonCapabilityOperationForm, PythonImportBinding, PythonTargetOperationFact } from "../python-facts/keys.js";
import {
  isPythonStrCarrier,
  pythonJsArrayBufferTargetId,
  pythonJsArrayBufferTargetType,
  pythonJsArrayTargetId,
  pythonJsDataViewTargetId,
  pythonJsDataViewTargetType,
  pythonJsDateTargetId,
  pythonJsDateTargetType,
  pythonJsMapTargetId,
  pythonJsMapTargetType,
  pythonJsObjectTargetId,
  pythonJsRegExpTargetId,
  pythonJsRegExpTargetType,
  pythonJsSetTargetId,
  pythonJsSetTargetType,
  pythonJsTypedArrayTargetId,
  pythonJsTypedArrayTargetType,
  pythonJsValueTargetId,
  pythonJsValueTargetType,
  pythonListTargetType,
  pythonNoneTargetType,
  pythonSourcePrimitiveTargetType,
  pythonStrTargetType,
} from "../python-target-types.js";

// Declarative JS surface operation rows lowering onto the tsonic_python_js
// runtime. Rows are matched by the identity of the selected lib declaration
// (owner interface + member name) and the receiver carrier lane; the generic
// matcher below contains no per-name branching. Concrete owner/member
// spellings and runtime symbol names exist only as row data.

export const pythonJsRuntimeModule = "tsonic_python_js";

export interface JsOperationRequest {
  readonly ownerName: string;
  readonly memberName: string;
  readonly operationKind: "call" | "property" | "indexer";
  readonly receiverCarrier?: TargetTypeRef;
  readonly argumentCarriers?: readonly (TargetTypeRef | undefined)[];
}

export type JsCapabilityOperationFact = Extract<PythonTargetOperationFact, { kind: "capability-operation" }>;

export interface JsOperationSelection {
  readonly fact: JsCapabilityOperationFact;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
}

type JsLane =
  | "js-array"
  | "string"
  | "map"
  | "set"
  | "date"
  | "date-static"
  | "dynamic"
  | "regexp"
  | "typed-array"
  | "array-buffer"
  | "data-view"
  | "json"
  | "math"
  | "number"
  | "string-static"
  | "object-static";

type JsCarrierRef =
  | { readonly ref: "int32" }
  | { readonly ref: "float64" }
  | { readonly ref: "bool" }
  | { readonly ref: "str" }
  | { readonly ref: "str-list" }
  | { readonly ref: "none" }
  | { readonly ref: "jsvalue" }
  | { readonly ref: "element" }
  | { readonly ref: "receiver" }
  | { readonly ref: "map-key" }
  | { readonly ref: "map-value" }
  | { readonly ref: "set-value" };

interface JsOperationRowData {
  readonly owner: string;
  readonly member: string;
  readonly operationKind: JsOperationRequest["operationKind"];
  readonly lane: JsLane;
  readonly factOperationKind: "method" | "property" | "indexer";
  readonly target: PythonCapabilityOperationForm;
  readonly result: JsCarrierRef;
  readonly params?: readonly (JsCarrierRef | undefined)[];
  // Rows claimed by a first-argument carrier identity (String.replace with a
  // JsRegExp first argument); rows without the field never match when a
  // competing row claims the call's first-argument identity.
  readonly firstArgCarrierId?: string;
}

function fromJs(name: string): PythonImportBinding {
  return { style: "from", module: pythonJsRuntimeModule, name };
}

// The undefined singleton renders as a module attribute so its spelling
// never collides with a local binding.
export const pythonJsUndefinedForm: PythonCapabilityOperationForm = {
  form: "static-attribute",
  import: { style: "module", module: pythonJsRuntimeModule },
  name: "undefined",
};

// Forms recorded by the write/delete/regex-literal hooks; the concrete
// runtime spellings stay in this file.
export const pythonJsRegExpConstructorForm: PythonCapabilityOperationForm = {
  form: "constructor",
  import: { style: "from", module: pythonJsRuntimeModule, name: "JsRegExp" },
};

export const pythonJsArrayIndexWriteForm: PythonCapabilityOperationForm = { form: "method", name: "set" };

export const pythonJsGetPropertyForm: PythonCapabilityOperationForm = {
  form: "call",
  import: { style: "from", module: pythonJsRuntimeModule, name: "get_property" },
  receiverArgument: true,
};

export const pythonJsSetPropertyForm: PythonCapabilityOperationForm = {
  form: "call",
  import: { style: "from", module: pythonJsRuntimeModule, name: "set_property" },
  receiverArgument: true,
};

export const pythonJsDeletePropertyForm: PythonCapabilityOperationForm = {
  form: "call",
  import: { style: "from", module: pythonJsRuntimeModule, name: "delete_property" },
  receiverArgument: true,
};

function receiverCall(name: string): PythonCapabilityOperationForm {
  return { form: "call", import: fromJs(name), receiverArgument: true };
}

function freeCall(name: string): PythonCapabilityOperationForm {
  return { form: "call", import: fromJs(name) };
}

function method(name: string): PythonCapabilityOperationForm {
  return { form: "method", name };
}

function property(name: string): PythonCapabilityOperationForm {
  return { form: "property", name };
}

const int32: JsCarrierRef = { ref: "int32" };
const float64: JsCarrierRef = { ref: "float64" };
const bool: JsCarrierRef = { ref: "bool" };
const str: JsCarrierRef = { ref: "str" };
const jsvalue: JsCarrierRef = { ref: "jsvalue" };
const element: JsCarrierRef = { ref: "element" };
const receiver: JsCarrierRef = { ref: "receiver" };

function stringRow(
  member: string,
  runtimeName: string,
  result: JsCarrierRef,
  params?: readonly JsCarrierRef[],
  operationKind: JsOperationRequest["operationKind"] = "call",
): JsOperationRowData {
  return {
    owner: "String",
    member,
    operationKind,
    lane: "string",
    factOperationKind: operationKind === "property" ? "property" : "method",
    target: receiverCall(runtimeName),
    result,
    ...(params === undefined ? {} : { params }),
  };
}

function staticCallRow(
  owner: string,
  member: string,
  lane: JsLane,
  runtimeName: string,
  result: JsCarrierRef,
  params?: readonly (JsCarrierRef | undefined)[],
): JsOperationRowData {
  return {
    owner,
    member,
    operationKind: "call",
    lane,
    factOperationKind: "method",
    target: freeCall(runtimeName),
    result,
    ...(params === undefined ? {} : { params }),
  };
}

function memberRow(
  owner: string,
  member: string,
  lane: JsLane,
  target: PythonCapabilityOperationForm,
  factOperationKind: "method" | "property" | "indexer",
  result: JsCarrierRef,
  params?: readonly (JsCarrierRef | undefined)[],
): JsOperationRowData {
  return {
    owner,
    member,
    operationKind: factOperationKind === "property" ? "property" : factOperationKind === "indexer" ? "indexer" : "call",
    lane,
    factOperationKind,
    target,
    result,
    ...(params === undefined ? {} : { params }),
  };
}

const typedArrayOwners = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
] as const;

const dataViewAccessors = [
  ["getInt8", "get_int8", int32, [int32]],
  ["setInt8", "set_int8", { ref: "none" } as JsCarrierRef, [int32, int32]],
  ["getUint8", "get_uint8", int32, [int32]],
  ["setUint8", "set_uint8", { ref: "none" } as JsCarrierRef, [int32, int32]],
  ["getInt16", "get_int16", int32, [int32, bool]],
  ["setInt16", "set_int16", { ref: "none" } as JsCarrierRef, [int32, int32, bool]],
  ["getUint16", "get_uint16", int32, [int32, bool]],
  ["setUint16", "set_uint16", { ref: "none" } as JsCarrierRef, [int32, int32, bool]],
  ["getInt32", "get_int32", int32, [int32, bool]],
  ["setInt32", "set_int32", { ref: "none" } as JsCarrierRef, [int32, int32, bool]],
  ["getUint32", "get_uint32", int32, [int32, bool]],
  ["setUint32", "set_uint32", { ref: "none" } as JsCarrierRef, [int32, int32, bool]],
  ["getFloat32", "get_float32", float64, [int32, bool]],
  ["setFloat32", "set_float32", { ref: "none" } as JsCarrierRef, [int32, float64, bool]],
  ["getFloat64", "get_float64", float64, [int32, bool]],
  ["setFloat64", "set_float64", { ref: "none" } as JsCarrierRef, [int32, float64, bool]],
] as const;

const jsOperationRows: readonly JsOperationRowData[] = [
  // Sparse JsArray lane. Reads of positional slots yield the dynamic carrier
  // (holes surface as undefined).
  memberRow("Array", "length", "js-array", property("length"), "property", int32),
  memberRow("Array", "push", "js-array", method("push"), "method", int32, [element]),
  memberRow("Array", "pop", "js-array", method("pop"), "method", jsvalue),
  memberRow("Array", "shift", "js-array", method("shift"), "method", jsvalue),
  memberRow("Array", "unshift", "js-array", method("unshift"), "method", int32, [element]),
  memberRow("Array", "at", "js-array", method("at"), "method", jsvalue, [int32]),
  memberRow("Array", "includes", "js-array", method("includes"), "method", bool, [element]),
  memberRow("Array", "indexOf", "js-array", method("index_of"), "method", int32, [element]),
  memberRow("Array", "slice", "js-array", method("slice"), "method", receiver, [int32, int32]),
  memberRow("Array", "join", "js-array", method("join"), "method", str, [str]),
  memberRow("Array", "reverse", "js-array", method("reverse"), "method", receiver),
  memberRow("Array", "index", "js-array", method("get"), "indexer", jsvalue, [int32]),

  // String lane: UTF-16 helpers are free functions over native str receivers.
  stringRow("length", "utf16_len", int32, undefined, "property"),
  stringRow("charAt", "char_at", str, [int32]),
  stringRow("charCodeAt", "char_code_at", float64, [int32]),
  stringRow("slice", "string_slice", str, [int32, int32]),
  stringRow("substring", "substring", str, [int32, int32]),
  stringRow("substr", "substr", str, [int32, int32]),
  stringRow("indexOf", "index_of", int32, [str, int32]),
  stringRow("lastIndexOf", "last_index_of", int32, [str, int32]),
  stringRow("includes", "includes", bool, [str, int32]),
  stringRow("startsWith", "starts_with", bool, [str, int32]),
  stringRow("endsWith", "ends_with", bool, [str, int32]),
  stringRow("trim", "trim", str),
  stringRow("trimStart", "trim_start", str),
  stringRow("trimEnd", "trim_end", str),
  stringRow("repeat", "repeat", str, [int32]),
  stringRow("padStart", "pad_start", str, [int32, str]),
  stringRow("padEnd", "pad_end", str, [int32, str]),
  { owner: "String", member: "split", operationKind: "call", lane: "string", factOperationKind: "method", target: receiverCall("split"), result: { ref: "str-list" }, params: [str, int32] },
  // Maybe-undefined positional reads follow the dynamic-result convention.
  stringRow("at", "at", jsvalue, [int32]),
  stringRow("codePointAt", "code_point_at", jsvalue, [int32]),
  stringRow("concat", "concat", str, [str, str, str, str]),
  stringRow("replace", "replace", str, [str, str]),
  stringRow("toUpperCase", "to_upper_case", str),
  stringRow("toLowerCase", "to_lower_case", str),

  // RegExp lane: the pattern subset authority is the runtime constructor.
  memberRow("RegExp", "test", "regexp", method("test"), "method", bool, [str]),
  // String methods with a JsRegExp first argument re-anchor on it: the
  // runtime method's subject is the regexp, the text becomes the first
  // runtime argument.
  { owner: "String", member: "replace", operationKind: "call", lane: "string", factOperationKind: "method", target: { form: "method", name: "replace", argumentReceiver: true }, result: str, params: [undefined, str], firstArgCarrierId: pythonJsRegExpTargetId },
  { owner: "String", member: "split", operationKind: "call", lane: "string", factOperationKind: "method", target: { form: "method", name: "split", argumentReceiver: true }, result: { ref: "str-list" }, params: [undefined], firstArgCarrierId: pythonJsRegExpTargetId },
  { owner: "String", member: "search", operationKind: "call", lane: "string", factOperationKind: "method", target: { form: "method", name: "search", argumentReceiver: true }, result: int32, params: [undefined], firstArgCarrierId: pythonJsRegExpTargetId },

  // Static string factory lane.
  staticCallRow("StringConstructor", "fromCharCode", "string-static", "from_char_code", str, [int32, int32, int32, int32]),
  staticCallRow("StringConstructor", "fromCodePoint", "string-static", "from_code_point", str, [int32, int32, int32, int32]),

  // Number predicate/conversion lane.
  staticCallRow("NumberConstructor", "isNaN", "number", "is_nan", bool, [float64]),
  staticCallRow("NumberConstructor", "isFinite", "number", "is_finite", bool, [float64]),
  staticCallRow("NumberConstructor", "isInteger", "number", "is_integer", bool, [float64]),
  staticCallRow("NumberConstructor", "isSafeInteger", "number", "is_safe_integer", bool, [float64]),
  staticCallRow("NumberConstructor", "parseFloat", "number", "parse_float", float64, [str]),
  staticCallRow("NumberConstructor", "parseInt", "number", "parse_int", float64, [str, int32]),

  // Math lane: every member maps to a math_* runtime helper.
  staticCallRow("Math", "abs", "math", "math_abs", float64, [float64]),
  staticCallRow("Math", "ceil", "math", "math_ceil", float64, [float64]),
  staticCallRow("Math", "floor", "math", "math_floor", float64, [float64]),
  staticCallRow("Math", "trunc", "math", "math_trunc", float64, [float64]),
  staticCallRow("Math", "round", "math", "math_round", float64, [float64]),
  staticCallRow("Math", "sign", "math", "math_sign", float64, [float64]),
  staticCallRow("Math", "sqrt", "math", "math_sqrt", float64, [float64]),
  staticCallRow("Math", "pow", "math", "math_pow", float64, [float64, float64]),
  staticCallRow("Math", "max", "math", "math_max", float64, [float64, float64, float64, float64]),
  staticCallRow("Math", "min", "math", "math_min", float64, [float64, float64, float64, float64]),
  staticCallRow("Math", "imul", "math", "math_imul", int32, [float64, float64]),
  staticCallRow("Math", "clz32", "math", "math_clz32", int32, [float64]),

  // Object static equality.
  staticCallRow("ObjectConstructor", "is", "object-static", "object_is", bool, [undefined, undefined]),

  // JSON lane over closed carriers; results are dynamic values.
  staticCallRow("JSON", "parse", "json", "json_parse", jsvalue, [str]),
  staticCallRow("JSON", "stringify", "json", "json_stringify", jsvalue, [undefined]),

  // Map lane.
  memberRow("Map", "size", "map", property("size"), "property", int32),
  memberRow("Map", "set", "map", method("set"), "method", receiver, [{ ref: "map-key" }, { ref: "map-value" }]),
  memberRow("Map", "get", "map", method("get"), "method", jsvalue, [{ ref: "map-key" }]),
  memberRow("Map", "has", "map", method("has"), "method", bool, [{ ref: "map-key" }]),
  memberRow("Map", "delete", "map", method("delete"), "method", bool, [{ ref: "map-key" }]),
  memberRow("Map", "clear", "map", method("clear"), "method", { ref: "none" }),

  // Set lane.
  memberRow("Set", "size", "set", property("size"), "property", int32),
  memberRow("Set", "add", "set", method("add"), "method", receiver, [{ ref: "set-value" }]),
  memberRow("Set", "has", "set", method("has"), "method", bool, [{ ref: "set-value" }]),
  memberRow("Set", "delete", "set", method("delete"), "method", bool, [{ ref: "set-value" }]),
  memberRow("Set", "clear", "set", method("clear"), "method", { ref: "none" }),

  // Date statics: epoch-ms numbers.
  staticCallRow("DateConstructor", "now", "date-static", "date_now", float64),
  staticCallRow("DateConstructor", "parse", "date-static", "date_parse", float64, [str]),

  // Date lane: UTC epoch-ms subset.
  memberRow("Date", "getTime", "date", method("get_time"), "method", float64),
  memberRow("Date", "toISOString", "date", method("to_iso_string"), "method", str),
  memberRow("Date", "getUTCFullYear", "date", method("get_utc_full_year"), "method", int32),
  memberRow("Date", "getUTCMonth", "date", method("get_utc_month"), "method", int32),
  memberRow("Date", "getUTCDate", "date", method("get_utc_date"), "method", int32),

  // Dynamic lane: keyed reads on JsValue/JsObject carriers.
  memberRow("Array", "index", "dynamic", receiverCall("get_property"), "indexer", jsvalue, [undefined]),

  // Typed-array lane: shared member surface across the concrete classes.
  ...typedArrayOwners.flatMap((owner): readonly JsOperationRowData[] => [
    memberRow(owner, "length", "typed-array", property("length"), "property", int32),
    memberRow(owner, "byteLength", "typed-array", property("byte_length"), "property", int32),
    memberRow(owner, "byteOffset", "typed-array", property("byte_offset"), "property", int32),
    memberRow(owner, "slice", "typed-array", method("slice"), "method", receiver, [int32, int32]),
    memberRow(owner, "subarray", "typed-array", method("subarray"), "method", receiver, [int32, int32]),
    // Bulk copy: set(source) and set(source, offset).
    memberRow(owner, "set", "typed-array", method("set"), "method", { ref: "none" }, [undefined, int32]),
  ]),
  memberRow("Array", "index", "typed-array", method("get"), "indexer", float64, [int32]),

  // ArrayBuffer / DataView lanes.
  memberRow("ArrayBuffer", "byteLength", "array-buffer", property("byte_length"), "property", int32),
  memberRow("ArrayBuffer", "slice", "array-buffer", method("slice"), "method", receiver, [int32, int32]),
  memberRow("DataView", "byteLength", "data-view", property("byte_length"), "property", int32),
  memberRow("DataView", "byteOffset", "data-view", property("byte_offset"), "property", int32),
  ...dataViewAccessors.map(([member, runtimeName, result, params]) =>
    memberRow("DataView", member, "data-view", method(runtimeName), "method", result, params)),
];

interface JsLaneBindings {
  readonly element?: TargetTypeRef;
  readonly mapKey?: TargetTypeRef;
  readonly mapValue?: TargetTypeRef;
  readonly setValue?: TargetTypeRef;
  readonly receiver?: TargetTypeRef;
}

const staticOwnerLanes: Readonly<Record<string, JsLane>> = {
  Math: "math",
  JSON: "json",
  NumberConstructor: "number",
  StringConstructor: "string-static",
  ObjectConstructor: "object-static",
  DateConstructor: "date-static",
};

function laneOf(
  carrier: TargetTypeRef | undefined,
  ownerName: string,
): { readonly lane: JsLane; readonly bindings: JsLaneBindings } | undefined {
  if (carrier === undefined) {
    const staticLane = staticOwnerLanes[ownerName];
    return staticLane === undefined ? undefined : { lane: staticLane, bindings: {} };
  }
  if (isPythonStrCarrier(carrier)) {
    return { lane: "string", bindings: { receiver: carrier } };
  }
  if (carrier.kind !== "target-named") {
    return undefined;
  }
  if (carrier.id === pythonJsArrayTargetId) {
    const arrayElement = carrier.typeArguments?.[0];
    return arrayElement === undefined ? undefined : { lane: "js-array", bindings: { element: arrayElement, receiver: carrier } };
  }
  if (carrier.id === pythonJsMapTargetId) {
    const [mapKey, mapValue] = carrier.typeArguments ?? [];
    return mapKey === undefined || mapValue === undefined
      ? undefined
      : { lane: "map", bindings: { mapKey, mapValue, receiver: carrier } };
  }
  if (carrier.id === pythonJsSetTargetId) {
    const setValue = carrier.typeArguments?.[0];
    return setValue === undefined ? undefined : { lane: "set", bindings: { setValue, receiver: carrier } };
  }
  if (carrier.id === pythonJsDateTargetId) {
    return { lane: "date", bindings: { receiver: carrier } };
  }
  if (carrier.id === pythonJsValueTargetId || carrier.id === pythonJsObjectTargetId) {
    return { lane: "dynamic", bindings: { receiver: carrier } };
  }
  if (carrier.id === pythonJsTypedArrayTargetId) {
    return { lane: "typed-array", bindings: { receiver: carrier } };
  }
  if (carrier.id === pythonJsArrayBufferTargetId) {
    return { lane: "array-buffer", bindings: { receiver: carrier } };
  }
  if (carrier.id === pythonJsDataViewTargetId) {
    return { lane: "data-view", bindings: { receiver: carrier } };
  }
  if (carrier.id === pythonJsRegExpTargetId) {
    return { lane: "regexp", bindings: { receiver: carrier } };
  }
  return undefined;
}

function resolveCarrierRef(reference: JsCarrierRef, bindings: JsLaneBindings): TargetTypeRef | undefined {
  switch (reference.ref) {
    case "int32":
      return pythonSourcePrimitiveTargetType("int32");
    case "float64":
      return pythonSourcePrimitiveTargetType("float64");
    case "bool":
      return pythonSourcePrimitiveTargetType("bool");
    case "str":
      return pythonStrTargetType();
    case "str-list":
      return pythonListTargetType(pythonStrTargetType());
    case "none":
      return pythonNoneTargetType();
    case "jsvalue":
      return pythonJsValueTargetType();
    case "element":
      return bindings.element;
    case "receiver":
      return bindings.receiver;
    case "map-key":
      return bindings.mapKey;
    case "map-value":
      return bindings.mapValue;
    case "set-value":
      return bindings.setValue;
  }
}

function firstArgumentId(request: JsOperationRequest): string | undefined {
  const carrier = request.argumentCarriers?.[0];
  return carrier?.kind === "target-named" ? carrier.id : undefined;
}

export function selectJsSurfaceOperation(request: JsOperationRequest): JsOperationSelection | undefined {
  const laneMatch = laneOf(request.receiverCarrier, request.ownerName);
  if (laneMatch === undefined) {
    return undefined;
  }
  const { lane, bindings } = laneMatch;
  const row = jsOperationRows.find((candidate) =>
    candidate.owner === request.ownerName &&
    candidate.member === request.memberName &&
    candidate.operationKind === request.operationKind &&
    candidate.lane === lane &&
    (candidate.firstArgCarrierId === undefined
      ? firstArgumentId(request) === undefined || !jsOperationRows.some((other) =>
          other.owner === candidate.owner && other.member === candidate.member &&
          other.operationKind === candidate.operationKind && other.firstArgCarrierId === firstArgumentId(request))
      : candidate.firstArgCarrierId === firstArgumentId(request)));
  if (row === undefined) {
    return undefined;
  }
  const resultCarrier = resolveCarrierRef(row.result, bindings);
  if (resultCarrier === undefined) {
    return undefined;
  }
  const parameterCarriers = (row.params ?? []).map((reference) =>
    reference === undefined ? undefined : resolveCarrierRef(reference, bindings));
  return {
    fact: {
      kind: "capability-operation",
      operationId: `tsonic.python.js.${row.owner}.${row.member}.${row.operationKind}`,
      operationKind: row.factOperationKind,
      target: row.target,
      resultCarrier,
    },
    resultCarrier,
    parameterCarriers,
  };
}

// Constructor rows: matched by lib class declaration identity plus argument
// and type-argument counts; type arguments must be primitive/str lanes.
interface JsConstructorRowData {
  readonly className: string;
  readonly typeArgumentCount: number;
  readonly argumentCount: number;
  readonly target: PythonCapabilityOperationForm;
  readonly result: "map" | "set" | "date" | "js-array" | "typed-array" | "array-buffer" | "data-view" | "regexp";
  readonly params?: readonly (JsCarrierRef | undefined)[];
  // Compile-time facts prove only literal patterns; the runtime constructor
  // is the subset authority for what those literals may contain.
  readonly literalStringArguments?: true;
}

const jsConstructorRows: readonly JsConstructorRowData[] = [
  { className: "Map", typeArgumentCount: 2, argumentCount: 0, target: { form: "constructor", import: fromJs("JsMap") }, result: "map" },
  { className: "Set", typeArgumentCount: 1, argumentCount: 0, target: { form: "constructor", import: fromJs("JsSet") }, result: "set" },
  { className: "Date", typeArgumentCount: 0, argumentCount: 1, target: { form: "constructor", import: fromJs("JsDate") }, result: "date", params: [float64] },
  // `new Array<T>(n)` builds a hole-filled sparse array.
  { className: "Array", typeArgumentCount: 1, argumentCount: 1, target: { form: "static-method", import: fromJs("JsArray"), name: "with_length" }, result: "js-array", params: [int32] },
  { className: "ArrayBuffer", typeArgumentCount: 0, argumentCount: 1, target: { form: "constructor", import: fromJs("ArrayBuffer") }, result: "array-buffer", params: [int32] },
  { className: "DataView", typeArgumentCount: 0, argumentCount: 1, target: { form: "constructor", import: fromJs("DataView") }, result: "data-view", params: [undefined] },
  ...typedArrayOwners.map((className): JsConstructorRowData => ({
    className,
    typeArgumentCount: 0,
    argumentCount: 1,
    target: { form: "constructor", import: fromJs(className) },
    result: "typed-array",
    params: [int32],
  })),
  { className: "RegExp", typeArgumentCount: 0, argumentCount: 1, target: pythonJsRegExpConstructorForm, result: "regexp", params: [str], literalStringArguments: true },
  { className: "RegExp", typeArgumentCount: 0, argumentCount: 2, target: pythonJsRegExpConstructorForm, result: "regexp", params: [str, str], literalStringArguments: true },
];

export interface JsConstructorRequest {
  readonly className: string;
  readonly typeArgumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly stringLiteralArguments?: readonly boolean[];
}

export function selectJsSurfaceConstructor(request: JsConstructorRequest): JsOperationSelection | undefined {
  const row = jsConstructorRows.find((candidate) =>
    candidate.className === request.className &&
    candidate.typeArgumentCount === request.typeArgumentCarriers.length &&
    candidate.argumentCount === request.argumentCarriers.length);
  if (row === undefined) {
    return undefined;
  }
  if (row.literalStringArguments === true) {
    const literalFlags = request.stringLiteralArguments;
    if (literalFlags === undefined || literalFlags.length !== request.argumentCarriers.length ||
        !literalFlags.every((isLiteral) => isLiteral)) {
      return undefined;
    }
  }
  const typeArguments = request.typeArgumentCarriers;
  if (!typeArguments.every((carrier) => carrier !== undefined && isPrimitiveLaneCarrier(carrier))) {
    return undefined;
  }
  let resultCarrier: TargetTypeRef | undefined;
  if (row.result === "map") {
    const [key, value] = typeArguments;
    resultCarrier = key !== undefined && value !== undefined ? pythonJsMapTargetType(key, value) : undefined;
  } else if (row.result === "set") {
    const [value] = typeArguments;
    resultCarrier = value === undefined ? undefined : pythonJsSetTargetType(value);
  } else if (row.result === "js-array") {
    const [arrayElement] = typeArguments;
    resultCarrier = arrayElement === undefined
      ? undefined
      : { kind: "target-named", id: pythonJsArrayTargetId, typeArguments: [arrayElement] };
  } else if (row.result === "date") {
    resultCarrier = pythonJsDateTargetType();
  } else if (row.result === "typed-array") {
    resultCarrier = pythonJsTypedArrayTargetType();
  } else if (row.result === "array-buffer") {
    resultCarrier = pythonJsArrayBufferTargetType();
  } else if (row.result === "regexp") {
    resultCarrier = pythonJsRegExpTargetType();
  } else {
    resultCarrier = pythonJsDataViewTargetType();
  }
  if (resultCarrier === undefined) {
    return undefined;
  }
  return {
    fact: {
      kind: "capability-operation",
      operationId: `tsonic.python.js.${row.className}.constructor`,
      operationKind: "constructor",
      target: row.target,
      resultCarrier,
    },
    resultCarrier,
    parameterCarriers: (row.params ?? []).map((reference) =>
      reference === undefined ? undefined : resolveCarrierRef(reference, {})),
  };
}

function isPrimitiveLaneCarrier(carrier: TargetTypeRef): boolean {
  return carrier.kind === "source-primitive" || isPythonStrCarrier(carrier);
}
