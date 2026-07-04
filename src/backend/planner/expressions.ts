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
  KindNoSubstitutionTemplateLiteral,
  KindNullKeyword,
  KindNumericLiteral,
  KindOmittedExpression,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindDeleteExpression,
  KindRegularExpressionLiteral,
  KindPropertyAccessExpression,
  KindStringLiteral,
  KindTemplateExpression,
  KindTemplateSpan,
  KindTrueKeyword,
  Node_Expression,
  Node_Initializer,
  Node_SyntaxField,
  PrefixUnaryExpression_Operand,
  unwrapParenthesized,
  BinaryExpression_OperatorToken,
  KindExclamationEqualsEqualsToken,
} from "../../common/source-ast.js";
import { pythonTargetOperationFactKey } from "../../source/python-facts/keys.js";
import type {
  PythonImportBinding,
  PythonCapabilityOperationForm,
  PythonTargetOperationFact,
} from "../../source/python-facts/keys.js";
import {
  isPythonFloatCarrier,
  isPythonIntegerCarrier,
  isPythonNoneCarrier,
  isPythonOptionalCarrier,
} from "../../source/python-target-types.js";
import { isValidPythonIdentifier } from "../../common/python-names.js";
import type { PythonBinaryOperator, PythonExpression, PythonFStringPart, PythonUnaryOperator } from "../python-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import {
  collectFromImport,
  collectHelper,
  collectModuleImport,
  diagnosticInput,
  pythonHelperNames,
  pythonLocalName,
} from "./plan-context.js";
import type { PythonPlanContext } from "./plan-context.js";
import { pythonSourceTypeName } from "./render-types.js";

const pythonBinaryOperators: ReadonlySet<string> = new Set<PythonBinaryOperator>([
  "+", "-", "*", "/", "//", "%", "==", "!=", "<", "<=", ">", ">=", "and", "or", "in", "not in", "is", "is not",
]);

const pythonUnaryOperators: ReadonlySet<string> = new Set<PythonUnaryOperator>(["-", "not"]);

// Operators come from finalized facts, never from source token spelling; a
// fact operator outside the printable set fails closed.
export function asPythonBinaryOperator(operator: string): PythonBinaryOperator | undefined {
  return pythonBinaryOperators.has(operator) ? (operator as PythonBinaryOperator) : undefined;
}

// Lower a finalized operator selection to Python. Truncating integer
// division/remainder (the shared integer contract) differ from Python's
// flooring // and %: they lower to generated module helpers; float remainder
// carries C-style fmod semantics and lowers to math.fmod.
export function planOperatorTokenLowering(
  operator: string,
  resultCarrier: TargetTypeRef | undefined,
  left: PythonExpression,
  right: PythonExpression,
  context: PythonPlanContext,
): PythonExpression | undefined {
  if (operator === "//") {
    if (!isPythonIntegerCarrier(resultCarrier)) {
      return undefined;
    }
    collectHelper(context, "int-div");
    return { kind: "call", callee: { kind: "name", name: pythonHelperNames["int-div"] }, args: [left, right] };
  }
  if (operator === "%") {
    if (isPythonIntegerCarrier(resultCarrier)) {
      collectHelper(context, "int-rem");
      return { kind: "call", callee: { kind: "name", name: pythonHelperNames["int-rem"] }, args: [left, right] };
    }
    if (isPythonFloatCarrier(resultCarrier)) {
      collectModuleImport(context, "math");
      return {
        kind: "call",
        callee: { kind: "attribute", value: { kind: "name", name: "math" }, name: "fmod" },
        args: [left, right],
      };
    }
    return undefined;
  }
  const printable = asPythonBinaryOperator(operator);
  return printable === undefined ? undefined : { kind: "binary", operator: printable, left, right };
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
    case KindNullKeyword: {
      return planNullLiteral(node, context);
    }
    case KindTemplateExpression:
    case KindNoSubstitutionTemplateLiteral: {
      return planTemplateLiteral(node, context);
    }
    case KindIdentifier: {
      return planIdentifier(node, context);
    }
    case "KindThisExpression":
    case "KindThisKeyword": {
      if (context.selfName === undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "python.backend.class",
          "'this' is only supported inside class instance members.",
        ));
        return undefined;
      }
      return { kind: "name", name: context.selfName };
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(node);
      return inner === undefined ? undefined : planExpression(inner, context);
    }
    case KindArrayLiteralExpression: {
      return planArrayLiteral(node, context);
    }
    case KindOmittedExpression: {
      return planOmittedElement(node, context);
    }
    case KindRegularExpressionLiteral: {
      return planRegularExpressionLiteral(node, context);
    }
    case KindDeleteExpression: {
      return planDeleteExpression(node, context);
    }
    case "KindObjectLiteralExpression": {
      return planRecordLiteral(node, context);
    }
    case "KindAwaitExpression": {
      return planAwaitExpression(node, context);
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

// `null` lowers to None only when the optional lane proved a carrier for it
// (a None carrier, or an Optional carrier at an optional-typed position).
function planNullLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const carrier = expressionCarrier(node, context);
  if (!isPythonNoneCarrier(carrier) && !isPythonOptionalCarrier(carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.literal-carrier",
      "Null literal has no finalized Python None carrier fact.",
    ));
    return undefined;
  }
  return { kind: "none-literal" };
}

