import {
  ExtensionLifecycleEvent,
  providerVirtualDeclarationFactKey,
  runtimeCarrierFactKey,
  selectedTargetSignatureFactKey,
  sourcePrimitiveFactKey,
  targetOperationFactKey,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  ExtensionLifecycleContext,
  Node,
  ProviderDeclarationIdentity,
  SourceFile,
  TargetMember,
  TargetTypeRef,
} from "@tsonic/tsts";
import { tsonicCoreSourceExtensionId } from "@tsonic/source-core";
import type { TargetProviderContext } from "@tsonic/target-api";
import {
  ArrayTypeNode_ElementType,
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  KindArrayLiteralExpression,
  KindArrayType,
  KindBinaryExpression,
  KindBlock,
  KindBooleanKeyword,
  KindCallExpression,
  KindElementAccessExpression,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindExpressionStatement,
  KindFalseKeyword,
  KindForOfStatement,
  KindForStatement,
  KindFunctionDeclaration,
  KindIdentifier,
  KindIfStatement,
  KindNewExpression,
  KindNumericLiteral,
  KindOmittedExpression,
  KindParameter,
  KindParenthesizedExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindReturnStatement,
  KindStringKeyword,
  KindStringLiteral,
  KindTrueKeyword,
  KindVariableDeclaration,
  KindVariableStatement,
  KindVoidKeyword,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Operand,
  Node_Type,
  getPrefixUnaryOperatorText,
} from "../../common/source-ast.js";
import {
  isPythonBoolCarrier,
  isPythonIntegerCarrier,
  isPythonNumericCarrier,
  pythonListElementCarrier,
  pythonListTargetType,
  pythonNoneTargetType,
  pythonPrimitiveTypeName,
  pythonSourcePrimitiveTargetType,
  pythonStrTargetType,
} from "../python-target-types.js";
import { pythonExtensionId, pythonTargetOperationFactKey } from "../python-facts/keys.js";
import type { PythonProviderOperationForm, PythonTargetOperationFact } from "../python-facts/keys.js";
import { collectPythonProviderOperationRows } from "../provider-packages/index.js";
import type { PythonProviderOperationRow } from "../provider-packages/index.js";
import {
  isPythonSignedNumericCarrier,
  pythonOperatorCarrierKey,
  selectPythonBinaryOperator,
} from "./operator-rules.js";
import { validatePythonTargetOptions } from "../../options/python-target-options.js";

export const pythonTargetSemanticsExtensionId = "tsonic.python.target-semantics";

export function createPythonTargetSemanticsExtension(context: TargetProviderContext): CompilerExtension {
  validatePythonTargetOptions(context.target);
  const providerRows = collectPythonProviderOperationRows(context.selectedPackages);
  return {
    identity: {
      id: pythonTargetSemanticsExtensionId,
      version: "0.0.1",
      capabilityNamespace: pythonExtensionId,
    },
    dependencies: {
      dependsOn: [tsonicCoreSourceExtensionId],
      runsAfter: [tsonicCoreSourceExtensionId],
    },
    composition: { kind: "target", target: "python" },
    initialize(extensionContext): void {
      extensionContext.registerLifecycleHook(
        ExtensionLifecycleEvent.beforeSemanticsFinalized,
        (_request, lifecycleContext) => {
          recordPythonFactsBeforeFinalization(lifecycleContext, providerRows);
        },
      );
    },
  };
}

interface PythonFactWalk {
  readonly lifecycle: ExtensionLifecycleContext;
  readonly providerRows: readonly PythonProviderOperationRow[];
  readonly resolving: Set<object>;
}

const boolCarrier = pythonSourcePrimitiveTargetType("bool");
// List lengths surface with the int32 carrier (matches the Rust target).
const listLengthCarrier = pythonSourcePrimitiveTargetType("int32");

