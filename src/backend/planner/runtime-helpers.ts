import type { PythonExpression, PythonStatement } from "../python-ast/nodes.js";
import { pythonHelperNames } from "./plan-context.js";
import type { PythonRuntimeHelper } from "./plan-context.js";

const intAnnotation = { kind: "name", name: "int" } as const;

function name(text: string): PythonExpression {
  return { kind: "name", name: text };
}

// Truncating integer division per the shared Tsonic integer contract.
// Python's // floors, so the quotient is corrected by one when the floored
// result is negative and the division is inexact.
const intDivHelper: PythonStatement = {
  kind: "function-def",
  name: pythonHelperNames["int-div"],
  params: [
    { name: "a", annotation: intAnnotation },
    { name: "b", annotation: intAnnotation },
  ],
  returns: intAnnotation,
  body: [
    {
      kind: "assign",
      targetName: "q",
      annotation: intAnnotation,
      value: { kind: "binary", operator: "//", left: name("a"), right: name("b") },
    },
    {
      kind: "if",
      condition: {
        kind: "binary",
        operator: "and",
        left: { kind: "binary", operator: "<", left: name("q"), right: { kind: "int-literal", text: "0" } },
        right: {
          kind: "binary",
          operator: "!=",
          left: { kind: "binary", operator: "*", left: name("q"), right: name("b") },
          right: name("a"),
        },
      },
      body: [{
        kind: "assign",
        targetName: "q",
        value: { kind: "binary", operator: "+", left: name("q"), right: { kind: "int-literal", text: "1" } },
      }],
    },
    { kind: "return", expression: name("q") },
  ],
};

// Truncating integer remainder: the dividend keeps its sign, matching the
// shared integer contract rather than Python's divisor-signed %.
const intRemHelper: PythonStatement = {
  kind: "function-def",
  name: pythonHelperNames["int-rem"],
  params: [
    { name: "a", annotation: intAnnotation },
    { name: "b", annotation: intAnnotation },
  ],
  returns: intAnnotation,
  body: [
    {
      kind: "return",
      expression: {
        kind: "binary",
        operator: "-",
        left: name("a"),
        right: {
          kind: "binary",
          operator: "*",
          left: {
            kind: "call",
            callee: name(pythonHelperNames["int-div"]),
            args: [name("a"), name("b")],
          },
          right: name("b"),
        },
      },
    },
  ],
};

// JS indexOf semantics: first strict-equal position or -1. Python's
// list.index raises on absence, so the helper scans explicitly.
const indexOfHelper: PythonStatement = {
  kind: "function-def",
  name: pythonHelperNames["index-of"],
  params: [
    { name: "items", annotation: { kind: "name", name: "list" } },
    { name: "value", annotation: { kind: "name", name: "object" } },
  ],
  returns: intAnnotation,
  body: [
    {
      kind: "for",
      targetName: "index",
      iterable: {
        kind: "call",
        callee: name("range"),
        args: [{ kind: "call", callee: name("len"), args: [name("items")] }],
      },
      body: [{
        kind: "if",
        condition: {
          kind: "binary",
          operator: "==",
          left: { kind: "subscript", value: name("items"), index: name("index") },
          right: name("value"),
        },
        body: [{ kind: "return", expression: name("index") }],
      }],
    },
    { kind: "return", expression: { kind: "unary", operator: "-", operand: { kind: "int-literal", text: "1" } } },
  ],
};

const helperStatements: Readonly<Record<PythonRuntimeHelper, PythonStatement>> = {
  "int-div": intDivHelper,
  "int-rem": intRemHelper,
  "index-of": indexOfHelper,
};

const helperEmissionOrder: readonly PythonRuntimeHelper[] = ["index-of", "int-div", "int-rem"];

export function pythonHelperDefinitions(helpers: ReadonlySet<PythonRuntimeHelper>): readonly PythonStatement[] {
  return helperEmissionOrder
    .filter((helper) => helpers.has(helper))
    .map((helper) => helperStatements[helper]);
}