// The printer fails closed on f-string fields whose rendered text contains
// quotes, backslashes, newlines, or braces. Those characters can only come
// from nested string-literal, f-string, or dict nodes: every other node kind
// renders from validated identifiers, operator tokens, and numeric text.
// This structural check keeps the printer throw unreachable from user input.
function isPrintableFStringField(expression: PythonExpression): boolean {
  switch (expression.kind) {
    case "string-literal":
    case "f-string":
    case "dict": {
      return false;
    }
    case "attribute": {
      return isPrintableFStringField(expression.value);
    }
    case "call": {
      return isPrintableFStringField(expression.callee) && expression.args.every(isPrintableFStringField);
    }
    case "call-kwargs": {
      return isPrintableFStringField(expression.callee) &&
        expression.args.every(isPrintableFStringField) &&
        expression.kwargs.every((entry) => isPrintableFStringField(entry.value));
    }
    case "binary": {
      return isPrintableFStringField(expression.left) && isPrintableFStringField(expression.right);
    }
    case "unary": {
      return isPrintableFStringField(expression.operand);
    }
    case "subscript": {
      return isPrintableFStringField(expression.value) && isPrintableFStringField(expression.index);
    }
    case "list":
    case "tuple": {
      return expression.elements.every(isPrintableFStringField);
    }
    case "await": {
      return isPrintableFStringField(expression.operand);
    }
    default: {
      return true;
    }
  }
}

// Template literals lower against the finalized string-template fact.
// No-substitution templates are plain string literals; substituting templates
// build f-string parts from the cooked head/middle/tail text fields and the
// planned substitution expressions. Proven string-literal substitutions
// inline as literal text, avoiding the printer's fail-closed field rules.
function planTemplateLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const { ast } = context.input;
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "string-template") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.template",
      "Template literals require a finalized string-template fact.",
    ));
    return undefined;
  }
  if (ast.kindName(node) === KindNoSubstitutionTemplateLiteral) {
    return { kind: "string-literal", value: ast.text(node) };
  }
  const headNode = Node_SyntaxField(node, "Head");
  if (headNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.template",
      "Template expression is missing its head literal.",
    ));
    return undefined;
  }
  const parts: PythonFStringPart[] = [];
  const pushText = (text: string): void => {
    if (text.length > 0) {
      parts.push({ kind: "text", text });
    }
  };
  pushText(ast.text(headNode));
  const spans: Node[] = [];
  ast.forEachChild(node, (child) => {
    if (child !== undefined && ast.kindName(child) === KindTemplateSpan) {
      spans.push(child);
    }
  });
  let failed = false;
  for (const span of spans) {
    const expressionNode = Node_Expression(span);
    const literalNode = Node_SyntaxField(span, "Literal");
    if (expressionNode === undefined || literalNode === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, span),
        "python.backend.template",
        "Template span is missing its expression or literal part.",
      ));
      failed = true;
      continue;
    }
    const planned = planExpression(expressionNode, context);
    if (planned === undefined) {
      failed = true;
    } else if (planned.kind === "string-literal") {
      pushText(planned.value);
    } else if (isPrintableFStringField(planned)) {
      parts.push({ kind: "field", expression: planned });
    } else {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, expressionNode),
        "python.backend.template",
        "Template substitution renders text that cannot appear inside an f-string field.",
      ));
      failed = true;
    }
    pushText(ast.text(literalNode));
  }
  if (failed) {
    return undefined;
  }
  if (parts.every((part) => part.kind === "text")) {
    return { kind: "string-literal", value: parts.map((part) => (part.kind === "text" ? part.text : "")).join("") };
  }
  return { kind: "f-string", parts };
}