export function recordPythonFactsBeforeFinalization(
  lifecycle: ExtensionLifecycleContext,
  providerRows: readonly PythonProviderOperationRow[],
): void {
  const walk: PythonFactWalk = { lifecycle, providerRows, resolving: new Set() };
  const { ast } = lifecycle.compiler;
  for (const sourceFile of lifecycle.compiler.getSourceFiles()) {
    if (sourceFile === undefined || ast.getFileName(sourceFile).endsWith(".d.ts")) {
      continue;
    }
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) {
        continue;
      }
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        recordFunctionFacts(walk, statement, sourceFile);
      } else if (kind === KindVariableStatement) {
        recordVariableStatementFacts(walk, statement, sourceFile);
      }
    }
  }
}

function recordFunctionFacts(walk: PythonFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  // Async functions have no P2 Python lane; the declaration fails closed.
  if (ast.hasModifierKind(declaration, "async")) {
    return;
  }
  const returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  for (const parameter of ast.parameters(declaration)) {
    if (parameter === undefined) {
      continue;
    }
    const parameterCarrier = resolveTypeNodeCarrier(walk, Node_Type(parameter));
    if (parameterCarrier !== undefined) {
      setCarrierFact(walk, parameter, parameterCarrier);
    }
  }
  const body = ast.body(declaration);
  if (body !== undefined) {
    for (const statement of ast.statements(body)) {
      if (statement !== undefined) {
        recordStatementFacts(walk, statement, sourceFile, returnCarrier);
      }
    }
  }
}

function recordVariableStatementFacts(walk: PythonFactWalk, statement: Node, sourceFile: SourceFile): void {
  for (const declaration of collectDescendantsOfKind(walk, statement, KindVariableDeclaration)) {
    const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
    const initializer = Node_Initializer(declaration);
    const initializerCarrier = initializer === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initializer, sourceFile, annotated);
    const effective = annotated ?? initializerCarrier;
    if (effective !== undefined) {
      setCarrierFact(walk, declaration, effective);
    }
  }
}

