import type { Node, TargetTypeRef } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  ElementAccessExpression_ArgumentExpression,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  KindAsteriskEqualsToken,
  KindBinaryExpression,
  KindBlock,
  KindCallExpression,
  KindElementAccessExpression,
  KindEqualsToken,
  KindExpressionStatement,
  KindForOfStatement,
  KindForStatement,
  KindIdentifier,
  KindIfStatement,
  KindMinusEqualsToken,
  KindNewExpression,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindReturnStatement,
  KindSlashEqualsToken,
  KindVariableDeclaration,
  KindVariableStatement,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  PrefixUnaryExpression_Operand,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  hasSpreadToken,
} from "../../common/source-ast.js";
import type { PythonTargetOperationFact } from "../../source/python-facts/keys.js";
import { isPythonBoolCarrier, isPythonListCarrier } from "../../source/python-target-types.js";
import { isValidPythonIdentifier } from "../../common/python-names.js";
import type { PythonExceptHandler, PythonExpression, PythonStatement, PythonTypeAnnotation } from "../python-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import {
  expressionCarrier,
  importBindingExpression,
  planArguments,
  planExpression,
  planOperatorTokenLowering,
  pythonOperationFact,
} from "./expressions.js";
import { diagnosticInput, pythonLocalName } from "./plan-context.js";
import type { PythonPlanContext } from "./plan-context.js";
import { pythonTypeFromCarrierInContext } from "./render-types.js";

export function planStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindVariableStatement: {
      return planVariableStatement(node, context);
    }
    case KindReturnStatement: {
      const expression = Node_Expression(node);
      if (expression === undefined) {
        return [{ kind: "return" }];
      }
      const planned = planExpression(expression, context);
      return planned === undefined ? undefined : [{ kind: "return", expression: planned }];
    }
    case KindExpressionStatement: {
      return planExpressionStatement(node, context);
    }
    case KindIfStatement: {
      return planIfStatement(node, context);
    }
    case KindWhileStatement: {
      return planWhileStatement(node, context);
    }
    case KindForOfStatement: {
      return planForOfStatement(node, context);
    }
    case KindForStatement: {
      return planForStatement(node, context);
    }
    case "KindThrowStatement": {
      return planThrowStatement(node, context);
    }
    case "KindTryStatement": {
      return planTryStatement(node, context);
    }
    default: {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.statement",
        "The Python target does not support this statement.",
      ));
      return undefined;
    }
  }
}

export function planBlockLike(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const statements: PythonStatement[] = [];
  const children = ast.kindName(node) === KindBlock ? ast.statements(node) : [node];
  let failed = false;
  for (const child of children) {
    if (child === undefined) {
      continue;
    }
    const planned = planStatement(child, context);
    if (planned === undefined) {
      failed = true;
      continue;
    }
    statements.push(...planned);
  }
  return failed ? undefined : statements;
}

// The printer rejects empty blocks; suite bodies pad with `pass`.
function paddedBody(statements: readonly PythonStatement[]): readonly PythonStatement[] {
  return statements.length === 0 ? [{ kind: "pass" }] : statements;
}

function planEmbeddedBlock(node: Node | undefined, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  if (node === undefined) {
    return [];
  }
  return planBlockLike(node, context);
}

function collectVariableDeclarations(node: Node, context: PythonPlanContext): readonly Node[] {
  const { ast } = context.input;
  const declarations: Node[] = [];
  const visit = (candidate: Node): void => {
    if (ast.kindName(candidate) === KindVariableDeclaration) {
      declarations.push(candidate);
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(node);
  return declarations;
}

// Adds a binding to the enclosing function scope. Python function scope is
// flat, so any duplicate emitted name (including a reserved-name mangling
// collision) fails closed.
function declareLocalBinding(
  node: Node,
  sourceName: string,
  context: PythonPlanContext,
): string | undefined {
  const name = pythonLocalName(sourceName);
  if (name === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.variable",
      "Variable declarations require a plain identifier that is valid in Python.",
    ));
    return undefined;
  }
  if (context.localNames !== undefined) {
    if (context.localNames.has(name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "python.backend.naming",
        `Binding '${sourceName}' collides with another binding in the enclosing function scope.`,
      ));
      return undefined;
    }
    context.localNames.add(name);
  }
  return name;
}