function planIdentifier(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const { ast } = context.input;
  // Identifiers bound to provider operations render from row metadata; a
  // provider-backed identifier must never fall through to a bare name.
  const fact = pythonOperationFact(node, context);
  if (fact !== undefined && fact.kind === "capability-operation") {
    if (fact.target.form === "static-attribute") {
      return { kind: "attribute", value: importBindingExpression(context, fact.target.import), name: fact.target.name };
    }
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.identifier",
      "Provider-bound identifier selected a non-attribute Python operation.",
    ));
    return undefined;
  }
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
  // Capability-operation facts take precedence over the operator-token path:
  // the row's import binding decides the lowering. Only a free call over the
  // operand is sound here — fn(operand) — and only for prefix operators;
  // every other target form has no proven receiver and fails closed.
  if (fact !== undefined && fact.kind === "capability-operation") {
    if (fact.target.form !== "call" || context.input.ast.kindName(node) !== KindPrefixUnaryExpression) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.capability.operator",
        "Unary capability operations lower only from prefix operators with call-form targets.",
      ));
      return undefined;
    }
    const operandNode = PrefixUnaryExpression_Operand(node);
    const operand = operandNode === undefined ? undefined : planExpression(operandNode, context);
    return operand === undefined
      ? undefined
      : { kind: "call", callee: importBindingExpression(context, fact.target.import), args: [operand] };
  }
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
  // Capability-operation facts run before the operator-token path: the row's
  // import binding lowers the whole expression to fn(left, right). Only the
  // call form is sound on a binary node (neither operand is a proven
  // receiver), so every other target form fails closed.
  if (fact.kind === "capability-operation") {
    if (fact.target.form !== "call") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.capability.operator",
        "Binary capability operations lower only through call-form targets.",
      ));
      return undefined;
    }
    const call: PythonExpression = {
      kind: "call",
      callee: importBindingExpression(context, fact.target.import),
      args: [left, right],
    };
    // Strict inequality reuses the equality row; the negation is structural.
    const operatorToken = BinaryExpression_OperatorToken(node);
    const negated = operatorToken !== undefined &&
      context.input.ast.kindName(operatorToken) === KindExclamationEqualsEqualsToken;
    return negated ? { kind: "unary", operator: "not", operand: call } : call;
  }
  if (fact.kind === "string-concat") {
    return { kind: "binary", operator: "+", left, right };
  }
  if (fact.kind === "operator-token") {
    const lowered = planOperatorTokenLowering(fact.operator, fact.resultCarrier, left, right, context);
    if (lowered === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.operator",
        `Binary operator '${fact.operator}' is not a supported Python operator.`,
      ));
      return undefined;
    }
    return lowered;
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "python.backend.operator",
    "Binary expression selected a non-operator Python operation.",
  ));
  return undefined;
}