function recordStatementFacts(
  walk: PythonFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(statement);
  if (kind === KindBlock) {
    for (const child of ast.statements(statement)) {
      if (child !== undefined) {
        recordStatementFacts(walk, child, sourceFile, returnCarrier);
      }
    }
    return;
  }
  if (kind === KindVariableStatement) {
    recordVariableStatementFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === KindReturnStatement) {
    const expression = Node_Expression(statement);
    if (expression !== undefined) {
      resolveExpressionCarrier(walk, expression, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindExpressionStatement) {
    const expression = Node_Expression(statement);
    if (expression === undefined) {
      return;
    }
    if (ast.kindName(expression) === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(expression);
      const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
      if (operatorKind === KindEqualsToken) {
        const left = BinaryExpression_Left(expression);
        const right = BinaryExpression_Right(expression);
        if (left === undefined || right === undefined) {
          return;
        }
        const leftKind = ast.kindName(left);
        if (leftKind === KindElementAccessExpression) {
          recordListIndexWriteFacts(walk, expression, left, right, sourceFile);
          return;
        }
        if (leftKind === KindPropertyAccessExpression) {
          // Property writes (including `.length =`) have no P2 lane.
          return;
        }
        const leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
        resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
        return;
      }
    }
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
    return;
  }
  if (kind === KindIfStatement) {
    const condition = Node_Expression(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const thenStatement = IfStatement_ThenStatement(statement);
    if (thenStatement !== undefined) {
      recordStatementFacts(walk, thenStatement, sourceFile, returnCarrier);
    }
    const elseStatement = IfStatement_ElseStatement(statement);
    if (elseStatement !== undefined) {
      recordStatementFacts(walk, elseStatement, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindWhileStatement) {
    const condition = Node_Expression(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const body = IterationStatement_Statement(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindForOfStatement) {
    recordForOfFacts(walk, statement, sourceFile, returnCarrier);
    return;
  }
  if (kind === KindForStatement) {
    const initializer = ForStatement_Initializer(statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
        const declarationInitializer = Node_Initializer(declaration);
        const initializerCarrier = declarationInitializer === undefined
          ? undefined
          : resolveExpressionCarrier(walk, declarationInitializer, sourceFile, annotated);
        const effective = annotated ?? initializerCarrier;
        if (effective !== undefined) {
          setCarrierFact(walk, declaration, effective);
        }
      }
    }
    const condition = ForStatement_Condition(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const incrementor = ForStatement_Incrementor(statement);
    if (incrementor !== undefined) {
      resolveExpressionCarrier(walk, incrementor, sourceFile, undefined);
    }
    const body = IterationStatement_Statement(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
}

function resolveTypeNodeCarrier(walk: PythonFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(typeNode, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  const primitive = facts.get(typeNode, sourcePrimitiveFactKey);
  if (primitive !== undefined) {
    // Only primitive kinds with a Python lane produce carriers; the rest
    // fail closed until a lane owns them.
    if (pythonPrimitiveTypeName(primitive.kind) === undefined) {
      return undefined;
    }
    return setCarrierFact(walk, typeNode, pythonSourcePrimitiveTargetType(primitive.kind));
  }
  const kind = walk.lifecycle.compiler.ast.kindName(typeNode);
  if (kind === KindArrayType) {
    const element = resolveTypeNodeCarrier(walk, ArrayTypeNode_ElementType(typeNode));
    return element === undefined ? undefined : setCarrierFact(walk, typeNode, pythonListTargetType(element));
  }
  if (kind === KindStringKeyword) {
    return setCarrierFact(walk, typeNode, pythonStrTargetType());
  }
  if (kind === "KindNumberKeyword") {
    return setCarrierFact(walk, typeNode, pythonSourcePrimitiveTargetType("float64"));
  }
  if (kind === KindBooleanKeyword) {
    return setCarrierFact(walk, typeNode, boolCarrier);
  }
  if (kind === KindVoidKeyword) {
    return setCarrierFact(walk, typeNode, pythonNoneTargetType());
  }
  return undefined;
}

function resolveExpressionCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(expression, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  if (walk.resolving.has(expression)) {
    return undefined;
  }
  walk.resolving.add(expression);
  try {
    return resolveExpressionCarrierUncached(walk, expression, sourceFile, expected);
  } finally {
    walk.resolving.delete(expression);
  }
}

function resolveExpressionCarrierUncached(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const kind = walk.lifecycle.compiler.ast.kindName(expression);
  switch (kind) {
    case KindNumericLiteral: {
      if (expected !== undefined && isPythonNumericCarrier(expected)) {
        return setCarrierFact(walk, expression, expected);
      }
      return undefined;
    }
    case KindStringLiteral: {
      return setCarrierFact(walk, expression, pythonStrTargetType());
    }
    case KindTrueKeyword:
    case KindFalseKeyword: {
      return setCarrierFact(walk, expression, boolCarrier);
    }
    case KindIdentifier: {
      return resolveIdentifierCarrier(walk, expression, sourceFile);
    }
    case KindArrayLiteralExpression: {
      return resolveArrayLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
    }
    case KindPrefixUnaryExpression: {
      return resolveUnaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindBinaryExpression: {
      return resolveBinaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindCallExpression:
    case KindNewExpression: {
      return resolveCallLikeCarrier(walk, expression, sourceFile, kind);
    }
    case KindPropertyAccessExpression: {
      return resolvePropertyAccessCarrier(walk, expression, sourceFile);
    }
    case KindElementAccessExpression: {
      return resolveElementAccessCarrier(walk, expression, sourceFile);
    }
    default: {
      return undefined;
    }
  }
}

function resolveIdentifierCarrier(walk: PythonFactWalk, identifier: Node, sourceFile: SourceFile): TargetTypeRef | undefined {
  const { checker } = walk.lifecycle.compiler;
  const providerIdentity = providerDeclarationIdentityFor(walk, identifier);
  if (providerIdentity !== undefined) {
    // Static-attribute-style provider values referenced as bare identifiers.
    const row = matchProviderRow(walk.providerRows, providerIdentity, "property");
    if (row === undefined) {
      return undefined;
    }
    recordProviderOperationFacts(walk, identifier, row, providerIdentity);
    return setCarrierFact(walk, identifier, row.resultCarrier);
  }
  const symbol = checker.getResolvedSymbolOrNil(identifier) ?? checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) {
    return undefined;
  }
  const declaration = checker.getSymbolValueDeclaration(symbol) ?? checker.getPrimarySymbolDeclaration(symbol);
  if (declaration === undefined) {
    return undefined;
  }
  const declarationKind = walk.lifecycle.compiler.ast.kindName(declaration);
  if (declarationKind !== KindParameter && declarationKind !== KindVariableDeclaration) {
    return undefined;
  }
  const facts = walk.lifecycle.host.facts;
  const declarationFact = facts.get(declaration, runtimeCarrierFactKey);
  if (declarationFact !== undefined) {
    return setCarrierFact(walk, identifier, declarationFact.carrier);
  }
  const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  if (annotated !== undefined) {
    setCarrierFact(walk, declaration, annotated);
    return setCarrierFact(walk, identifier, annotated);
  }
  const initializer = Node_Initializer(declaration);
  if (initializer !== undefined) {
    const initializerCarrier = resolveExpressionCarrier(walk, initializer, sourceFile, undefined);
    if (initializerCarrier !== undefined) {
      setCarrierFact(walk, declaration, initializerCarrier);
      return setCarrierFact(walk, identifier, initializerCarrier);
    }
  }
  return undefined;
}

function resolveUnaryCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const operand = Node_Operand(expression);
  if (operand === undefined) {
    return undefined;
  }
  const ast = walk.lifecycle.compiler.ast;
  const operatorText = getPrefixUnaryOperatorText(ast, expression);
  if (operatorText === "!") {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, boolCarrier);
    if (operandCarrier !== undefined && isPythonBoolCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "not", boolCarrier, pythonOperatorCarrierKey(boolCarrier));
      return setCarrierFact(walk, expression, boolCarrier);
    }
    return undefined;
  }
  if (operatorText === "-") {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, expected);
    if (operandCarrier !== undefined && isPythonSignedNumericCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "-", operandCarrier, pythonOperatorCarrierKey(operandCarrier));
      return setCarrierFact(walk, expression, operandCarrier);
    }
    return undefined;
  }
  return undefined;
}

function resolveBinaryCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const left = BinaryExpression_Left(expression);
  const right = BinaryExpression_Right(expression);
  const ast = walk.lifecycle.compiler.ast;
  const operatorToken = BinaryExpression_OperatorToken(expression);
  if (left === undefined || right === undefined || operatorToken === undefined) {
    return undefined;
  }
  const operatorKind = ast.kindName(operatorToken);
  if (operatorKind === KindEqualsToken) {
    return undefined;
  }
  let leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
  let rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, undefined);
  if (leftCarrier === undefined && rightCarrier !== undefined && isPythonNumericCarrier(rightCarrier)) {
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, rightCarrier);
  }
  if (rightCarrier === undefined && leftCarrier !== undefined && isPythonNumericCarrier(leftCarrier)) {
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
  }
  if (expected !== undefined && isPythonNumericCarrier(expected)) {
    if (leftCarrier === undefined) {
      leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, expected);
    }
    if (rightCarrier === undefined) {
      rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, expected);
    }
  }
  const equalityOperator = operatorKind === KindEqualsEqualsEqualsToken || operatorKind === KindExclamationEqualsEqualsToken;
  if (equalityOperator && leftCarrier === undefined && rightCarrier === undefined) {
    // Equality between context-free numeric expressions defaults to float64:
    // TypeScript numbers are IEEE doubles.
    const doubleCarrier = pythonSourcePrimitiveTargetType("float64");
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, doubleCarrier);
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, doubleCarrier);
  }
  const selection = selectPythonBinaryOperator(operatorKind, leftCarrier, rightCarrier);
  if (selection === undefined || leftCarrier === undefined) {
    return undefined;
  }
  if (selection.kind === "string-concat") {
    const operationId = "tsonic.python.operator.concat.str";
    recordTargetOperation(walk, expression, operationId, "operator", "concat");
    setPythonOperationFact(walk, expression, {
      kind: "string-concat",
      operationId,
      resultCarrier: selection.resultCarrier,
    });
  } else {
    recordOperatorFacts(walk, expression, selection.pythonOperator, selection.resultCarrier, pythonOperatorCarrierKey(leftCarrier));
  }
  return setCarrierFact(walk, expression, selection.resultCarrier);
}

function resolveCallLikeCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expressionKind: string,
): TargetTypeRef | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const callee = Node_Expression(expression);
  if (callee === undefined) {
    return undefined;
  }
  const callArguments = ast.arguments(expression);
  const providerIdentity = providerDeclarationIdentityFor(walk, callee);
  if (providerIdentity !== undefined) {
    const operationKind = expressionKind === KindNewExpression ? "constructor" : "method";
    const row = matchProviderRow(walk.providerRows, providerIdentity, operationKind);
    if (row === undefined) {
      appendProviderOperationDiagnostic(walk, providerIdentity, operationKind);
      return undefined;
    }
    if (ast.kindName(callee) === KindPropertyAccessExpression) {
      const receiver = Node_Expression(callee);
      if (receiver !== undefined) {
        resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
      }
    }
    for (const [index, argument] of callArguments.entries()) {
      if (argument !== undefined) {
        resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[index]);
      }
    }
    recordProviderOperationFacts(walk, expression, row, providerIdentity);
    return setCarrierFact(walk, expression, row.resultCarrier);
  }
  if (expressionKind === KindNewExpression) {
    return undefined;
  }
  const listAppend = tryListAppendCall(walk, expression, callee, callArguments, sourceFile);
  if (listAppend !== undefined) {
    return listAppend;
  }
  const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined) {
    return undefined;
  }
  const aliased = safeAliasedSymbol(checker, symbol) ?? symbol;
  const declaration = checker.getSymbolValueDeclaration(aliased) ??
    checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(aliased) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
  if (declaration === undefined || ast.kindName(declaration) !== KindFunctionDeclaration) {
    return undefined;
  }
  const declarationFile = ast.getFileName(ast.getSourceFile(declaration));
  if (declarationFile.endsWith(".d.ts")) {
    return undefined;
  }
  if (ast.hasModifierKind(declaration, "async")) {
    return undefined;
  }
  const parameters = ast.parameters(declaration);
  for (const [index, argument] of callArguments.entries()) {
    if (argument === undefined) {
      continue;
    }
    const parameter = parameters[index];
    const parameterCarrier = parameter === undefined
      ? undefined
      : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(parameter));
    resolveExpressionCarrier(walk, argument, sourceFile, parameterCarrier);
  }
  const returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  return returnCarrier === undefined ? undefined : setCarrierFact(walk, expression, returnCarrier);
}

