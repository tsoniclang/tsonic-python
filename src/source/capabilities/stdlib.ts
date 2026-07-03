import type { ProviderTypeExpression, TargetTypeRef } from "@tsonic/tsts";
import { createPythonTargetCapability } from "./index.js";
import type { PythonTargetCapability } from "./index.js";
import {
  pythonNoneTargetType,
  pythonSourcePrimitiveTargetType,
  pythonStrTargetType,
} from "../python-target-types.js";

// Product target capabilities for the Python standard library. Closed
// contracts only: every operation row lowers through an existing lane
// (call/constructor/method/property/static-attribute/static-method/await).
// Concrete Python module and attribute names live here and nowhere else in
// the compiler.
//
// Declaration-shape note: `kind: "value"` exports render (`export declare
// const pi: number;`) and prove in the semantics lane, but bare-identifier
// reads are planned as plain names by the backend, which would emit an
// unqualified `pi` with no import. Module attributes are therefore declared
// as readonly properties on a namespace-shaped export (`math.pi`,
// `os.sep`, `sys.platform`), which lowers through the proven
// static-attribute property lane.

const strCarrier = pythonStrTargetType();
const floatCarrier = pythonSourcePrimitiveTargetType("float64");
const intCarrier = pythonSourcePrimitiveTargetType("int64");
const noneCarrier = pythonNoneTargetType();

export const pythonPathlibPathTargetId = "python.pathlib.Path";
export const pythonDatetimeTargetId = "python.datetime.datetime";

const pathCarrier: TargetTypeRef = { kind: "target-named", id: pythonPathlibPathTargetId };
const datetimeCarrier: TargetTypeRef = { kind: "target-named", id: pythonDatetimeTargetId };

const stdlibVersion = "1.0.0";

export function createPythonMathCapability(): PythonTargetCapability {
  const mathCall = (name: string) =>
    ({ form: "call", import: { style: "module", module: "math", name } }) as const;
  const numberFunction = (name: string, parameters: readonly string[], returnsInt: boolean) => ({
    id: `@python/math::${name}`,
    name,
    kind: "function" as const,
    signatures: [{
      id: `@python/math::${name}(${parameters.join(",")})`,
      name,
      parameters: parameters.map((parameter) => ({ name: parameter, type: { kind: "number" as const } })),
      returnType: returnsInt
        ? { kind: "source-primitive" as const, name: "int64" as const }
        : { kind: "number" as const },
    }],
  });
  return createPythonTargetCapability({
    id: "python-math",
    displayName: "Python stdlib: math",
    version: stdlibVersion,
    modules: [{
      moduleSpecifier: "@python/math",
      providerModuleId: "python.math",
      exports: [
        numberFunction("sqrt", ["x"], false),
        numberFunction("floor", ["x"], true),
        numberFunction("ceil", ["x"], true),
        numberFunction("fabs", ["x"], false),
        numberFunction("pow", ["x", "y"], false),
        {
          id: "@python/math::math",
          name: "math",
          kind: "namespace",
          members: [
            { id: "@python/math::math.pi", name: "pi", kind: "property", readonly: true, type: { kind: "number" } },
            { id: "@python/math::math.e", name: "e", kind: "property", readonly: true, type: { kind: "number" } },
          ],
        },
      ],
    }],
    operations: [
      {
        exportId: "@python/math::sqrt",
        operationKind: "method",
        target: mathCall("sqrt"),
        resultCarrier: floatCarrier,
        parameterCarriers: [floatCarrier],
      },
      {
        exportId: "@python/math::floor",
        operationKind: "method",
        target: mathCall("floor"),
        resultCarrier: intCarrier,
        parameterCarriers: [floatCarrier],
      },
      {
        exportId: "@python/math::ceil",
        operationKind: "method",
        target: mathCall("ceil"),
        resultCarrier: intCarrier,
        parameterCarriers: [floatCarrier],
      },
      {
        exportId: "@python/math::fabs",
        operationKind: "method",
        target: mathCall("fabs"),
        resultCarrier: floatCarrier,
        parameterCarriers: [floatCarrier],
      },
      {
        exportId: "@python/math::pow",
        operationKind: "method",
        target: mathCall("pow"),
        resultCarrier: floatCarrier,
        parameterCarriers: [floatCarrier, floatCarrier],
      },
      {
        exportId: "@python/math::math",
        memberId: "@python/math::math.pi",
        operationKind: "property",
        target: { form: "static-attribute", import: { style: "module", module: "math" }, name: "pi" },
        resultCarrier: floatCarrier,
      },
      {
        exportId: "@python/math::math",
        memberId: "@python/math::math.e",
        operationKind: "property",
        target: { form: "static-attribute", import: { style: "module", module: "math" }, name: "e" },
        resultCarrier: floatCarrier,
      },
    ],
    dependencies: [],
  });
}

