import type { Node, TargetTypeRef } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression,
  KindArrayLiteralExpression,
  KindBinaryExpression,
  KindCallExpression,
  KindElementAccessExpression,
  KindFalseKeyword,
  KindIdentifier,
  KindNewExpression,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindStringLiteral,
  KindTrueKeyword,
  Node_Expression,
  PrefixUnaryExpression_Operand,
} from "../../common/source-ast.js";
import { pythonTargetOperationFactKey } from "../../source/python-facts/keys.js";
import type {
  PythonImportBinding,
  PythonProviderOperationForm,
  PythonTargetOperationFact,
} from "../../source/python-facts/keys.js";
import { isPythonFloatCarrier, isPythonIntegerCarrier } from "../../source/python-target-types.js";
import { isValidPythonIdentifier } from "../../common/python-names.js";
import type { PythonBinaryOperator, PythonExpression, PythonUnaryOperator } from "../python-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { collectFromImport, collectModuleImport, diagnosticInput, pythonLocalName } from "./plan-context.js";
import type { PythonPlanContext } from "./plan-context.js";

const pythonBinaryOperators: ReadonlySet<string> = new Set<PythonBinaryOperator>([
  "+", "-", "*", "/", "//", "%", "==", "!=", "<", "<=", ">", ">=", "and", "or",
]);

const pythonUnaryOperators: ReadonlySet<string> = new Set<PythonUnaryOperator>(["-", "not"]);

// Operators come from finalized facts, never from source token spelling; a
// fact operator outside the printable set fails closed.
export function asPythonBinaryOperator(operator: string): PythonBinaryOperator | undefined {
  return pythonBinaryOperators.has(operator) ? (operator as PythonBinaryOperator) : undefined;
}

function asPythonUnaryOperator(operator: string): PythonUnaryOperator | undefined {
  return pythonUnaryOperators.has(operator) ? (operator as PythonUnaryOperator) : undefined;
}

export function expressionCarrier(node: Node, context: PythonPlanContext): TargetTypeRef | undefined {
  return context.input.facts.getRuntimeCarrierFact(node)?.carrier;
}

export function pythonOperationFact(node: Node, context: PythonPlanContext): PythonTargetOperationFact | undefined {
  return context.input.facts.getFact(node, pythonTargetOperationFactKey);
}

export function planExpression(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindNumericLiteral: {
      return planNumericLiteral(node, context);
    }
    case KindStringLiteral: {
      return { kind: "string-literal", value: ast.text(node) };
    }
    case KindTrueKeyword: {
      return { kind: "bool-literal", value: true };
    }
    case KindFalseKeyword: {
      return { kind: "bool-literal", value: false };
    }
    case KindIdentifier: {
      return planIdentifier(node, context);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(node);
      return inner === undefined ? undefined : planExpression(inner, context);
    }
    case KindArrayLiteralExpression: {
      return planArrayLiteral(node, context);
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return planUnaryExpression(node, context);
    }
    case KindBinaryExpression: {
      return planBinaryExpression(node, context);
    }
    case KindCallExpression: {
      return planCallExpression(node, context);
    }
    case KindNewExpression: {
      return planNewExpression(node, context);
    }
    case KindPropertyAccessExpression: {
      return planPropertyAccess(node, context);
    }
    case KindElementAccessExpression: {
      return planElementAccess(node, context);
    }
    default: {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.expression",
        "The Python target does not support this expression.",
      ));
      return undefined;
    }
  }
}

export function planNumericLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const carrier = expressionCarrier(node, context);
  if (carrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.literal-carrier",
      "Numeric literal has no finalized Python carrier fact.",
    ));
    return undefined;
  }
  const text = context.input.ast.text(node);
  if (isPythonFloatCarrier(carrier)) {
    const floatText = text.includes(".") || text.includes("e") || text.includes("E") ? text : `${text}.0`;
    return { kind: "float-literal", text: floatText };
  }
  if (isPythonIntegerCarrier(carrier)) {
    if (!/^[0-9]+$/u.test(text)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.literal-carrier",
        `Numeric literal '${text}' cannot lower to an integer carrier.`,
      ));
      return undefined;
    }
    return { kind: "int-literal", text };
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    "python.backend.literal-carrier",
    "Numeric literal carrier is not a supported Python numeric carrier.",
  ));
  return undefined;
}