export function planArguments(node: Node, context: PythonPlanContext): readonly PythonExpression[] | undefined {
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
export function importBindingExpression(context: PythonPlanContext, binding: PythonImportBinding): PythonExpression {
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
  form: PythonCapabilityOperationForm,
  receiverNode: Node | undefined,
  args: readonly PythonExpression[],
  literalArguments: readonly string[] = [],
): PythonExpression | undefined {
  // Fact-proven string literals (dynamic property names) insert immediately
  // after the planned receiver.
  const literalExpressions: readonly PythonExpression[] =
    literalArguments.map((value) => ({ kind: "string-literal", value }));
  switch (form.form) {
    case "call": {
      // Rows marked receiverArgument pass the planned receiver as the first
      // call argument ahead of the source arguments (JS-surface free helpers
      // over native receivers). Such a row without a receiver site is
      // unsatisfiable and fails closed.
      if (form.receiverArgument === true) {
        const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
        if (receiver === undefined) {
          return undefined;
        }
        return {
          kind: "call",
          callee: importBindingExpression(context, form.import),
          args: [receiver, ...literalExpressions, ...args],
        };
      }
      return literalExpressions.length === 0
        ? { kind: "call", callee: importBindingExpression(context, form.import), args }
        : undefined;
    }
    case "constructor": {
      return { kind: "call", callee: importBindingExpression(context, form.import), args };
    }
    case "method": {
      // Rows marked argumentReceiver anchor the runtime subject on the first
      // planned source argument and pass the planned source receiver as the
      // first runtime argument: text.replace(re, r) lowers re.replace(text, r).
      if (form.argumentReceiver === true) {
        const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
        const anchor = args[0];
        if (receiver === undefined || anchor === undefined) {
          return undefined;
        }
        return {
          kind: "call",
          callee: { kind: "attribute", value: anchor, name: form.name },
          args: [receiver, ...args.slice(1)],
        };
      }
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
    case "static-method": {
      return {
        kind: "call",
        callee: { kind: "attribute", value: importBindingExpression(context, form.import), name: form.name },
        args,
      };
    }
    case "index": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      const index = args[0];
      if (receiver === undefined || index === undefined || args.length !== 1) {
        return undefined;
      }
      return { kind: "subscript", value: receiver, index };
    }
    case "builtin-call": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiver === undefined || args.length !== 0) {
        return undefined;
      }
      return { kind: "call", callee: { kind: "name", name: form.name }, args: [receiver] };
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
  // Defensive fact-subject handling: list operations are recorded on the
  // call expression; if the semantics pass recorded one on the callee
  // property access instead, adopt it (list-op facts only).
  const nodeFact = pythonOperationFact(node, context);
  const calleeFact = nodeFact !== undefined || callee === undefined ? undefined : pythonOperationFact(callee, context);
  const fact = nodeFact ?? (calleeFact?.kind === "list-op" ? calleeFact : undefined);
  if (fact !== undefined && fact.kind === "list-op") {
    if (receiverNode === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.list-op",
        "List operation in call position requires a property-access receiver.",
      ));
      return undefined;
    }
    if (fact.op === "append") {
      const receiver = planExpression(receiverNode, context);
      if (receiver === undefined) {
        return undefined;
      }
      return { kind: "call", callee: { kind: "attribute", value: receiver, name: "append" }, args };
    }
    if (fact.op === "includes" || fact.op === "index-of") {
      const value = args[0];
      if (value === undefined || args.length !== 1) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "python.backend.list-op",
          "List search operations require exactly one argument.",
        ));
        return undefined;
      }
      const receiver = planExpression(receiverNode, context);
      if (receiver === undefined) {
        return undefined;
      }
      if (fact.op === "includes") {
        return { kind: "binary", operator: "in", left: value, right: receiver };
      }
      // JS first-match-or-minus-one semantics live in the generated helper;
      // Python's list.index raises on a missing element.
      collectHelper(context, "index-of");
      return { kind: "call", callee: { kind: "name", name: pythonHelperNames["index-of"] }, args: [receiver, value] };
    }
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.list-op",
      "List operation is not supported in call position.",
    ));
    return undefined;
  }
  if (fact !== undefined && fact.kind === "capability-operation") {
    const planned = planProviderOperationExpression(context, fact.target, receiverNode, args, fact.literalArguments ?? []);
    if (planned === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.capability.call",
        "Provider call operation could not be lowered.",
      ));
    }
    return planned;
  }
  if (fact !== undefined && fact.kind === "source-method") {
    if (receiverNode === undefined || !isValidPythonIdentifier(fact.name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.class",
        "Instance method call could not be lowered from its source-method fact.",
      ));
      return undefined;
    }
    const receiver = planExpression(receiverNode, context);
    if (receiver === undefined) {
      return undefined;
    }
    return { kind: "call", callee: { kind: "attribute", value: receiver, name: fact.name }, args };
  }
  if (fact !== undefined && fact.kind === "source-static-method") {
    const className = pythonSourceTypeName(fact.typeCarrier, context);
    if (className === undefined || !isValidPythonIdentifier(fact.name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.class",
        "Static method call does not resolve to a generated Python class.",
      ));
      return undefined;
    }
    return {
      kind: "call",
      callee: { kind: "attribute", value: { kind: "name", name: className }, name: fact.name },
      args,
    };
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
  // Calls to async declarations produce coroutine objects; they lower only as
  // the operand of a proven await expression.
  if (ast.hasModifierKind(reference.declaration, "async") && context.awaitedCalls?.has(node) !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.async",
      "Calls to async functions are only supported as await operands.",
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
  if (fact !== undefined && fact.kind === "source-constructor") {
    const className = pythonSourceTypeName(fact.resultCarrier, context);
    if (className === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.class",
        "Constructor does not resolve to a generated Python class.",
      ));
      return undefined;
    }
    const args = planArguments(node, context);
    return args === undefined ? undefined : { kind: "call", callee: { kind: "name", name: className }, args };
  }
  if (fact === undefined || fact.kind !== "capability-operation" || fact.operationKind !== "constructor") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.capability.constructor",
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
      "python.capability.constructor",
      "Provider constructor operation could not be lowered.",
    ));
  }
  return planned;
}