export function createPythonPathlibCapability(): PythonTargetCapability {
  const pathRef = { kind: "provider-ref" as const, moduleSpecifier: "@python/pathlib", exportName: "Path" };
  return createPythonTargetCapability({
    id: "python-pathlib",
    displayName: "Python stdlib: pathlib",
    version: stdlibVersion,
    modules: [{
      moduleSpecifier: "@python/pathlib",
      providerModuleId: "python.pathlib",
      exports: [{
        id: "@python/pathlib::Path",
        name: "Path",
        kind: "class",
        members: [
          {
            id: "@python/pathlib::Path.constructor",
            name: "constructor",
            kind: "constructor",
            signatures: [{
              id: "@python/pathlib::Path.constructor(text)",
              parameters: [{ name: "text", type: { kind: "string" } }],
            }],
          },
          { id: "@python/pathlib::Path.name", name: "name", kind: "property", readonly: true, type: { kind: "string" } },
          { id: "@python/pathlib::Path.suffix", name: "suffix", kind: "property", readonly: true, type: { kind: "string" } },
          { id: "@python/pathlib::Path.stem", name: "stem", kind: "property", readonly: true, type: { kind: "string" } },
          {
            id: "@python/pathlib::Path.withSuffix",
            name: "withSuffix",
            kind: "method",
            signatures: [{
              id: "@python/pathlib::Path.withSuffix(suffix)",
              name: "withSuffix",
              parameters: [{ name: "suffix", type: { kind: "string" } }],
              returnType: pathRef,
            }],
          },
          {
            id: "@python/pathlib::Path.joinpath",
            name: "joinpath",
            kind: "method",
            signatures: [{
              id: "@python/pathlib::Path.joinpath(other)",
              name: "joinpath",
              parameters: [{ name: "other", type: { kind: "string" } }],
              returnType: pathRef,
            }],
          },
          {
            id: "@python/pathlib::Path.asPosix",
            name: "asPosix",
            kind: "method",
            signatures: [{
              id: "@python/pathlib::Path.asPosix()",
              name: "asPosix",
              parameters: [],
              returnType: { kind: "string" },
            }],
          },
        ],
      }],
    }],
    operations: [
      {
        exportId: "@python/pathlib::Path",
        operationKind: "constructor",
        target: { form: "constructor", import: { style: "from", module: "pathlib", name: "Path" } },
        resultCarrier: pathCarrier,
        parameterCarriers: [strCarrier],
      },
      {
        exportId: "@python/pathlib::Path",
        memberId: "@python/pathlib::Path.name",
        receiverTypeId: pythonPathlibPathTargetId,
        operationKind: "property",
        target: { form: "property", name: "name" },
        resultCarrier: strCarrier,
      },
      {
        exportId: "@python/pathlib::Path",
        memberId: "@python/pathlib::Path.suffix",
        receiverTypeId: pythonPathlibPathTargetId,
        operationKind: "property",
        target: { form: "property", name: "suffix" },
        resultCarrier: strCarrier,
      },
      {
        exportId: "@python/pathlib::Path",
        memberId: "@python/pathlib::Path.stem",
        receiverTypeId: pythonPathlibPathTargetId,
        operationKind: "property",
        target: { form: "property", name: "stem" },
        resultCarrier: strCarrier,
      },
      {
        exportId: "@python/pathlib::Path",
        memberId: "@python/pathlib::Path.withSuffix",
        receiverTypeId: pythonPathlibPathTargetId,
        operationKind: "method",
        target: { form: "method", name: "with_suffix" },
        resultCarrier: pathCarrier,
        parameterCarriers: [strCarrier],
      },
      {
        exportId: "@python/pathlib::Path",
        memberId: "@python/pathlib::Path.joinpath",
        receiverTypeId: pythonPathlibPathTargetId,
        operationKind: "method",
        target: { form: "method", name: "joinpath" },
        resultCarrier: pathCarrier,
        parameterCarriers: [strCarrier],
      },
      {
        exportId: "@python/pathlib::Path",
        memberId: "@python/pathlib::Path.asPosix",
        receiverTypeId: pythonPathlibPathTargetId,
        operationKind: "method",
        target: { form: "method", name: "as_posix" },
        resultCarrier: strCarrier,
        parameterCarriers: [],
      },
    ],
    dependencies: [],
    targetIdentities: { "@python/pathlib::Path": pythonPathlibPathTargetId },
  });
}