export function planVariableStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const declarations = collectVariableDeclarations(node, context);
  if (declarations.length !== 1) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.variable",
      "Variable statements must declare exactly one binding.",
    ));
    return undefined;
  }
  const declaration = declarations[0];
  if (declaration === undefined) {
    return undefined;
  }
  const nameNode = Node_Name(declaration);
  const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
  if (nameNode !== undefined && (nameKind === "KindObjectBindingPattern" || nameKind === "KindArrayBindingPattern")) {
    return planDestructuringDeclaration(declaration, nameNode, nameKind, context);
  }
  const sourceName = nameNode !== undefined && nameKind === KindIdentifier ? ast.text(nameNode) : "";
  const initializer = Node_Initializer(declaration);
  if (initializer === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "python.backend.variable",
      "Variable declarations require an initializer.",
    ));
    return undefined;
  }
  const value = planExpression(initializer, context);
  if (value === undefined) {
    return undefined;
  }
  const typeNode = Node_Type(declaration);
  let annotation: PythonTypeAnnotation | undefined;
  if (typeNode !== undefined) {
    annotation = pythonTypeFromCarrierInContext(context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier, context);
    if (annotation === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, typeNode),
        "python.backend.variable",
        "Variable type annotation has no supported Python carrier fact.",
      ));
      return undefined;
    }
  }
  const name = declareLocalBinding(declaration, sourceName, context);
  if (name === undefined) {
    return undefined;
  }
  return [{
    kind: "assign",
    targetName: name,
    ...(annotation === undefined ? {} : { annotation }),
    value,
  }];
}

function planUpdateStatement(expression: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const fact = pythonOperationFact(expression, context);
  if (fact === undefined || fact.kind !== "operator-token" || (fact.operator !== "+=" && fact.operator !== "-=")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.operator",
      "Increment/decrement requires a finalized Python update-operator fact.",
    ));
    return undefined;
  }
  const operand = PrefixUnaryExpression_Operand(expression);
  if (operand === undefined || ast.kindName(operand) !== KindIdentifier) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.operator",
      "Increment/decrement targets must be identifiers.",
    ));
    return undefined;
  }
  const target = pythonLocalName(ast.text(operand));
  if (target === undefined) {
    return undefined;
  }
  const operator = fact.operator === "+=" ? "+" : "-";
  return [{
    kind: "assign",
    targetName: target,
    value: {
      kind: "binary",
      operator,
      left: { kind: "name", name: target },
      right: { kind: "int-literal", text: "1" },
    },
  }];
}

function planElementWriteStatement(
  expression: Node,
  left: Node,
  right: Node,
  context: PythonPlanContext,
): readonly PythonStatement[] | undefined {
  const fact = pythonOperationFact(expression, context) ?? pythonOperationFact(left, context);
  const isIndexWrite = fact !== undefined &&
    ((fact.kind === "list-op" && fact.op === "index-write") || (fact.kind === "dict-op" && fact.op === "index-write"));
  const capabilityWrite = fact !== undefined && fact.kind === "capability-operation" ? fact : undefined;
  if (!isIndexWrite && capabilityWrite === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.assignment",
      "Element assignments require a finalized index-write or capability write fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(left);
  const indexNode = ElementAccessExpression_ArgumentExpression(left);
  const target = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const index = indexNode === undefined ? undefined : planExpression(indexNode, context);
  const value = planExpression(right, context);
  if (target === undefined || index === undefined || value === undefined) {
    return undefined;
  }
  if (capabilityWrite !== undefined) {
    // Element writes through capability rows: method-form calls the write
    // method on the receiver; receiver-argument call rows pass the receiver
    // first, then fact-proven literals, then index and value.
    const literalExpressions: readonly PythonExpression[] =
      (capabilityWrite.literalArguments ?? []).map((literal) => ({ kind: "string-literal", value: literal }));
    if (capabilityWrite.target.form === "method" && capabilityWrite.target.argumentReceiver !== true) {
      return [{
        kind: "expr",
        expression: {
          kind: "call",
          callee: { kind: "attribute", value: target, name: capabilityWrite.target.name },
          args: [index, value],
        },
      }];
    }
    if (capabilityWrite.target.form === "call" && capabilityWrite.target.receiverArgument === true) {
      return [{
        kind: "expr",
        expression: {
          kind: "call",
          callee: importBindingExpression(context, capabilityWrite.target.import),
          args: [target, ...literalExpressions, index, value],
        },
      }];
    }
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "python.capability.element-write",
      "Element writes lower only through method or receiver-argument call rows.",
    ));
    return undefined;
  }
  return [{ kind: "subscript-assign", target, index, value }];
}