function tryListAppendCall(
  walk: PythonFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (ast.kindName(callee) !== KindPropertyAccessExpression) {
    return undefined;
  }
  const nameNode = Node_Name(callee);
  if (nameNode === undefined || ast.text(nameNode) !== "push") {
    return undefined;
  }
  const receiver = Node_Expression(callee);
  const receiverCarrier = receiver === undefined
    ? undefined
    : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  const element = pythonListElementCarrier(receiverCarrier);
  if (element === undefined || callArguments.length !== 1) {
    return undefined;
  }
  const [argument] = callArguments;
  if (argument === undefined) {
    return undefined;
  }
  const argumentCarrier = resolveExpressionCarrier(walk, argument, sourceFile, element);
  if (argumentCarrier === undefined || !sameCarrier(argumentCarrier, element)) {
    return undefined;
  }
  const operationId = "tsonic.python.list.append";
  recordTargetOperation(walk, expression, operationId, "method", "append");
  setPythonOperationFact(walk, expression, {
    kind: "list-op",
    operationId,
    op: "append",
    resultCarrier: pythonNoneTargetType(),
  });
  return setCarrierFact(walk, expression, pythonNoneTargetType());
}

function resolvePropertyAccessCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const receiver = Node_Expression(expression);
  const receiverCarrier = receiver === undefined
    ? undefined
    : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  const providerIdentity = providerDeclarationIdentityFor(walk, expression);
  if (providerIdentity !== undefined) {
    const row = matchProviderRow(walk.providerRows, providerIdentity, "property");
    if (row === undefined) {
      appendProviderOperationDiagnostic(walk, providerIdentity, "property");
      return undefined;
    }
    recordProviderOperationFacts(walk, expression, row, providerIdentity);
    return setCarrierFact(walk, expression, row.resultCarrier);
  }
  const element = pythonListElementCarrier(receiverCarrier);
  if (element !== undefined) {
    const nameNode = Node_Name(expression);
    if (nameNode !== undefined && walk.lifecycle.compiler.ast.text(nameNode) === "length") {
      const operationId = "tsonic.python.list.len";
      recordTargetOperation(walk, expression, operationId, "property", "len");
      setPythonOperationFact(walk, expression, {
        kind: "list-op",
        operationId,
        op: "len",
        resultCarrier: listLengthCarrier,
      });
      return setCarrierFact(walk, expression, listLengthCarrier);
    }
  }
  return undefined;
}

function resolveElementAccessCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const receiver = Node_Expression(expression);
  if (receiver === undefined) {
    return undefined;
  }
  const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  const argument = ElementAccessExpression_ArgumentExpression(expression);
  const element = pythonListElementCarrier(receiverCarrier);
  if (element !== undefined) {
    const indexCarrier = argument === undefined
      ? undefined
      : resolveExpressionCarrier(walk, argument, sourceFile, listLengthCarrier);
    if (!isPythonIntegerCarrier(indexCarrier)) {
      return undefined;
    }
    const operationId = "tsonic.python.list.index-read";
    recordTargetOperation(walk, expression, operationId, "indexer", "[]");
    setPythonOperationFact(walk, expression, {
      kind: "list-op",
      operationId,
      op: "index-read",
      resultCarrier: element,
    });
    return setCarrierFact(walk, expression, element);
  }
  if (receiverCarrier?.kind !== "target-named") {
    return undefined;
  }
  const row = walk.providerRows.find((candidate) =>
    candidate.operationKind === "indexer" &&
    candidate.receiverTypeId === receiverCarrier.id);
  if (row === undefined) {
    return undefined;
  }
  if (argument !== undefined) {
    resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[0]);
  }
  recordProviderOperationFacts(walk, expression, row, undefined);
  return setCarrierFact(walk, expression, row.resultCarrier);
}

function recordListIndexWriteFacts(
  walk: PythonFactWalk,
  assignment: Node,
  left: Node,
  right: Node,
  sourceFile: SourceFile,
): void {
  const receiver = Node_Expression(left);
  const receiverCarrier = receiver === undefined
    ? undefined
    : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  const element = pythonListElementCarrier(receiverCarrier);
  if (element === undefined) {
    return;
  }
  const index = ElementAccessExpression_ArgumentExpression(left);
  const indexCarrier = index === undefined
    ? undefined
    : resolveExpressionCarrier(walk, index, sourceFile, listLengthCarrier);
  if (!isPythonIntegerCarrier(indexCarrier)) {
    return;
  }
  const valueCarrier = resolveExpressionCarrier(walk, right, sourceFile, element);
  if (valueCarrier === undefined || !sameCarrier(valueCarrier, element)) {
    return;
  }
  const operationId = "tsonic.python.list.index-write";
  recordTargetOperation(walk, assignment, operationId, "indexer", "[]=");
  setPythonOperationFact(walk, assignment, {
    kind: "list-op",
    operationId,
    op: "index-write",
    resultCarrier: pythonNoneTargetType(),
  });
}