export function createPythonOsCapability(): PythonTargetCapability {
  return createPythonTargetCapability({
    id: "python-os",
    displayName: "Python stdlib: os",
    version: stdlibVersion,
    modules: [{
      moduleSpecifier: "@python/os",
      providerModuleId: "python.os",
      exports: [
        {
          id: "@python/os::getcwd",
          name: "getcwd",
          kind: "function",
          signatures: [{
            id: "@python/os::getcwd()",
            name: "getcwd",
            parameters: [],
            returnType: { kind: "string" },
          }],
        },
        {
          id: "@python/os::os",
          name: "os",
          kind: "namespace",
          members: [
            { id: "@python/os::os.sep", name: "sep", kind: "property", readonly: true, type: { kind: "string" } },
            { id: "@python/os::os.linesep", name: "linesep", kind: "property", readonly: true, type: { kind: "string" } },
          ],
        },
      ],
    }],
    operations: [
      {
        exportId: "@python/os::getcwd",
        operationKind: "method",
        target: { form: "call", import: { style: "module", module: "os", name: "getcwd" } },
        resultCarrier: strCarrier,
        parameterCarriers: [],
      },
      {
        exportId: "@python/os::os",
        memberId: "@python/os::os.sep",
        operationKind: "property",
        target: { form: "static-attribute", import: { style: "module", module: "os" }, name: "sep" },
        resultCarrier: strCarrier,
      },
      {
        exportId: "@python/os::os",
        memberId: "@python/os::os.linesep",
        operationKind: "property",
        target: { form: "static-attribute", import: { style: "module", module: "os" }, name: "linesep" },
        resultCarrier: strCarrier,
      },
    ],
    dependencies: [],
  });
}

export function createPythonSysCapability(): PythonTargetCapability {
  return createPythonTargetCapability({
    id: "python-sys",
    displayName: "Python stdlib: sys",
    version: stdlibVersion,
    modules: [{
      moduleSpecifier: "@python/sys",
      providerModuleId: "python.sys",
      exports: [{
        id: "@python/sys::sys",
        name: "sys",
        kind: "namespace",
        members: [
          { id: "@python/sys::sys.platform", name: "platform", kind: "property", readonly: true, type: { kind: "string" } },
        ],
      }],
    }],
    operations: [{
      exportId: "@python/sys::sys",
      memberId: "@python/sys::sys.platform",
      operationKind: "property",
      target: { form: "static-attribute", import: { style: "module", module: "sys" }, name: "platform" },
      resultCarrier: strCarrier,
    }],
    dependencies: [],
  });
}

export function createPythonDatetimeCapability(): PythonTargetCapability {
  const datetimeRef = { kind: "provider-ref" as const, moduleSpecifier: "@python/datetime", exportName: "datetime" };
  return createPythonTargetCapability({
    id: "python-datetime",
    displayName: "Python stdlib: datetime",
    version: stdlibVersion,
    modules: [{
      moduleSpecifier: "@python/datetime",
      providerModuleId: "python.datetime",
      exports: [{
        id: "@python/datetime::datetime",
        name: "datetime",
        kind: "class",
        members: [
          {
            id: "@python/datetime::datetime.now",
            name: "now",
            kind: "method",
            static: true,
            signatures: [{
              id: "@python/datetime::datetime.now()",
              name: "now",
              parameters: [],
              returnType: datetimeRef,
            }],
          },
          {
            id: "@python/datetime::datetime.isoformat",
            name: "isoformat",
            kind: "method",
            signatures: [{
              id: "@python/datetime::datetime.isoformat()",
              name: "isoformat",
              parameters: [],
              returnType: { kind: "string" },
            }],
          },
          {
            id: "@python/datetime::datetime.year",
            name: "year",
            kind: "property",
            readonly: true,
            type: { kind: "source-primitive", name: "int64" },
          },
        ],
      }],
    }],
    operations: [
      {
        exportId: "@python/datetime::datetime",
        memberId: "@python/datetime::datetime.now",
        operationKind: "method",
        target: { form: "static-method", import: { style: "from", module: "datetime", name: "datetime" }, name: "now" },
        resultCarrier: datetimeCarrier,
        parameterCarriers: [],
      },
      {
        exportId: "@python/datetime::datetime",
        memberId: "@python/datetime::datetime.isoformat",
        receiverTypeId: pythonDatetimeTargetId,
        operationKind: "method",
        target: { form: "method", name: "isoformat" },
        resultCarrier: strCarrier,
        parameterCarriers: [],
      },
      {
        exportId: "@python/datetime::datetime",
        memberId: "@python/datetime::datetime.year",
        receiverTypeId: pythonDatetimeTargetId,
        operationKind: "property",
        target: { form: "property", name: "year" },
        resultCarrier: intCarrier,
      },
    ],
    dependencies: [],
    targetIdentities: { "@python/datetime::datetime": pythonDatetimeTargetId },
  });
}