function planIdentifier(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const { ast } = context.input;
  const reference = context.input.analysis.getProjectSourceReferenceForNode(node, { sourceFile: context.sourceFile });
  if (reference !== undefined) {
    const declarationModule = context.moduleNameByFileName.get(ast.getFileName(reference.sourceFile));
    if (declarationModule !== undefined && declarationModule !== context.moduleName) {
      // Cross-module references are public names: preserved verbatim and
      // satisfied by a structural relative from-import.
      const declarationName = ast.text(ast.name(reference.declaration) ?? reference.declaration);
      if (!isValidPythonIdentifier(declarationName)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "python.backend.identifier",
          `Imported declaration '${declarationName}' is not a valid Python identifier.`,
        ));
        return undefined;
      }
      collectFromImport(context, `.${declarationModule}`, declarationName);
      return { kind: "name", name: declarationName };
    }
  }
  const name = pythonLocalName(ast.text(node));
  if (name === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.identifier",
      `Identifier '${ast.text(node)}' does not lower to a valid Python identifier.`,
    ));
    return undefined;
  }
  return { kind: "name", name };
}

function planUnaryExpression(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "operator-token") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.operator",
      "Unary expression requires a finalized Python operator fact.",
    ));
    return undefined;
  }
  const operator = asPythonUnaryOperator(fact.operator);
  if (operator === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.operator",
      `Unary operator '${fact.operator}' is only supported in statement position.`,
    ));
    return undefined;
  }
  const operandNode = PrefixUnaryExpression_Operand(node);
  const operand = operandNode === undefined ? undefined : planExpression(operandNode, context);
  return operand === undefined ? undefined : { kind: "unary", operator, operand };
}

function planBinaryExpression(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.operator",
      "Binary expression requires a finalized Python operator fact.",
    ));
    return undefined;
  }
  const leftNode = BinaryExpression_Left(node);
  const rightNode = BinaryExpression_Right(node);
  const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
  const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
  if (left === undefined || right === undefined) {
    return undefined;
  }
  if (fact.kind === "string-concat") {
    return { kind: "binary", operator: "+", left, right };
  }
  if (fact.kind === "operator-token") {
    const operator = asPythonBinaryOperator(fact.operator);
    if (operator === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.operator",
        `Binary operator '${fact.operator}' is not a supported Python operator.`,
      ));
      return undefined;
    }
    return { kind: "binary", operator, left, right };
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "python.backend.operator",
    "Binary expression selected a non-operator Python operation.",
  ));
  return undefined;
}

function planArguments(node: Node, context: PythonPlanContext): readonly PythonExpression[] | undefined {
  const args: PythonExpression[] = [];
  for (const argument of context.input.ast.arguments(node)) {
    if (argument === undefined) {
      continue;
    }
    const planned = planExpression(argument, context);
    if (planned === undefined) {
      return undefined;
    }
    args.push(planned);
  }
  return args;
}

// Structural import binding for a mapped operation. Module and name text come
// from metadata rows, never from source spelling.
function importBindingExpression(context: PythonPlanContext, binding: PythonImportBinding): PythonExpression {
  if (binding.style === "from") {
    collectFromImport(context, binding.module, binding.name);
    return { kind: "name", name: binding.name };
  }
  collectModuleImport(context, binding.module);
  const segments = binding.module.split(".");
  let expression: PythonExpression = { kind: "name", name: segments[0] ?? binding.module };
  for (const segment of segments.slice(1)) {
    expression = { kind: "attribute", value: expression, name: segment };
  }
  return binding.name === undefined ? expression : { kind: "attribute", value: expression, name: binding.name };
}

function planProviderOperationExpression(
  context: PythonPlanContext,
  form: PythonProviderOperationForm,
  receiverNode: Node | undefined,
  args: readonly PythonExpression[],
): PythonExpression | undefined {
  switch (form.form) {
    case "call":
    case "constructor": {
      return { kind: "call", callee: importBindingExpression(context, form.import), args };
    }
    case "method": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiver === undefined) {
        return undefined;
      }
      return { kind: "call", callee: { kind: "attribute", value: receiver, name: form.name }, args };
    }
    case "property": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiver === undefined || args.length !== 0) {
        return undefined;
      }
      return { kind: "attribute", value: receiver, name: form.name };
    }
    case "static-attribute": {
      if (args.length !== 0) {
        return undefined;
      }
      return { kind: "attribute", value: importBindingExpression(context, form.import), name: form.name };
    }
    case "index": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      const index = args[0];
      if (receiver === undefined || index === undefined || args.length !== 1) {
        return undefined;
      }
      return { kind: "subscript", value: receiver, index };
    }
  }
}