const compoundAssignmentTokens: readonly string[] = [
  KindPlusEqualsToken,
  KindMinusEqualsToken,
  KindAsteriskEqualsToken,
  KindSlashEqualsToken,
  KindPercentEqualsToken,
];

function planAssignmentStatement(expression: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const operatorToken = BinaryExpression_OperatorToken(expression);
  const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
  if (operatorKind !== KindEqualsToken && !compoundAssignmentTokens.includes(operatorKind)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.assignment",
      "Only plain and compound assignments are supported in this position.",
    ));
    return undefined;
  }
  const left = BinaryExpression_Left(expression);
  const right = BinaryExpression_Right(expression);
  if (left !== undefined && right !== undefined &&
    ast.kindName(left) === KindElementAccessExpression && operatorKind === KindEqualsToken) {
    return planElementWriteStatement(expression, left, right, context);
  }
  if (left !== undefined && right !== undefined &&
    ast.kindName(left) === KindPropertyAccessExpression && operatorKind === KindEqualsToken) {
    return planAttributeWriteStatement(expression, left, right, context);
  }
  if (left === undefined || right === undefined || ast.kindName(left) !== KindIdentifier) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.assignment",
      "Assignments must target a plain identifier.",
    ));
    return undefined;
  }
  const target = pythonLocalName(ast.text(left));
  if (target === undefined) {
    return undefined;
  }
  const value = planExpression(right, context);
  if (value === undefined) {
    return undefined;
  }
  if (operatorKind === KindEqualsToken) {
    return [{ kind: "assign", targetName: target, value }];
  }
  // The output model has no augmented assignment; compound assignments
  // lower via the finalized operator fact to `x = x <op> rhs`.
  const fact = pythonOperationFact(expression, context);
  if (fact === undefined || fact.kind !== "operator-token" || !fact.operator.endsWith("=")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.operator",
      "Compound assignment requires a finalized Python operator fact.",
    ));
    return undefined;
  }
  const lowered = planOperatorTokenLowering(
    fact.operator.slice(0, -1),
    fact.resultCarrier,
    { kind: "name", name: target },
    value,
    context,
  );
  if (lowered === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.operator",
      `Compound operator '${fact.operator}' is not a supported Python operator.`,
    ));
    return undefined;
  }
  return [{ kind: "assign", targetName: target, value: lowered }];
}

// Assignment to a property access target: proven project-source fields lower
// to attribute assignment; capability rows lower through their recorded
// target form; anything else has no owning lane.
function planAttributeWriteStatement(
  expression: Node,
  left: Node,
  right: Node,
  context: PythonPlanContext,
): readonly PythonStatement[] | undefined {
  // Property writes through capability rows: the fact is checked on the
  // assignment expression first, then on the property-access target
  // (mirroring the element-write fact-subject pattern).
  const expressionFact = pythonOperationFact(expression, context);
  const leftFact = pythonOperationFact(left, context);
  const capabilityFact = expressionFact !== undefined && expressionFact.kind === "capability-operation"
    ? expressionFact
    : leftFact !== undefined && leftFact.kind === "capability-operation"
      ? leftFact
      : undefined;
  if (capabilityFact !== undefined) {
    return planCapabilityAttributeWrite(expression, left, right, capabilityFact, context);
  }
  const fact = leftFact;
  if (fact === undefined || fact.kind !== "source-field" || !isValidPythonIdentifier(fact.name)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.assignment",
      "Property assignments require a finalized source-field fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(left);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const value = planExpression(right, context);
  if (receiver === undefined || value === undefined) {
    return undefined;
  }
  return [{ kind: "attribute-assign", target: receiver, name: fact.name, value }];
}

// Property writes through capability rows lower as method-kind operations
// with the assigned value as the trailing argument. The fact's target form
// decides the shape: a receiver-argument call-form target lowers to
// fn(receiver, value) from its import binding; a method-form target lowers to
// receiver.name(value). A call-form row without the receiver-argument marker
// would silently drop the receiver, so it fails closed like every other form.
function planCapabilityAttributeWrite(
  expression: Node,
  left: Node,
  right: Node,
  fact: Extract<PythonTargetOperationFact, { kind: "capability-operation" }>,
  context: PythonPlanContext,
): readonly PythonStatement[] | undefined {
  const receiverNode = Node_Expression(left);
  const target = fact.target;
  const supportedForm = target.form === "method" || (target.form === "call" && target.receiverArgument === true);
  if (fact.operationKind !== "method" || receiverNode === undefined || !supportedForm) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "python.capability.property-write",
      "Provider property writes require a method-kind fact with a receiver-argument call-form or method-form target.",
    ));
    return undefined;
  }
  const receiver = planExpression(receiverNode, context);
  const value = planExpression(right, context);
  if (receiver === undefined || value === undefined) {
    return undefined;
  }
  if (target.form === "call") {
    return [{
      kind: "expr",
      expression: { kind: "call", callee: importBindingExpression(context, target.import), args: [receiver, value] },
    }];
  }
  if (target.form === "method") {
    return [{
      kind: "expr",
      expression: { kind: "call", callee: { kind: "attribute", value: receiver, name: target.name }, args: [value] },
    }];
  }
  // Unreachable: the supported-form gate above admits only the two forms.
  return undefined;
}

function planExpressionStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const expression = Node_Expression(node);
  if (expression === undefined) {
    return undefined;
  }
  const expressionKind = ast.kindName(expression);
  if (expressionKind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    if (operatorKind === KindEqualsToken || compoundAssignmentTokens.includes(operatorKind)) {
      return planAssignmentStatement(expression, context);
    }
  }
  if (expressionKind === KindPostfixUnaryExpression || expressionKind === KindPrefixUnaryExpression) {
    return planUpdateStatement(expression, context);
  }
  if (expressionKind === KindCallExpression || expressionKind === "KindAwaitExpression" || expressionKind === "KindDeleteExpression") {
    const planned = planExpression(expression, context);
    return planned === undefined ? undefined : [{ kind: "expr", expression: planned }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "python.backend.statement",
    "Expression statements support only calls, assignments, and increments.",
  ));
  return undefined;
}

function planCondition(condition: Node, context: PythonPlanContext, construct: string): PythonExpression | undefined {
  const carrier: TargetTypeRef | undefined = expressionCarrier(condition, context);
  if (!isPythonBoolCarrier(carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, condition),
      "python.backend.condition",
      `${construct} conditions require a finalized bool carrier fact.`,
    ));
    return undefined;
  }
  return planExpression(condition, context);
}

function planIfStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const condition = Node_Expression(node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "if");
  if (planned === undefined) {
    return undefined;
  }
  const thenStatements = planEmbeddedBlock(IfStatement_ThenStatement(node), context);
  const elseNode = IfStatement_ElseStatement(node);
  const elseStatements = elseNode === undefined ? undefined : planEmbeddedBlock(elseNode, context);
  if (thenStatements === undefined || (elseNode !== undefined && elseStatements === undefined)) {
    return undefined;
  }
  return [{
    kind: "if",
    condition: planned,
    body: paddedBody(thenStatements),
    ...(elseStatements === undefined || elseStatements.length === 0 ? {} : { orelse: elseStatements }),
  }];
}

function planWhileStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const condition = Node_Expression(node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "while");
  if (planned === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(IterationStatement_Statement(node), context);
  return body === undefined ? undefined : [{ kind: "while", condition: planned, body: paddedBody(body) }];
}

function planForOfStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const fact = pythonOperationFact(node, context);
  if (fact === undefined || fact.kind !== "for-of") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.backend.loop",
      "for-of statements require a finalized iteration fact.",
    ));
    return undefined;
  }
  const initializer = ForInOrOfStatement_Initializer(node);
  let bindingNode: Node | undefined;
  let bindingSourceName = "";
  if (initializer !== undefined) {
    const declarations = collectVariableDeclarations(initializer, context);
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    const nameNode = Node_Name(declaration);
    if (nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier) {
      bindingNode = declaration;
      bindingSourceName = ast.text(nameNode);
    }
  }
  if (bindingNode === undefined || bindingSourceName.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.loop",
      "for-of bindings require a plain identifier.",
    ));
    return undefined;
  }
  const iterableNode = Node_Expression(node);
  const iterable = iterableNode === undefined ? undefined : planExpression(iterableNode, context);
  if (iterable === undefined) {
    return undefined;
  }
  const binding = declareLocalBinding(bindingNode, bindingSourceName, context);
  if (binding === undefined) {
    return undefined;
  }
  const bodyNode = ForInOrOfStatement_Statement(node);
  const body = planEmbeddedBlock(bodyNode, context);
  if (body === undefined) {
    return undefined;
  }
  return [{ kind: "for", targetName: binding, iterable, body: paddedBody(body) }];
}

// C-style for loops desugar to the initializer statements followed by a
// while loop whose body ends with the incrementor. `continue` would skip the
// appended incrementor; it has no lowering anywhere, so any `continue` in the
// body already fails closed through the statement dispatcher.
function planForStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const initializer = ForStatement_Initializer(node);
  const condition = ForStatement_Condition(node);
  const incrementor = ForStatement_Incrementor(node);
  if (initializer === undefined || condition === undefined || incrementor === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.loop",
      "For statements require an initializer, a condition, and an incrementor.",
    ));
    return undefined;
  }
  const initStatements = planVariableStatement(initializer, context);
  const conditionExpression = planCondition(condition, context, "for");
  const incrementStatements = planIncrementor(incrementor, context);
  const body = planEmbeddedBlock(IterationStatement_Statement(node), context);
  if (initStatements === undefined || conditionExpression === undefined ||
    incrementStatements === undefined || body === undefined) {
    return undefined;
  }
  return [
    ...initStatements,
    {
      kind: "while",
      condition: conditionExpression,
      body: paddedBody([...body, ...incrementStatements]),
    },
  ];
}

function planIncrementor(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  if (kind === KindPostfixUnaryExpression || kind === KindPrefixUnaryExpression) {
    return planUpdateStatement(node, context);
  }
  if (kind === KindBinaryExpression) {
    return planAssignmentStatement(node, context);
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "python.backend.loop",
    "For incrementors support only identifier updates and assignments.",
  ));
  return undefined;
}

// Error policy: source Error values are Python exceptions. `throw new
// Error(...)` raises Exception(...); rethrowing a caught exception identifier
// raises it directly (`raise e` is deterministic and valid in and outside
// except scope, unlike bare `raise`).
function planThrowStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const expression = Node_Expression(node);
  const fact = pythonOperationFact(node, context) ??
    (expression === undefined ? undefined : pythonOperationFact(expression, context));
  if (fact === undefined || fact.kind !== "throw-op" || expression === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "python.error.throw",
      "throw statements require a finalized throw lowering fact.",
    ));
    return undefined;
  }
  const expressionKind = ast.kindName(expression);
  if (expressionKind === KindNewExpression) {
    const args = planArguments(expression, context);
    if (args === undefined) {
      return undefined;
    }
    return [{
      kind: "raise",
      expression: { kind: "call", callee: { kind: "name", name: "Exception" }, args },
    }];
  }
  if (expressionKind === KindIdentifier) {
    const planned = planExpression(expression, context);
    return planned === undefined ? undefined : [{ kind: "raise", expression: planned }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "python.error.throw",
    "throw supports only `throw new Error(...)` and rethrowing a caught exception identifier.",
  ));
  return undefined;
}