export function createPythonAsyncioCapability(): PythonTargetCapability {
  return createPythonTargetCapability({
    id: "python-asyncio",
    displayName: "Python stdlib: asyncio",
    version: stdlibVersion,
    modules: [{
      moduleSpecifier: "@python/asyncio",
      providerModuleId: "python.asyncio",
      exports: [{
        id: "@python/asyncio::sleep",
        name: "sleep",
        kind: "function",
        signatures: [{
          id: "@python/asyncio::sleep(seconds)",
          name: "sleep",
          parameters: [{ name: "seconds", type: { kind: "number" } }],
          returnType: { kind: "void" },
        }],
      }],
    }],
    operations: [{
      exportId: "@python/asyncio::sleep",
      operationKind: "method",
      isAsync: true,
      target: { form: "call", import: { style: "module", module: "asyncio", name: "sleep" } },
      resultCarrier: noneCarrier,
      parameterCarriers: [floatCarrier],
    }],
    dependencies: [],
  });
}

// Typed JSON closure: `dumps` accepts only shapes whose carriers are
// natively serializable in generated Python (primitives/str, list and dict
// of primitives/str, tuples and Optionals of accepted shapes). Every dumps
// row carries the json-serializable argument contract, so the semantics
// lane proves the argument carrier before any fact lands — `any`/`unknown`
// values, class instances, and generated records stay fail-closed.
// `loads` ships no row: its return shape is dynamic.
export function createPythonJsonCapability(): PythonTargetCapability {
  const dumpsCall = { form: "call", import: { style: "module", module: "json", name: "dumps" } } as const;
  const dumpsSignature = (label: string, type: ProviderTypeExpression) => ({
    id: `@python/json::dumps(value:${label})`,
    name: "dumps",
    parameters: [{ name: "value", type }],
    returnType: { kind: "string" as const },
  });
  const dumpsRow = (label: string, parameterCarriers?: readonly TargetTypeRef[]) => ({
    exportId: "@python/json::dumps",
    signatureId: `@python/json::dumps(value:${label})`,
    operationKind: "method" as const,
    target: dumpsCall,
    resultCarrier: strCarrier,
    ...(parameterCarriers === undefined ? {} : { parameterCarriers }),
    argumentContract: "json-serializable" as const,
  });
  return createPythonTargetCapability({
    id: "python-json",
    displayName: "Python stdlib: json",
    version: stdlibVersion,
    modules: [{
      moduleSpecifier: "@python/json",
      providerModuleId: "python.json",
      exports: [{
        id: "@python/json::dumps",
        name: "dumps",
        kind: "function",
        // Overload order matters: exact primitive shapes first, then the
        // array shape (which also admits tuples), then the wide fallback
        // that admits dict, Optional, and tuple-of-mixed values whose
        // carriers the argument contract proves.
        signatures: [
          dumpsSignature("string", { kind: "string" }),
          dumpsSignature("number", { kind: "number" }),
          dumpsSignature("boolean", { kind: "boolean" }),
          dumpsSignature("array", {
            kind: "array",
            elementType: { kind: "union", types: [{ kind: "string" }, { kind: "number" }, { kind: "boolean" }] },
          }),
          dumpsSignature("unknown", { kind: "unknown" }),
        ],
      }],
    }],
    operations: [
      dumpsRow("string", [strCarrier]),
      dumpsRow("number", [floatCarrier]),
      dumpsRow("boolean", [pythonSourcePrimitiveTargetType("bool")]),
      dumpsRow("array"),
      dumpsRow("unknown"),
    ],
    dependencies: [],
  });
}

export function createPythonStdlibCapabilities(): readonly PythonTargetCapability[] {
  return [
    createPythonMathCapability(),
    createPythonPathlibCapability(),
    createPythonOsCapability(),
    createPythonSysCapability(),
    createPythonDatetimeCapability(),
    createPythonAsyncioCapability(),
    createPythonJsonCapability(),
  ];
}