function planCallExpression(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const { ast } = context.input;
  const args = planArguments(node, context);
  if (args === undefined) {
    return undefined;
  }
  const callee = Node_Expression(node);
  const receiverNode = callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression
    ? Node_Expression(callee)
    : undefined;
  const fact = pythonOperationFact(node, context);
  if (fact !== undefined && fact.kind === "list-op") {
    if (fact.op !== "append" || receiverNode === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.list-op",
        "List operation is not supported in call position.",
      ));
      return undefined;
    }
    const receiver = planExpression(receiverNode, context);
    if (receiver === undefined) {
      return undefined;
    }
    return { kind: "call", callee: { kind: "attribute", value: receiver, name: "append" }, args };
  }
  if (fact !== undefined && fact.kind === "provider-operation") {
    const planned = planProviderOperationExpression(context, fact.target, receiverNode, args);
    if (planned === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.provider.call",
        "Provider call operation could not be lowered.",
      ));
    }
    return planned;
  }
  if (fact !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.call",
      "Call expression selected a non-call Python operation.",
    ));
    return undefined;
  }
  const reference = callee === undefined
    ? undefined
    : context.input.analysis.getProjectSourceReferenceForNode(callee, { sourceFile: context.sourceFile });
  if (reference === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.call",
      "Call expression has neither a provider operation fact nor a project source reference.",
    ));
    return undefined;
  }
  const declarationModule = context.moduleNameByFileName.get(ast.getFileName(reference.sourceFile));
  const declarationName = ast.text(ast.name(reference.declaration) ?? reference.declaration);
  if (declarationModule === undefined || !isValidPythonIdentifier(declarationName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.call",
      "Call target does not resolve to a generated Python module function.",
    ));
    return undefined;
  }
  if (declarationModule !== context.moduleName) {
    collectFromImport(context, `.${declarationModule}`, declarationName);
  }
  return { kind: "call", callee: { kind: "name", name: declarationName }, args };
}

function planNewExpression(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "provider-operation" || fact.operationKind !== "constructor") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.provider.constructor",
      "Constructor expression requires a finalized provider constructor fact.",
    ));
    return undefined;
  }
  const args = planArguments(node, context);
  if (args === undefined) {
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, undefined, args);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.provider.constructor",
      "Provider constructor operation could not be lowered.",
    ));
  }
  return planned;
}

function planPropertyAccess(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact !== undefined && fact.kind === "list-op" && fact.op === "len") {
    const receiverNode = Node_Expression(node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiver === undefined) {
      return undefined;
    }
    return { kind: "call", callee: { kind: "name", name: "len" }, args: [receiver] };
  }
  if (fact === undefined || fact.kind !== "provider-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.provider.property",
      "Property access requires a finalized provider property fact.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, Node_Expression(node), []);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.provider.property",
      "Provider property operation could not be lowered.",
    ));
  }
  return planned;
}

function planElementAccess(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  const argumentNode = ElementAccessExpression_ArgumentExpression(node);
  const index = argumentNode === undefined ? undefined : planExpression(argumentNode, context);
  if (index === undefined) {
    return undefined;
  }
  if (fact !== undefined && fact.kind === "list-op" && fact.op === "index-read") {
    const receiverNode = Node_Expression(node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    return receiver === undefined ? undefined : { kind: "subscript", value: receiver, index };
  }
  if (fact === undefined || fact.kind !== "provider-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.provider.indexer",
      "Element access requires a finalized provider indexer fact.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, Node_Expression(node), [index]);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.provider.indexer",
      "Provider indexer operation could not be lowered.",
    ));
  }
  return planned;
}

export function planArrayLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "array-literal" || fact.lane !== "dense") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.array-literal",
      "Array literals require a finalized Python dense list lane fact.",
    ));
    return undefined;
  }
  const elements: PythonExpression[] = [];
  for (const element of context.input.ast.elements(node)) {
    if (element === undefined) {
      continue;
    }
    const planned = planExpression(element, context);
    if (planned === undefined) {
      return undefined;
    }
    elements.push(planned);
  }
  return { kind: "list", elements };
}
