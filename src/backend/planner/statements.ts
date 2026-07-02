import type { Node, TargetTypeRef } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
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
  KindIdentifier,
  KindIfStatement,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
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
} from "../../common/source-ast.js";
import { isPythonBoolCarrier } from "../../source/python-target-types.js";
import type { PythonExpression, PythonStatement, PythonTypeAnnotation } from "../python-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { expressionCarrier, planExpression, planOperatorTokenLowering, pythonOperationFact } from "./expressions.js";
import { diagnosticInput, pythonLocalName } from "./plan-context.js";
import type { PythonPlanContext } from "./plan-context.js";
import { pythonTypeFromCarrier } from "./render-types.js";

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
  const sourceName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
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
    annotation = pythonTypeFromCarrier(context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier);
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
  if (fact === undefined || fact.kind !== "list-op" || fact.op !== "index-write") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "python.backend.assignment",
      "Element assignments require a finalized list index-write fact.",
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
  return [{ kind: "subscript-assign", target, index, value }];
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
    const compoundTokens = [
      KindPlusEqualsToken,
      KindMinusEqualsToken,
      KindAsteriskEqualsToken,
      KindSlashEqualsToken,
      KindPercentEqualsToken,
    ];
    if (operatorKind === KindEqualsToken || compoundTokens.includes(operatorKind)) {
      const left = BinaryExpression_Left(expression);
      const right = BinaryExpression_Right(expression);
      if (left !== undefined && right !== undefined &&
        ast.kindName(left) === KindElementAccessExpression && operatorKind === KindEqualsToken) {
        return planElementWriteStatement(expression, left, right, context);
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
  }
  if (expressionKind === KindPostfixUnaryExpression || expressionKind === KindPrefixUnaryExpression) {
    return planUpdateStatement(expression, context);
  }
  if (expressionKind === KindCallExpression) {
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