function planPropertyAccess(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-field") {
    if (!isValidPythonIdentifier(fact.name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.class",
        `Field '${fact.name}' is not a valid Python attribute name.`,
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    return receiver === undefined ? undefined : { kind: "attribute", value: receiver, name: fact.name };
  }
  if (fact !== undefined && fact.kind === "source-enum-member") {
    const enumName = pythonSourceTypeName(fact.resultCarrier, context);
    if (enumName === undefined || !isValidPythonIdentifier(fact.name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.enum",
        "Enum member access does not resolve to a generated Python enum class.",
      ));
      return undefined;
    }
    return { kind: "attribute", value: { kind: "name", name: enumName }, name: fact.name };
  }
  if (fact !== undefined && fact.kind === "list-op" && fact.op === "len") {
    const receiverNode = Node_Expression(node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiver === undefined) {
      return undefined;
    }
    return { kind: "call", callee: { kind: "name", name: "len" }, args: [receiver] };
  }
  if (fact === undefined || fact.kind !== "capability-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.capability.property",
      "Property access requires a finalized provider property fact.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, Node_Expression(node), [], fact.literalArguments ?? []);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.capability.property",
      "Provider property operation could not be lowered.",
    ));
  }
  return planned;
}

function planElementAccess(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  // Tuple element reads take the index from the finalized fact (a proven
  // numeric literal), never from re-planning the source index expression.
  if (fact !== undefined && fact.kind === "tuple-index") {
    if (!Number.isInteger(fact.index) || fact.index < 0) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.tuple",
        "Tuple element access requires a non-negative literal index.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    return receiver === undefined
      ? undefined
      : { kind: "subscript", value: receiver, index: { kind: "int-literal", text: String(fact.index) } };
  }
  const argumentNode = ElementAccessExpression_ArgumentExpression(node);
  const index = argumentNode === undefined ? undefined : planExpression(argumentNode, context);
  if (index === undefined) {
    return undefined;
  }
  if (fact !== undefined &&
    ((fact.kind === "list-op" && fact.op === "index-read") || (fact.kind === "dict-op" && fact.op === "index-read"))) {
    const receiverNode = Node_Expression(node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    return receiver === undefined ? undefined : { kind: "subscript", value: receiver, index };
  }
  if (fact === undefined || fact.kind !== "capability-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.capability.indexer",
      "Element access requires a finalized provider indexer fact.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, Node_Expression(node), [index], fact.literalArguments ?? []);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.capability.indexer",
      "Provider indexer operation could not be lowered.",
    ));
  }
  return planned;
}

// Array holes have no lowering of their own spelling: an omitted element is
// representable only through its own finalized capability-operation fact
// (typically a static-attribute import naming the sparse-hole sentinel). The
// fact's target form decides the lowering; receiver-shaped forms have no
// receiver here and fail closed.
function planOmittedElement(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "capability-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.capability.array-hole",
      "Omitted array elements require a finalized provider operation fact.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, undefined, []);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.capability.array-hole",
      "Provider operation for an omitted array element could not be lowered.",
    ));
  }
  return planned;
}

// Structural validation for fact values read through the untyped fact-entry
// scan below. Values must be plain data shaped exactly like the declared
// import binding contract; anything else is not a usable binding.
function isImportBindingValue(value: unknown): value is PythonImportBinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const binding = value as { readonly style?: unknown; readonly module?: unknown; readonly name?: unknown };
  if (binding.style === "from") {
    return typeof binding.module === "string" && typeof binding.name === "string";
  }
  if (binding.style === "module") {
    return typeof binding.module === "string" && (binding.name === undefined || typeof binding.name === "string");
  }
  return false;
}