// Error policy: a catch clause lowers to a single `except Exception` handler
// (with the catch binding named per the local naming policy); finally lowers
// to the finally suite. try without both catch and finally has no lane.
function planTryStatement(node: Node, context: PythonPlanContext): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const tryBlock = TryStatement_TryBlock(node);
  const catchClause = TryStatement_CatchClause(node);
  const finallyBlock = TryStatement_FinallyBlock(node);
  if (tryBlock === undefined || (catchClause === undefined && finallyBlock === undefined)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.error.try",
      "try statements require a catch clause or a finally block.",
    ));
    return undefined;
  }
  const body = planBlockLike(tryBlock, context);
  let handlers: readonly PythonExceptHandler[] = [];
  let handlersFailed = false;
  if (catchClause !== undefined) {
    const catchBlock = CatchClause_Block(catchClause);
    if (catchBlock === undefined) {
      return undefined;
    }
    const bindingNode = Node_Name(CatchClause_VariableDeclaration(catchClause));
    let bindingName: string | undefined;
    if (bindingNode !== undefined) {
      if (ast.kindName(bindingNode) !== KindIdentifier) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, catchClause),
          "python.error.try",
          "Catch bindings require a plain identifier.",
        ));
        return undefined;
      }
      bindingName = declareLocalBinding(bindingNode, ast.text(bindingNode), context);
      if (bindingName === undefined) {
        return undefined;
      }
    }
    const handlerBody = planBlockLike(catchBlock, context);
    if (handlerBody === undefined) {
      handlersFailed = true;
    } else {
      handlers = [{
        exceptionType: "Exception",
        ...(bindingName === undefined ? {} : { name: bindingName }),
        body: paddedBody(handlerBody),
      }];
    }
  }
  const finallyBody = finallyBlock === undefined ? undefined : planBlockLike(finallyBlock, context);
  if (body === undefined || handlersFailed || (finallyBlock !== undefined && finallyBody === undefined)) {
    return undefined;
  }
  return [{
    kind: "try",
    body: paddedBody(body),
    handlers,
    ...(finallyBody === undefined ? {} : { finallyBody: paddedBody(finallyBody) }),
  }];
}

// Destructuring lowers only against an identifier initializer: identifiers
// are effect-free to re-plan per binding, so no synthetic temporary is
// needed (source names cannot express one under the naming policy).
// Object bindings read the attribute named by the finalized source-field
// fact; array bindings read positional indexes on a proven dense list (never
// tuple unpacking, which would require an exact length).
function planDestructuringDeclaration(
  declaration: Node,
  pattern: Node,
  patternKind: string,
  context: PythonPlanContext,
): readonly PythonStatement[] | undefined {
  const { ast } = context.input;
  const initializer = Node_Initializer(declaration);
  if (Node_Type(declaration) !== undefined || initializer === undefined ||
    ast.kindName(initializer) !== KindIdentifier) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "python.backend.destructuring",
      "Destructuring requires a plain identifier initializer and no type annotation.",
    ));
    return undefined;
  }
  const elements = ast.elements(pattern).filter((element): element is Node => element !== undefined);
  if (elements.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, pattern),
      "python.backend.destructuring",
      "Destructuring patterns require at least one binding.",
    ));
    return undefined;
  }
  if (patternKind === "KindArrayBindingPattern") {
    const carrier = expressionCarrier(initializer, context);
    if (!isPythonListCarrier(carrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "python.backend.destructuring",
        "Array destructuring requires a finalized dense list carrier fact on the initializer.",
      ));
      return undefined;
    }
  }
  const statements: PythonStatement[] = [];
  for (const [index, element] of elements.entries()) {
    const bindingName = ast.name(element);
    if (ast.kindName(element) !== "KindBindingElement" || bindingName === undefined ||
      ast.kindName(bindingName) !== KindIdentifier || Node_Initializer(element) !== undefined ||
      hasSpreadToken(element)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, element),
        "python.backend.destructuring",
        "Destructuring supports only plain identifier bindings without defaults or rest elements.",
      ));
      return undefined;
    }
    let value: PythonExpression;
    if (patternKind === "KindObjectBindingPattern") {
      const fact = pythonOperationFact(element, context);
      if (fact === undefined || fact.kind !== "source-field" || !isValidPythonIdentifier(fact.name)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, element),
          "python.backend.destructuring",
          "Object destructuring bindings require finalized source-field facts.",
        ));
        return undefined;
      }
      const source = planExpression(initializer, context);
      if (source === undefined) {
        return undefined;
      }
      value = { kind: "attribute", value: source, name: fact.name };
    } else {
      const source = planExpression(initializer, context);
      if (source === undefined) {
        return undefined;
      }
      value = { kind: "subscript", value: source, index: { kind: "int-literal", text: String(index) } };
    }
    const local = declareLocalBinding(element, ast.text(bindingName), context);
    if (local === undefined) {
      return undefined;
    }
    statements.push({ kind: "assign", targetName: local, value });
  }
  return statements;
}