function recordForOfFacts(
  walk: PythonFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const iterable = Node_Expression(statement);
  const iterableCarrier = iterable === undefined
    ? undefined
    : resolveExpressionCarrier(walk, iterable, sourceFile, undefined);
  const element = pythonListElementCarrier(iterableCarrier);
  if (element !== undefined) {
    setPythonOperationFact(walk, statement, {
      kind: "for-of",
      operationId: "tsonic.python.for-of.list",
      elementCarrier: element,
    });
    const initializer = ForInOrOfStatement_Initializer(statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, element);
      }
    }
  }
  const body = ForInOrOfStatement_Statement(statement);
  if (body !== undefined) {
    recordStatementFacts(walk, body, sourceFile, returnCarrier);
  }
}

function resolveArrayLiteralCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const elements = ast.elements(expression).filter((element): element is Node => element !== undefined);
  if (elements.some((element) => ast.kindName(element) === KindOmittedExpression)) {
    // Sparse literals have no P2 lane.
    return undefined;
  }
  let expectedElement = pythonListElementCarrier(expected);
  if (expectedElement === undefined) {
    for (const element of elements) {
      const carrier = resolveExpressionCarrier(walk, element, sourceFile, undefined);
      if (carrier !== undefined) {
        expectedElement = carrier;
        break;
      }
    }
  }
  if (expectedElement === undefined && elements.length > 0 &&
      elements.every((element) => ast.kindName(element) === KindNumericLiteral)) {
    expectedElement = pythonSourcePrimitiveTargetType("float64");
  }
  if (expectedElement === undefined) {
    return undefined;
  }
  for (const element of elements) {
    const carrier = resolveExpressionCarrier(walk, element, sourceFile, expectedElement);
    if (carrier === undefined || !sameCarrier(carrier, expectedElement)) {
      // Heterogeneous or unproven elements fail closed.
      return undefined;
    }
  }
  const resultCarrier = pythonListTargetType(expectedElement);
  setPythonOperationFact(walk, expression, {
    kind: "array-literal",
    operationId: "tsonic.python.list.literal.dense",
    lane: "dense",
    elementCarrier: expectedElement,
    resultCarrier,
    length: elements.length,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function safeAliasedSymbol(
  checker: PythonFactWalk["lifecycle"]["compiler"]["checker"],
  symbol: NonNullable<ReturnType<PythonFactWalk["lifecycle"]["compiler"]["checker"]["getSymbolAtLocation"]>>,
) {
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return undefined;
  }
}

function providerDeclarationIdentityFor(walk: PythonFactWalk, reference: Node): ProviderDeclarationIdentity | undefined {
  const { checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  for (const candidate of [symbol, safeAliasedSymbol(checker, symbol)]) {
    if (candidate === undefined) {
      continue;
    }
    for (const declaration of checker.getSymbolDeclarations(candidate)) {
      if (declaration === undefined) {
        continue;
      }
      const fact = facts.get(declaration, providerVirtualDeclarationFactKey);
      if (fact !== undefined) {
        return fact as ProviderDeclarationIdentity;
      }
    }
  }
  return undefined;
}

function matchProviderRow(
  rows: readonly PythonProviderOperationRow[],
  identity: ProviderDeclarationIdentity,
  operationKind: PythonProviderOperationRow["operationKind"],
): PythonProviderOperationRow | undefined {
  return rows.find((row) => {
    if (row.operationKind !== operationKind) {
      return false;
    }
    if (row.memberId !== undefined) {
      return row.memberId === identity.memberId;
    }
    if (row.exportId !== identity.exportId) {
      return false;
    }
    return row.signatureId === undefined || row.signatureId === identity.signatureId;
  });
}

function providerOperationTargetText(target: PythonProviderOperationForm): string {
  switch (target.form) {
    case "call":
    case "constructor": {
      return target.import.name ?? target.import.module;
    }
    case "method":
    case "property":
    case "static-attribute": {
      return target.name;
    }
    case "index": {
      return "[]";
    }
  }
}

function recordProviderOperationFacts(
  walk: PythonFactWalk,
  expression: Node,
  row: PythonProviderOperationRow,
  identity: ProviderDeclarationIdentity | undefined,
): void {
  const operationId = row.memberId ?? row.signatureId ?? row.exportId;
  const targetOperationText = providerOperationTargetText(row.target);
  recordTargetOperation(walk, expression, operationId, row.operationKind, targetOperationText);
  setPythonOperationFact(walk, expression, {
    kind: "provider-operation",
    operationId,
    operationKind: row.operationKind,
    target: row.target,
    resultCarrier: row.resultCarrier,
  });
  if (row.operationKind === "method" || row.operationKind === "constructor") {
    const member: TargetMember = {
      id: operationId,
      sourceName: identity?.exportName ?? identity?.memberName ?? operationId,
      targetName: targetOperationText,
      kind: row.operationKind === "constructor" ? "constructor" : "method",
      parameters: (row.parameterCarriers ?? []).map((carrier, index) => ({
        name: `arg${index}`,
        type: carrier,
        passingMode: "by-value",
      })),
      returnType: row.resultCarrier,
    };
    walk.lifecycle.host.facts.set(
      expression,
      selectedTargetSignatureFactKey,
      { member, ...(identity === undefined ? {} : { providerDeclaration: identity }) },
      [{ message: `python provider operation ${operationId}` }],
    );
  }
}

function recordOperatorFacts(
  walk: PythonFactWalk,
  expression: Node,
  pythonOperator: string,
  resultCarrier: TargetTypeRef,
  carrierKey: string,
): void {
  const operationId = `tsonic.python.operator.${pythonOperator}.${carrierKey}`;
  recordTargetOperation(walk, expression, operationId, "operator", pythonOperator);
  setPythonOperationFact(walk, expression, {
    kind: "operator-token",
    operationId,
    operator: pythonOperator,
    resultCarrier,
  });
}

function recordTargetOperation(
  walk: PythonFactWalk,
  expression: Node,
  operationId: string,
  operationKind: "property" | "method" | "indexer" | "operator" | "constructor",
  targetOperation: string,
): void {
  walk.lifecycle.host.facts.set(
    expression,
    targetOperationFactKey,
    { operationId, operationKind, targetOperation },
    [{ message: `python target operation ${operationId}` }],
  );
}

function setPythonOperationFact(walk: PythonFactWalk, subject: Node, fact: PythonTargetOperationFact): void {
  walk.lifecycle.host.facts.set(subject, pythonTargetOperationFactKey, fact, [
    { message: `python operation ${fact.operationId}` },
  ]);
}

function setCarrierFact(walk: PythonFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(subject, runtimeCarrierFactKey);
  if (existing === undefined) {
    facts.set(subject, runtimeCarrierFactKey, { carrier }, [{ message: "python carrier" }]);
  }
  return carrier;
}

function sameCarrier(left: TargetTypeRef, right: TargetTypeRef): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function appendProviderOperationDiagnostic(
  walk: PythonFactWalk,
  identity: ProviderDeclarationIdentity,
  operationKind: string,
): void {
  walk.lifecycle.host.diagnostics.append({
    extensionId: pythonTargetSemanticsExtensionId,
    extensionCode: "PYTHON_PROVIDER_OPERATION_NOT_MAPPED",
    numericCode: 0,
    category: "error",
    message: `No Python target operation is mapped for provider declaration '${identity.memberId ?? identity.exportId ?? identity.moduleSpecifier}' (${operationKind}).`,
    evidence: [
      { message: `target.capability=python.provider.${operationKind}` },
      { message: `provider.module=${identity.moduleSpecifier}` },
    ],
  });
}

function collectDescendantsOfKind(walk: PythonFactWalk, root: Node, kindName: string): readonly Node[] {
  const { ast } = walk.lifecycle.compiler;
  const results: Node[] = [];
  const visit = (node: Node): void => {
    if (ast.kindName(node) === kindName) {
      results.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(root);
  return results;
}