// Delete expressions lower through the capability fact recorded on the
// delete node: a receiver-argument call receiving the planned target and the
// planned (or fact-proven literal) key.
function planDeleteExpression(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "capability-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.capability.delete",
      "Delete expressions require a finalized runtime delete fact.",
    ));
    return undefined;
  }
  const operand = unwrapParenthesized(context.input.ast, Node_Expression(node));
  if (operand === undefined || context.input.ast.kindName(operand) !== KindElementAccessExpression) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.capability.delete",
      "Delete lowers only over element accesses on runtime carriers.",
    ));
    return undefined;
  }
  const keyNode = ElementAccessExpression_ArgumentExpression(operand);
  const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
  if (key === undefined) {
    return undefined;
  }
  return planProviderOperationExpression(context, fact.target, Node_Expression(operand), [key], fact.literalArguments ?? []);
}

// Regex literals lower through a finalized constructor row; the pattern and
// flags are the literal's own data (like string literal text), split at the
// closing solidus. Dynamic patterns have no literal proof and record no fact.
function planRegularExpressionLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "capability-operation" ||
    (fact.target.form !== "constructor" && fact.target.form !== "call")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.capability.regexp",
      "Regular expression literals require a finalized runtime constructor fact.",
    ));
    return undefined;
  }
  const text = context.input.ast.text(node);
  const closingSolidus = text.lastIndexOf("/");
  if (!text.startsWith("/") || closingSolidus <= 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.capability.regexp",
      "Regular expression literal text is not in /pattern/flags form.",
    ));
    return undefined;
  }
  const pattern = text.slice(1, closingSolidus);
  const flags = text.slice(closingSolidus + 1);
  return {
    kind: "call",
    callee: importBindingExpression(context, fact.target.import),
    args: [
      { kind: "string-literal", value: pattern },
      { kind: "string-literal", value: flags },
    ],
  };
}

// Sparse array literals lower through a companion capability-operation fact
// recorded on the same literal node. The companion cannot share the primary
// operation fact key (that slot holds the sparse-lane array-literal fact), so
// it is located structurally across the node's fact entries: any value shaped
// like a capability operation with a call or constructor import target
// qualifies. Nothing here reads source spelling.
function companionCapabilityCallTarget(
  node: Node,
  context: PythonPlanContext,
): { readonly form: "call" | "constructor"; readonly import: PythonImportBinding } | undefined {
  for (const entry of context.input.facts.getFacts(node)) {
    const value = entry.value;
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const candidate = value as { readonly kind?: unknown; readonly target?: unknown };
    if (candidate.kind !== "capability-operation" || typeof candidate.target !== "object" || candidate.target === null) {
      continue;
    }
    const target = candidate.target as { readonly form?: unknown; readonly import?: unknown; readonly receiverArgument?: unknown };
    const form = target.form === "call" || target.form === "constructor" ? target.form : undefined;
    // A literal site has no receiver, so receiver-argument call rows are
    // unsatisfiable here.
    if (form === undefined || target.receiverArgument === true || !isImportBindingValue(target.import)) {
      continue;
    }
    return { form, import: target.import };
  }
  return undefined;
}

export function planArrayLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  const isTupleLiteral = fact !== undefined && fact.kind === "tuple-literal";
  // Defensive fact-subject handling mirror: a sparse literal may carry the
  // capability-operation fact directly in the primary slot instead of a
  // sparse-lane array-literal fact plus companion.
  const directCapabilityTarget = fact !== undefined && fact.kind === "capability-operation" &&
    (fact.target.form === "constructor" ||
      (fact.target.form === "call" && fact.target.receiverArgument !== true))
    ? fact.target
    : undefined;
  const isSparse = (fact !== undefined && fact.kind === "array-literal" && fact.lane === "sparse") ||
    directCapabilityTarget !== undefined;
  if (!isTupleLiteral && !isSparse && (fact === undefined || fact.kind !== "array-literal" || fact.lane !== "dense")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.array-literal",
      "Array literals require a finalized Python dense list or tuple lane fact.",
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
  if (isSparse) {
    // A sparse-lane literal lowers to the companion provider call with the
    // planned elements as arguments in source order (holes lower through
    // their own omitted-element facts). No companion fact means the sparse
    // lane has no owner and the literal fails closed.
    const target = directCapabilityTarget ?? companionCapabilityCallTarget(node, context);
    if (target === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "python.capability.array-literal",
        "Sparse array literals require a companion provider call or constructor fact.",
      ));
      return undefined;
    }
    // The runtime builder takes one iterable of element values, not
    // positional element arguments.
    return {
      kind: "call",
      callee: importBindingExpression(context, target.import),
      args: [{ kind: "list", elements }],
    };
  }
  // The printer has no lowering for an empty tuple display; a zero-element
  // tuple literal has no owning lane and fails closed here.
  if (isTupleLiteral && elements.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.tuple",
      "Tuple literals require at least one element.",
    ));
    return undefined;
  }
  return isTupleLiteral ? { kind: "tuple", elements } : { kind: "list", elements };
}

// Object literals lower to keyword-argument construction of the generated
// record class; field order comes from the finalized shape fact, and every
// declared field must appear exactly once.
function planRecordLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact !== undefined && fact.kind === "dict-literal") {
    return planDictLiteral(node, context);
  }
  if (fact === undefined || fact.kind !== "record-literal") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.record",
      "Object literals require a finalized record shape fact.",
    ));
    return undefined;
  }
  const className = pythonSourceTypeName(fact.resultCarrier, context);
  if (className === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.record",
      "Object literal shape does not resolve to a generated Python record class.",
    ));
    return undefined;
  }
  const { ast } = context.input;
  const values = new Map<string, PythonExpression>();
  for (const property of ast.properties(node)) {
    if (property === undefined) {
      continue;
    }
    const nameNode = ast.name(property);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    const valueNode = ast.kindName(property) === "KindShorthandPropertyAssignment"
      ? nameNode
      : Node_Initializer(property);
    if (!isValidPythonIdentifier(fieldName) || valueNode === undefined || values.has(fieldName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, property),
        "python.backend.record",
        "Object literals support only uniquely named field assignments.",
      ));
      return undefined;
    }
    const planned = planExpression(valueNode, context);
    if (planned === undefined) {
      return undefined;
    }
    values.set(fieldName, planned);
  }
  const kwargs: { readonly name: string; readonly value: PythonExpression }[] = [];
  for (const fieldName of fact.fieldNames) {
    const value = values.get(fieldName);
    if (value === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.record",
        `Object literal does not initialize record field '${fieldName}'.`,
      ));
      return undefined;
    }
    kwargs.push({ name: fieldName, value });
  }
  if (values.size !== fact.fieldNames.length) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.record",
      "Object literal fields do not match the finalized record shape.",
    ));
    return undefined;
  }
  return { kind: "call-kwargs", callee: { kind: "name", name: className }, args: [], kwargs };
}

// Object literals with a proven Record<string, T> carrier lower to a dict
// display: keys are string literals in source property order (identifier and
// string-literal property names only; keys never guess from computed text).
function planDictLiteral(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const { ast } = context.input;
  const entries: { readonly key: PythonExpression; readonly value: PythonExpression }[] = [];
  const seenKeys = new Set<string>();
  for (const property of ast.properties(node)) {
    if (property === undefined) {
      continue;
    }
    const propertyKind = ast.kindName(property);
    const nameNode = ast.name(property);
    const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
    const valueNode = propertyKind === "KindShorthandPropertyAssignment" ? nameNode : Node_Initializer(property);
    if (nameNode === undefined || valueNode === undefined ||
      (nameKind !== KindIdentifier && nameKind !== KindStringLiteral)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, property),
        "python.backend.dict",
        "Dict literals support only identifier or string-literal keys with value assignments.",
      ));
      return undefined;
    }
    const key = ast.text(nameNode);
    if (seenKeys.has(key)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, property),
        "python.backend.dict",
        "Dict literals require uniquely named keys.",
      ));
      return undefined;
    }
    seenKeys.add(key);
    const value = planExpression(valueNode, context);
    if (value === undefined) {
      return undefined;
    }
    entries.push({ key: { kind: "string-literal", value: key }, value });
  }
  return { kind: "dict", entries };
}

function planAwaitExpression(node: Node, context: PythonPlanContext): PythonExpression | undefined {
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "await-op") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.async",
      "Await expressions require a finalized await lowering fact.",
    ));
    return undefined;
  }
  if (context.insideAsync !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.async",
      "Await expressions are only supported inside async functions.",
    ));
    return undefined;
  }
  const operandNode = Node_Expression(node);
  const awaitedCall = unwrapParenthesized(context.input.ast, operandNode);
  if (awaitedCall !== undefined) {
    context.awaitedCalls?.add(awaitedCall);
  }
  const operand = operandNode === undefined ? undefined : planExpression(operandNode, context);
  return operand === undefined ? undefined : { kind: "await", operand };
}
