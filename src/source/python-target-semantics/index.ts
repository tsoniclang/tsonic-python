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
  KindInterfaceDeclaration,
  KindNewExpression,
  KindNoSubstitutionTemplateLiteral,
  KindNullKeyword,
  KindNumericLiteral,
  KindOmittedExpression,
  KindParameter,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindReturnStatement,
  KindStringKeyword,
  KindStringLiteral,
  KindTemplateExpression,
  KindTemplateSpan,
  KindTrueKeyword,
  KindTypeReference,
  KindVariableDeclaration,
  KindVariableStatement,
  KindVoidKeyword,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Operand,
  Node_Type,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  TypeReferenceNode_TypeName,
  getPostfixUnaryOperatorText,
  getPrefixUnaryOperatorText,
  Node_DotDotDotToken,
  Node_PostfixToken,
  Node_PropertyName,
  Node_QuestionToken,
  unwrapParenthesized,
} from "../../common/source-ast.js";
import {
  isPythonBoolCarrier,
  isPythonDictCarrier,
  isPythonExceptionCarrier,
  isPythonIntegerCarrier,
  isPythonJsArrayCarrier,
  isPythonJsCompatCarrier,
  isPythonJsonSerializableCarrier,
  isPythonNumericCarrier,
  isPythonOptionalCarrier,
  isPythonStrCarrier,
  isPythonTupleCarrier,
  pythonJsArrayTargetType,
  pythonJsValueTargetType,
  pythonDictTargetType,
  pythonDictValueCarrier,
  pythonExceptionTargetType,
  pythonListElementCarrier,
  pythonListTargetType,
  pythonNoneTargetType,
  pythonOptionalTargetType,
  pythonPrimitiveTypeName,
  pythonSourcePrimitiveTargetType,
  pythonStrTargetType,
  pythonTupleTargetType,
} from "../python-target-types.js";
import {
  pythonAsyncFunctionFactKey,
  pythonExtensionId,
  pythonSourceTypeCarrier,
  pythonSourceTypeCarrierValue,
  pythonTargetOperationFactKey,
} from "../python-facts/keys.js";
import type { PythonCapabilityOperationForm, PythonTargetOperationFact } from "../python-facts/keys.js";
import { collectPythonCapabilityOperationRows } from "../capabilities/index.js";
import { createPythonStdlibCapabilities } from "../capabilities/stdlib.js";
import type { PythonCapabilityOperationRow } from "../capabilities/index.js";
import {
  isPythonSignedNumericCarrier,
  pythonOperatorCarrierKey,
  selectPythonBinaryOperator,
  selectPythonCompoundAssignment,
} from "./operator-rules.js";
import {
  pythonJsRuntimeModule,
  pythonJsUndefinedForm,
  selectJsSurfaceConstructor,
  selectJsSurfaceOperation,
} from "./js-surface-operations.js";
import type { JsOperationSelection } from "./js-surface-operations.js";
import {
  readPythonTypescriptCompatibilityMode,
  validatePythonTargetOptions,
} from "../../options/python-target-options.js";

export const pythonTargetSemanticsExtensionId = "tsonic.python.target-semantics";

export function createPythonTargetSemanticsExtension(context: TargetProviderContext): CompilerExtension {
  validatePythonTargetOptions(context.target);
  const providerRows = collectPythonCapabilityOperationRows([
    ...createPythonStdlibCapabilities(),
    ...context.selectedCapabilities,
  ]);
  // JS-surface lanes open only with the js surface or compat mode; strict
  // native output stays entirely free of the compat runtime.
  const jsEnabled = context.selectedSurfaces.some((surface) => surface.id === "js") ||
    readPythonTypescriptCompatibilityMode(context.target) === "compat";
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
          recordPythonFactsBeforeFinalization(lifecycleContext, providerRows, jsEnabled);
        },
      );
    },
  };
}

interface PythonFactWalk {
  readonly lifecycle: ExtensionLifecycleContext;
  readonly providerRows: readonly PythonCapabilityOperationRow[];
  readonly resolving: Set<object>;
  // Proven project-source type declarations keyed by fileName::typeName. Only
  // registered declarations own source-type lanes; everything else fails
  // closed at every use site.
  readonly provenSourceTypes: Map<string, Node>;
  readonly jsEnabled: boolean;
  currentThisCarrier?: TargetTypeRef;
}

const boolCarrier = pythonSourcePrimitiveTargetType("bool");
// List lengths surface with the int32 carrier (matches the shared contract).
const listLengthCarrier = pythonSourcePrimitiveTargetType("int32");

const KindClassDeclaration = "KindClassDeclaration";
const KindEnumDeclaration = "KindEnumDeclaration";
const KindEnumMember = "KindEnumMember";
const KindPropertyDeclaration = "KindPropertyDeclaration";
const KindPropertySignature = "KindPropertySignature";
const KindMethodDeclaration = "KindMethodDeclaration";
const KindConstructor = "KindConstructor";
const KindSemicolonClassElement = "KindSemicolonClassElement";
const KindObjectLiteralExpression = "KindObjectLiteralExpression";
const KindPropertyAssignment = "KindPropertyAssignment";
const KindShorthandPropertyAssignment = "KindShorthandPropertyAssignment";
const KindObjectBindingPattern = "KindObjectBindingPattern";
const KindArrayBindingPattern = "KindArrayBindingPattern";
const KindBindingElement = "KindBindingElement";
const KindThrowStatement = "KindThrowStatement";
const KindTryStatement = "KindTryStatement";
const KindAwaitExpression = "KindAwaitExpression";
const KindThisKeyword = "KindThisKeyword";
const KindThisExpression = "KindThisExpression";
const KindDecorator = "KindDecorator";
const KindUnionType = "KindUnionType";
const KindLiteralType = "KindLiteralType";
const KindTupleType = "KindTupleType";
const KindSyntaxList = "KindSyntaxList";

export function recordPythonFactsBeforeFinalization(
  lifecycle: ExtensionLifecycleContext,
  providerRows: readonly PythonCapabilityOperationRow[],
  jsEnabled = false,
): void {
  const walk: PythonFactWalk = { lifecycle, providerRows, resolving: new Set(), provenSourceTypes: new Map(), jsEnabled };
  const { ast } = lifecycle.compiler;
  const projectStatements = (kindName: string): readonly { statement: Node; sourceFile: SourceFile }[] => {
    const results: { statement: Node; sourceFile: SourceFile }[] = [];
    for (const sourceFile of lifecycle.compiler.getSourceFiles()) {
      if (sourceFile === undefined || ast.getFileName(sourceFile).endsWith(".d.ts")) {
        continue;
      }
      for (const statement of ast.statements(sourceFile)) {
        if (statement !== undefined && ast.kindName(statement) === kindName) {
          results.push({ statement, sourceFile });
        }
      }
    }
    return results;
  };
  // Declaration registration runs before any body walk so use sites resolve
  // project types regardless of file order. Enums have no member types, then
  // interfaces (which may reference enums), then classes.
  for (const { statement } of projectStatements(KindEnumDeclaration)) {
    registerEnumFacts(walk, statement);
  }
  for (const { statement } of projectStatements(KindInterfaceDeclaration)) {
    registerInterfaceFacts(walk, statement);
  }
  for (const { statement } of projectStatements(KindClassDeclaration)) {
    registerClassFacts(walk, statement);
  }
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
      } else if (kind === KindClassDeclaration) {
        recordClassFacts(walk, statement, sourceFile);
      }
    }
  }
}

// Async declarations carry the unwrapped Promise<T> payload as their return
// carrier; the async lowering itself is marked with the async-function fact.
function promiseInnerCarrier(walk: PythonFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  const { ast, checker } = walk.lifecycle.compiler;
  if (ast.kindName(typeNode) !== KindTypeReference) {
    return undefined;
  }
  const nameNode = TypeReferenceNode_TypeName(typeNode) ?? typeNode;
  const symbol = checker.getSymbolAtLocation(nameNode) ?? checker.getResolvedSymbolOrNil(nameNode);
  if (symbol === undefined || checker.getSymbolName(symbol) !== "Promise") {
    return undefined;
  }
  const isLibDeclaration = checker.getSymbolDeclarations(symbol).some((declaration) =>
    declaration !== undefined && ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts"));
  if (!isLibDeclaration) {
    return undefined;
  }
  const [argument] = ast.typeArguments(typeNode);
  return argument === undefined ? undefined : resolveTypeNodeCarrier(walk, argument);
}

function recordFunctionFacts(walk: PythonFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  let returnCarrier: TargetTypeRef | undefined;
  if (ast.hasModifierKind(declaration, "async")) {
    const inner = promiseInnerCarrier(walk, Node_Type(declaration));
    if (inner !== undefined) {
      returnCarrier = inner;
      walk.lifecycle.host.facts.set(declaration, pythonAsyncFunctionFactKey, { isAsync: true }, [
        { message: "python async function" },
      ]);
      const typeNode = Node_Type(declaration);
      if (typeNode !== undefined) {
        setCarrierFact(walk, typeNode, inner);
      }
    }
  } else {
    returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  }
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
  const { ast } = walk.lifecycle.compiler;
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
    const nameNode = Node_Name(declaration);
    const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
    if (nameNode !== undefined && nameKind === KindObjectBindingPattern) {
      recordObjectDestructuringFacts(walk, nameNode, effective);
    } else if (nameNode !== undefined && nameKind === KindArrayBindingPattern) {
      recordArrayDestructuringFacts(walk, nameNode, effective);
    }
  }
}

// Destructuring encoding: each proven binding element carries its own
// element/field carrier plus the read fact the planner replays against the
// initializer (source-field for record/class shapes, list index-read by
// binding position for dense lists).
function plainBindingElements(walk: PythonFactWalk, pattern: Node): readonly { element: Node; name: string }[] | undefined {
  const { ast } = walk.lifecycle.compiler;
  const bindings: { element: Node; name: string }[] = [];
  for (const element of ast.elements(pattern)) {
    if (element === undefined || ast.kindName(element) !== KindBindingElement) {
      return undefined;
    }
    if (Node_DotDotDotToken(element) !== undefined ||
        Node_PropertyName(element) !== undefined ||
        Node_Initializer(element) !== undefined) {
      return undefined;
    }
    const nameNode = ast.name(element);
    if (nameNode === undefined || ast.kindName(nameNode) !== KindIdentifier) {
      return undefined;
    }
    bindings.push({ element, name: ast.text(nameNode) });
  }
  return bindings;
}

function recordObjectDestructuringFacts(walk: PythonFactWalk, pattern: Node, valueCarrier: TargetTypeRef | undefined): void {
  const value = pythonSourceTypeCarrierValue(valueCarrier);
  if (value === undefined || value.shape === "enum") {
    return;
  }
  const shapeDeclaration = provenSourceTypeDeclaration(walk, valueCarrier);
  const bindings = plainBindingElements(walk, pattern);
  if (shapeDeclaration === undefined || bindings === undefined) {
    return;
  }
  // Every binding must map to a proven field before any fact lands.
  const resolved: { element: Node; name: string; carrier: TargetTypeRef }[] = [];
  for (const binding of bindings) {
    const fieldCarrier = shapeFieldCarrier(walk, shapeDeclaration, binding.name);
    if (fieldCarrier === undefined) {
      return;
    }
    resolved.push({ ...binding, carrier: fieldCarrier });
  }
  for (const binding of resolved) {
    const operationId = `tsonic.python.source.field:${binding.name}`;
    recordTargetOperation(walk, binding.element, operationId, "property", binding.name);
    setPythonOperationFact(walk, binding.element, {
      kind: "source-field",
      operationId,
      name: binding.name,
      resultCarrier: binding.carrier,
    });
    setCarrierFact(walk, binding.element, binding.carrier);
  }
}

function recordArrayDestructuringFacts(walk: PythonFactWalk, pattern: Node, valueCarrier: TargetTypeRef | undefined): void {
  const element = pythonListElementCarrier(valueCarrier);
  if (element === undefined) {
    return;
  }
  const bindings = plainBindingElements(walk, pattern);
  if (bindings === undefined) {
    return;
  }
  for (const binding of bindings) {
    const operationId = "tsonic.python.list.index-read";
    recordTargetOperation(walk, binding.element, operationId, "indexer", "[]");
    setPythonOperationFact(walk, binding.element, {
      kind: "list-op",
      operationId,
      op: "index-read",
      resultCarrier: element,
    });
    setCarrierFact(walk, binding.element, element);
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
    if (expression !== undefined) {
      recordExpressionStatementFacts(walk, expression, sourceFile);
    }
    return;
  }
  if (kind === KindThrowStatement) {
    recordThrowFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === KindTryStatement) {
    const tryBlock = TryStatement_TryBlock(statement);
    if (tryBlock !== undefined) {
      recordStatementFacts(walk, tryBlock, sourceFile, returnCarrier);
    }
    const catchClause = TryStatement_CatchClause(statement);
    const catchVariable = CatchClause_VariableDeclaration(catchClause);
    if (catchVariable !== undefined) {
      // Selected error policy: catch bindings carry the Exception identity.
      setCarrierFact(walk, catchVariable, pythonExceptionTargetType());
    }
    const catchBlock = CatchClause_Block(catchClause);
    if (catchBlock !== undefined) {
      recordStatementFacts(walk, catchBlock, sourceFile, returnCarrier);
    }
    const finallyBlock = TryStatement_FinallyBlock(statement);
    if (finallyBlock !== undefined) {
      recordStatementFacts(walk, finallyBlock, sourceFile, returnCarrier);
    }
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
      // Incrementors take the expression-statement lanes: update operators
      // and compound assignments record facts here too.
      recordExpressionStatementFacts(walk, incrementor, sourceFile);
    }
    const body = IterationStatement_Statement(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
}

function recordExpressionStatementFacts(walk: PythonFactWalk, expression: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  if (ast.kindName(expression) === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    const left = BinaryExpression_Left(expression);
    const right = BinaryExpression_Right(expression);
    if (operatorKind === KindEqualsToken) {
      if (left === undefined || right === undefined) {
        return;
      }
      const leftKind = ast.kindName(left);
      if (leftKind === KindElementAccessExpression) {
        recordListIndexWriteFacts(walk, expression, left, right, sourceFile);
        return;
      }
      if (leftKind === KindPropertyAccessExpression) {
        recordThisFieldWriteFacts(walk, left, right, sourceFile);
        return;
      }
      const leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
      resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
      return;
    }
    if (left !== undefined && right !== undefined && ast.kindName(left) === KindIdentifier) {
      const leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
      const rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
      const compound = selectPythonCompoundAssignment(operatorKind, leftCarrier, rightCarrier);
      if (compound !== undefined && leftCarrier !== undefined) {
        recordOperatorFacts(walk, expression, compound, leftCarrier, pythonOperatorCarrierKey(leftCarrier));
        return;
      }
    }
  }
  resolveExpressionCarrier(walk, expression, sourceFile, undefined);
}

// Field writes participate only on `this` receivers inside proven class
// bodies; other property writes (including `.length =`) have no
// static-native lane.
function recordThisFieldWriteFacts(walk: PythonFactWalk, left: Node, right: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  const receiver = Node_Expression(left);
  const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
  if ((receiverKind !== KindThisKeyword && receiverKind !== KindThisExpression) || walk.currentThisCarrier === undefined) {
    return;
  }
  const leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
  if (leftCarrier !== undefined) {
    resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
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
    // fail closed without an owning lane.
    if (pythonPrimitiveTypeName(primitive.kind) === undefined) {
      return undefined;
    }
    return setCarrierFact(walk, typeNode, pythonSourcePrimitiveTargetType(primitive.kind));
  }
  const kind = walk.lifecycle.compiler.ast.kindName(typeNode);
  if (kind === KindTypeReference) {
    const sourceType = sourceTypeCarrierForReference(walk, typeNode);
    if (sourceType !== undefined) {
      return setCarrierFact(walk, typeNode, sourceType);
    }
    const dictType = dictTypeCarrier(walk, typeNode);
    if (dictType !== undefined) {
      return setCarrierFact(walk, typeNode, dictType);
    }
  }
  if (kind === KindArrayType) {
    const element = resolveTypeNodeCarrier(walk, ArrayTypeNode_ElementType(typeNode));
    return element === undefined ? undefined : setCarrierFact(walk, typeNode, pythonListTargetType(element));
  }
  if (kind === KindUnionType) {
    const optional = optionalUnionCarrier(walk, typeNode);
    return optional === undefined ? undefined : setCarrierFact(walk, typeNode, optional);
  }
  if (kind === KindTupleType) {
    const tuple = tupleTypeCarrier(walk, typeNode);
    return tuple === undefined ? undefined : setCarrierFact(walk, typeNode, tuple);
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

// `T | null` (either order) is the only proven nullable shape; `undefined`
// members stay without a lane.
function optionalUnionCarrier(walk: PythonFactWalk, typeNode: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const memberNodes = ast.children(typeNode)
    .filter((child): child is Node => child !== undefined)
    .flatMap((child) => ast.kindName(child) === KindSyntaxList
      ? ast.children(child).filter((entry): entry is Node => entry !== undefined)
      : [child])
    .filter((child) => !ast.kindName(child).endsWith("Token"));
  if (memberNodes.length !== 2) {
    return undefined;
  }
  const isNullMember = (member: Node): boolean => {
    if (ast.kindName(member) !== KindLiteralType) {
      return false;
    }
    const literal = ast.children(member)[0];
    return literal !== undefined && ast.kindName(literal) === KindNullKeyword;
  };
  const nullMember = memberNodes.find(isNullMember);
  const valueMember = memberNodes.find((member) => !isNullMember(member));
  if (nullMember === undefined || valueMember === undefined) {
    return undefined;
  }
  const inner = resolveTypeNodeCarrier(walk, valueMember);
  return inner === undefined ? undefined : pythonOptionalTargetType(inner);
}

// Record<string, T> from the standard library with a proven value carrier is
// the dict lane; other Record instantiations have no lane.
function dictTypeCarrier(walk: PythonFactWalk, typeNode: Node): TargetTypeRef | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const nameNode = TypeReferenceNode_TypeName(typeNode) ?? typeNode;
  const symbol = checker.getSymbolAtLocation(nameNode) ?? checker.getResolvedSymbolOrNil(nameNode);
  if (symbol === undefined || checker.getSymbolName(symbol) !== "Record") {
    return undefined;
  }
  const isLibDeclaration = checker.getSymbolDeclarations(symbol).some((declaration) =>
    declaration !== undefined && ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts"));
  if (!isLibDeclaration) {
    return undefined;
  }
  const [keyArgument, valueArgument] = ast.typeArguments(typeNode);
  if (keyArgument === undefined || ast.kindName(keyArgument) !== KindStringKeyword || valueArgument === undefined) {
    return undefined;
  }
  const value = resolveTypeNodeCarrier(walk, valueArgument);
  return value === undefined ? undefined : pythonDictTargetType(value);
}

// Tuple types need every element proven; the empty tuple stays unmapped (its
// carrier shape is the None identity).
function tupleTypeCarrier(walk: PythonFactWalk, typeNode: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const elementNodes = ast.elements(typeNode).filter((element): element is Node => element !== undefined);
  if (elementNodes.length === 0) {
    return undefined;
  }
  const elements: TargetTypeRef[] = [];
  for (const elementNode of elementNodes) {
    const element = resolveTypeNodeCarrier(walk, elementNode);
    if (element === undefined) {
      return undefined;
    }
    elements.push(element);
  }
  return pythonTupleTargetType(elements);
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
    case KindNullKeyword: {
      // Null carries the expected optional identity so the planner can emit
      // None; without an optional expectation it has no lane.
      if (expected !== undefined && isPythonOptionalCarrier(expected)) {
        return setCarrierFact(walk, expression, expected);
      }
      return undefined;
    }
    case KindTemplateExpression:
    case KindNoSubstitutionTemplateLiteral: {
      return resolveTemplateCarrier(walk, expression, sourceFile, kind);
    }
    case KindTrueKeyword:
    case KindFalseKeyword: {
      return setCarrierFact(walk, expression, boolCarrier);
    }
    case KindIdentifier: {
      return resolveIdentifierCarrier(walk, expression, sourceFile);
    }
    case KindThisKeyword:
    case KindThisExpression: {
      const thisCarrier = walk.currentThisCarrier;
      return thisCarrier === undefined ? undefined : setCarrierFact(walk, expression, thisCarrier);
    }
    case KindArrayLiteralExpression: {
      return resolveArrayLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case KindObjectLiteralExpression: {
      return resolveDictLiteralCarrier(walk, expression, sourceFile, expected) ??
        resolveRecordLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case KindAwaitExpression: {
      return resolveAwaitCarrier(walk, expression, sourceFile);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return resolveUnaryCarrier(walk, expression, sourceFile, expected, kind);
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
  if (walk.jsEnabled && walk.lifecycle.compiler.ast.text(identifier) === "undefined") {
    const type = checker.getTypeAtLocation(identifier);
    if (type !== undefined && walk.lifecycle.compiler.typeShape.isVoidLike(type)) {
      return recordJsUndefinedFacts(walk, identifier);
    }
  }
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
  if (declarationKind !== KindParameter && declarationKind !== KindVariableDeclaration &&
      declarationKind !== KindBindingElement) {
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
  expressionKind: string,
): TargetTypeRef | undefined {
  const operand = Node_Operand(expression);
  if (operand === undefined) {
    return undefined;
  }
  const ast = walk.lifecycle.compiler.ast;
  const operatorText = expressionKind === KindPrefixUnaryExpression
    ? getPrefixUnaryOperatorText(ast, expression)
    : getPostfixUnaryOperatorText(ast, expression);
  if (operatorText === "!" && expressionKind === KindPrefixUnaryExpression) {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, boolCarrier);
    if (operandCarrier !== undefined && isPythonBoolCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "not", boolCarrier, pythonOperatorCarrierKey(boolCarrier));
      return setCarrierFact(walk, expression, boolCarrier);
    }
    return undefined;
  }
  if (operatorText === "-" && expressionKind === KindPrefixUnaryExpression) {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, expected);
    if (operandCarrier !== undefined && isPythonSignedNumericCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "-", operandCarrier, pythonOperatorCarrierKey(operandCarrier));
      return setCarrierFact(walk, expression, operandCarrier);
    }
    return undefined;
  }
  if (operatorText === "++" || operatorText === "--") {
    if (ast.kindName(operand) !== KindIdentifier) {
      return undefined;
    }
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    if (operandCarrier !== undefined && isPythonNumericCarrier(operandCarrier)) {
      const operator = operatorText === "++" ? "+=" : "-=";
      recordOperatorFacts(walk, expression, operator, operandCarrier, pythonOperatorCarrierKey(operandCarrier));
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
  if (operatorKind === KindEqualsEqualsEqualsToken || operatorKind === KindExclamationEqualsEqualsToken) {
    const nullCheck = tryRecordNullCheck(walk, expression, left, right, sourceFile,
      operatorKind === KindExclamationEqualsEqualsToken);
    if (nullCheck !== undefined) {
      return nullCheck;
    }
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
    if (walk.jsEnabled && equalityOperator && leftCarrier !== undefined && rightCarrier !== undefined &&
        (isPythonJsCompatCarrier(leftCarrier) || isPythonJsCompatCarrier(rightCarrier))) {
      // JS strict equality between compat-carrying operands lowers through
      // the runtime algorithm; the call receives both planned operands.
      const operationId = "tsonic.python.js.strict-equal";
      recordTargetOperation(walk, expression, operationId, "method", "strict_equal");
      setPythonOperationFact(walk, expression, {
        kind: "capability-operation",
        operationId,
        operationKind: "method",
        target: { form: "call", import: { style: "from", module: pythonJsRuntimeModule, name: "strict_equal" } },
        resultCarrier: boolCarrier,
      });
      return setCarrierFact(walk, expression, boolCarrier);
    }
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

// Null comparisons against optional-carrying values are identity checks: the
// Python spelling is `is` / `is not` None.
function tryRecordNullCheck(
  walk: PythonFactWalk,
  expression: Node,
  left: Node,
  right: Node,
  sourceFile: SourceFile,
  negated: boolean,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const leftIsNull = ast.kindName(left) === KindNullKeyword;
  const rightIsNull = ast.kindName(right) === KindNullKeyword;
  if (leftIsNull === rightIsNull) {
    return undefined;
  }
  const valueSide = leftIsNull ? right : left;
  const nullSide = leftIsNull ? left : right;
  const valueCarrier = resolveExpressionCarrier(walk, valueSide, sourceFile, undefined);
  if (valueCarrier === undefined || !isPythonOptionalCarrier(valueCarrier)) {
    return undefined;
  }
  resolveExpressionCarrier(walk, nullSide, sourceFile, valueCarrier);
  const operator = negated ? "is not" : "is";
  recordOperatorFacts(walk, expression, operator, boolCarrier, pythonOperatorCarrierKey(valueCarrier));
  return setCarrierFact(walk, expression, boolCarrier);
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
  const providerIdentity = providerCallSignatureIdentity(walk, expression) ??
    providerDeclarationIdentityFor(walk, callee);
  if (providerIdentity !== undefined) {
    const operationKind = expressionKind === KindNewExpression ? "constructor" : "method";
    const row = matchProviderRow(walk.providerRows, providerIdentity, operationKind);
    if (row === undefined) {
      appendProviderOperationDiagnostic(walk, providerIdentity, operationKind);
      return undefined;
    }
    if (row.isAsync === true) {
      // Async rows lower only as await operands; an unawaited call records
      // nothing and fails closed downstream.
      return undefined;
    }
    const receiver = ast.kindName(callee) === KindPropertyAccessExpression ? Node_Expression(callee) : undefined;
    if (!providerCallShapeMatchesRow(walk, receiver, row)) {
      return undefined;
    }
    if (!providerArgumentContractHolds(walk, row, callArguments, sourceFile)) {
      return undefined;
    }
    if (receiver !== undefined && row.target.form !== "static-method") {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    for (const [index, argument] of callArguments.entries()) {
      if (argument !== undefined) {
        resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[index]);
      }
    }
    recordProviderOperationFacts(walk, expression, row, providerIdentity);
    return setCarrierFact(walk, expression, row.resultCarrier);
  }
  const sourceCallLike = trySourceCallLike(walk, expression, callee, callArguments, sourceFile, expressionKind);
  if (sourceCallLike !== undefined) {
    return sourceCallLike;
  }
  if (expressionKind === KindNewExpression) {
    if (walk.jsEnabled) {
      const jsConstructor = selectJsConstructorForNode(walk, expression, callee, callArguments, sourceFile);
      if (jsConstructor !== undefined) {
        return applyJsSelection(walk, expression, jsConstructor, sourceFile, callArguments);
      }
    }
    return undefined;
  }
  const listMethod = tryListMethodCall(walk, expression, callee, callArguments, sourceFile);
  if (listMethod !== undefined) {
    return listMethod;
  }
  if (walk.jsEnabled) {
    const jsCall = selectJsCallForNode(walk, callee, sourceFile);
    if (jsCall !== undefined) {
      return applyJsSelection(walk, expression, jsCall, sourceFile, callArguments);
    }
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

function tryListMethodCall(
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
  const methodName = nameNode === undefined ? "" : ast.text(nameNode);
  if (methodName !== "push" && methodName !== "includes" && methodName !== "indexOf") {
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
  if (methodName === "push") {
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
  // Search compares by value; only primitive and str elements share equality
  // semantics between the source language and Python.
  if (element.kind !== "source-primitive" && !isPythonStrCarrier(element)) {
    return undefined;
  }
  if (methodName === "includes") {
    const operationId = "tsonic.python.list.includes";
    recordTargetOperation(walk, expression, operationId, "method", "in");
    setPythonOperationFact(walk, expression, {
      kind: "list-op",
      operationId,
      op: "includes",
      resultCarrier: boolCarrier,
    });
    return setCarrierFact(walk, expression, boolCarrier);
  }
  const operationId = "tsonic.python.list.index-of";
  recordTargetOperation(walk, expression, operationId, "method", "index");
  setPythonOperationFact(walk, expression, {
    kind: "list-op",
    operationId,
    op: "index-of",
    resultCarrier: listLengthCarrier,
  });
  return setCarrierFact(walk, expression, listLengthCarrier);
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
  if (isPythonExceptionCarrier(receiverCarrier)) {
    const nameNode = Node_Name(expression);
    if (nameNode !== undefined && walk.lifecycle.compiler.ast.text(nameNode) === "message") {
      // Selected error policy: `.message` reads lower to str(error).
      const operationId = "tsonic.python.error.message";
      recordTargetOperation(walk, expression, operationId, "property", "str");
      setPythonOperationFact(walk, expression, {
        kind: "capability-operation",
        operationId,
        operationKind: "property",
        target: { form: "builtin-call", name: "str" },
        resultCarrier: pythonStrTargetType(),
      });
      return setCarrierFact(walk, expression, pythonStrTargetType());
    }
    return undefined;
  }
  const sourceMember = trySourceMemberAccess(walk, expression);
  if (sourceMember !== undefined) {
    return sourceMember;
  }
  if (walk.jsEnabled) {
    const identity = libMemberIdentityFor(walk, expression);
    if (identity !== undefined) {
      const selection = selectJsSurfaceOperation({
        ownerName: identity.ownerName,
        memberName: identity.memberName,
        operationKind: "property",
        ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      });
      if (selection !== undefined) {
        return applyJsSelection(walk, expression, selection, sourceFile, []);
      }
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
  if (isPythonTupleCarrier(receiverCarrier)) {
    // Tuples read only through numeric literal indexes: the element carrier
    // is positional and a dynamic index has no single proven carrier.
    const { ast } = walk.lifecycle.compiler;
    if (argument === undefined || ast.kindName(argument) !== KindNumericLiteral) {
      return undefined;
    }
    const indexText = ast.text(argument);
    if (!/^[0-9]+$/u.test(indexText)) {
      return undefined;
    }
    const index = Number.parseInt(indexText, 10);
    const tupleElement = receiverCarrier.elements[index];
    if (tupleElement === undefined) {
      return undefined;
    }
    setCarrierFact(walk, argument, listLengthCarrier);
    const operationId = `tsonic.python.tuple.index.${index}`;
    recordTargetOperation(walk, expression, operationId, "indexer", "[]");
    setPythonOperationFact(walk, expression, {
      kind: "tuple-index",
      operationId,
      index,
      resultCarrier: tupleElement,
    });
    return setCarrierFact(walk, expression, tupleElement);
  }
  const dictValue = pythonDictValueCarrier(receiverCarrier);
  if (dictValue !== undefined) {
    const keyCarrier = argument === undefined
      ? undefined
      : resolveExpressionCarrier(walk, argument, sourceFile, pythonStrTargetType());
    if (!isPythonStrCarrier(keyCarrier)) {
      return undefined;
    }
    const operationId = "tsonic.python.dict.index-read";
    recordTargetOperation(walk, expression, operationId, "indexer", "[]");
    setPythonOperationFact(walk, expression, {
      kind: "dict-op",
      operationId,
      op: "index-read",
      resultCarrier: dictValue,
    });
    return setCarrierFact(walk, expression, dictValue);
  }
  if (walk.jsEnabled && isPythonJsCompatCarrier(receiverCarrier)) {
    // Keyed reads on compat carriers: positional slots on arrays and typed
    // arrays, property keys on dynamic values.
    const selection = selectJsSurfaceOperation({
      ownerName: "Array",
      memberName: "index",
      operationKind: "indexer",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    });
    if (selection !== undefined) {
      return applyJsSelection(walk, expression, selection, sourceFile, argument === undefined ? [] : [argument]);
    }
    return undefined;
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
  const index = ElementAccessExpression_ArgumentExpression(left);
  const element = pythonListElementCarrier(receiverCarrier);
  if (element !== undefined) {
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
    return;
  }
  const dictValue = pythonDictValueCarrier(receiverCarrier);
  if (dictValue !== undefined) {
    const keyCarrier = index === undefined
      ? undefined
      : resolveExpressionCarrier(walk, index, sourceFile, pythonStrTargetType());
    if (!isPythonStrCarrier(keyCarrier)) {
      return;
    }
    const valueCarrier = resolveExpressionCarrier(walk, right, sourceFile, dictValue);
    if (valueCarrier === undefined || !sameCarrier(valueCarrier, dictValue)) {
      return;
    }
    const operationId = "tsonic.python.dict.index-write";
    recordTargetOperation(walk, assignment, operationId, "indexer", "[]=");
    setPythonOperationFact(walk, assignment, {
      kind: "dict-op",
      operationId,
      op: "index-write",
      resultCarrier: pythonNoneTargetType(),
    });
  }
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
    // Sparse literals have no static-native lane; the JS surface builds a
    // JsArray with the holes lowered as undefined attributes.
    return walk.jsEnabled
      ? resolveSparseArrayLiteralCarrier(walk, expression, elements, sourceFile, expected)
      : undefined;
  }
  if (expected !== undefined && isPythonTupleCarrier(expected)) {
    if (elements.length !== expected.elements.length) {
      return undefined;
    }
    for (const [index, element] of elements.entries()) {
      const elementExpectation = expected.elements[index];
      const carrier = elementExpectation === undefined
        ? undefined
        : resolveExpressionCarrier(walk, element, sourceFile, elementExpectation);
      if (carrier === undefined || elementExpectation === undefined || !sameCarrier(carrier, elementExpectation)) {
        return undefined;
      }
    }
    setPythonOperationFact(walk, expression, {
      kind: "tuple-literal",
      operationId: "tsonic.python.tuple.literal",
      resultCarrier: expected,
    });
    return setCarrierFact(walk, expression, expected);
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

// Sparse literals build a JsArray from every position in order: holes carry
// their own undefined attribute facts, present elements must share one
// proven carrier.
function resolveSparseArrayLiteralCarrier(
  walk: PythonFactWalk,
  expression: Node,
  elements: readonly Node[],
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const presentElements = elements.filter((element) => ast.kindName(element) !== KindOmittedExpression);
  let elementCarrier = expected !== undefined && isPythonJsArrayCarrier(expected) && expected.kind === "target-named"
    ? expected.typeArguments?.[0]
    : undefined;
  if (elementCarrier === undefined) {
    for (const element of presentElements) {
      const carrier = resolveExpressionCarrier(walk, element, sourceFile, undefined);
      if (carrier !== undefined) {
        elementCarrier = carrier;
        break;
      }
    }
  }
  if (elementCarrier === undefined && presentElements.length > 0 &&
      presentElements.every((element) => ast.kindName(element) === KindNumericLiteral)) {
    elementCarrier = pythonSourcePrimitiveTargetType("float64");
  }
  if (elementCarrier === undefined) {
    return undefined;
  }
  for (const element of elements) {
    if (ast.kindName(element) === KindOmittedExpression) {
      recordJsUndefinedFacts(walk, element);
      continue;
    }
    const carrier = resolveExpressionCarrier(walk, element, sourceFile, elementCarrier);
    if (carrier === undefined || !sameCarrier(carrier, elementCarrier)) {
      return undefined;
    }
  }
  const resultCarrier = pythonJsArrayTargetType(elementCarrier);
  const operationId = "tsonic.python.js.Array.literal.sparse";
  recordTargetOperation(walk, expression, operationId, "constructor", "JsArray");
  setPythonOperationFact(walk, expression, {
    kind: "capability-operation",
    operationId,
    operationKind: "constructor",
    target: { form: "call", import: { style: "from", module: pythonJsRuntimeModule, name: "JsArray" } },
    resultCarrier,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

// Template literals lower to f-strings when every substitution carries a
// proven str, numeric, or bool carrier; anything else records nothing.
function resolveTemplateCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expressionKind: string,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (expressionKind === KindTemplateExpression) {
    const spans: Node[] = [];
    ast.forEachChild(expression, (child) => {
      if (child !== undefined && ast.kindName(child) === KindTemplateSpan) {
        spans.push(child);
      }
    });
    for (const span of spans) {
      const substitution = Node_Expression(span);
      const carrier = substitution === undefined
        ? undefined
        : resolveExpressionCarrier(walk, substitution, sourceFile, undefined);
      if (carrier === undefined ||
          (!isPythonStrCarrier(carrier) && !isPythonNumericCarrier(carrier) && !isPythonBoolCarrier(carrier))) {
        return undefined;
      }
    }
  }
  setPythonOperationFact(walk, expression, {
    kind: "string-template",
    operationId: "tsonic.python.string.template",
    resultCarrier: pythonStrTargetType(),
  });
  return setCarrierFact(walk, expression, pythonStrTargetType());
}

// Object literals against a proven Record<string, T> expectation lower to
// dict literals: every entry must be a plain property assignment with an
// identifier or string-literal key and a value matching the value carrier.
function resolveDictLiteralCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (expected === undefined || !isPythonDictCarrier(expected)) {
    return undefined;
  }
  const valueCarrier = pythonDictValueCarrier(expected);
  if (valueCarrier === undefined) {
    return undefined;
  }
  const { ast } = walk.lifecycle.compiler;
  const seenKeys = new Set<string>();
  for (const property of ast.properties(expression)) {
    if (property === undefined || ast.kindName(property) !== KindPropertyAssignment) {
      return undefined;
    }
    const nameNode = ast.name(property);
    const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
    if (nameNode === undefined || (nameKind !== KindIdentifier && nameKind !== KindStringLiteral)) {
      return undefined;
    }
    const key = ast.text(nameNode);
    if (key.length === 0 || seenKeys.has(key)) {
      return undefined;
    }
    seenKeys.add(key);
    const initializer = Node_Initializer(property);
    const entryCarrier = initializer === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initializer, sourceFile, valueCarrier);
    if (entryCarrier === undefined || !sameCarrier(entryCarrier, valueCarrier)) {
      return undefined;
    }
  }
  setPythonOperationFact(walk, expression, {
    kind: "dict-literal",
    operationId: "tsonic.python.dict.literal",
    valueCarrier,
    resultCarrier: expected,
  });
  return setCarrierFact(walk, expression, expected);
}

// --- Project-source types: classes, enums, records ---------------------------

function sourceTypeKey(fileName: string, typeName: string): string {
  return `${fileName}::${typeName}`;
}

function projectDeclarationFor(walk: PythonFactWalk, reference: Node): Node | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  const aliased = safeAliasedSymbol(checker, symbol) ?? symbol;
  const declaration = checker.getSymbolValueDeclaration(aliased) ??
    checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(aliased) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
  if (declaration === undefined) {
    return undefined;
  }
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return fileName.endsWith(".d.ts") ? undefined : declaration;
}

function sourceTypeCarrierForDeclaration(walk: PythonFactWalk, declaration: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(declaration);
  const shape = kind === KindClassDeclaration
    ? "class"
    : kind === KindEnumDeclaration
      ? "enum"
      : kind === KindInterfaceDeclaration
        ? "record"
        : undefined;
  if (shape === undefined) {
    return undefined;
  }
  const nameNode = ast.name(declaration);
  const typeName = nameNode === undefined ? "" : ast.text(nameNode);
  if (typeName.length === 0) {
    return undefined;
  }
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return pythonSourceTypeCarrier(fileName, typeName, shape);
}

function isProvenSourceTypeDeclaration(walk: PythonFactWalk, declaration: Node): boolean {
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  const value = pythonSourceTypeCarrierValue(carrier);
  return value !== undefined && walk.provenSourceTypes.get(sourceTypeKey(value.fileName, value.typeName)) === declaration;
}

function provenSourceTypeDeclaration(walk: PythonFactWalk, carrier: TargetTypeRef | undefined): Node | undefined {
  const value = pythonSourceTypeCarrierValue(carrier);
  return value === undefined ? undefined : walk.provenSourceTypes.get(sourceTypeKey(value.fileName, value.typeName));
}

function sourceTypeCarrierForReference(walk: PythonFactWalk, typeNode: Node): TargetTypeRef | undefined {
  const nameNode = TypeReferenceNode_TypeName(typeNode) ?? walk.lifecycle.compiler.ast.name(typeNode) ?? typeNode;
  const declaration = projectDeclarationFor(walk, nameNode);
  if (declaration === undefined || !isProvenSourceTypeDeclaration(walk, declaration)) {
    return undefined;
  }
  return sourceTypeCarrierForDeclaration(walk, declaration);
}

function shapeFieldCarrier(walk: PythonFactWalk, shapeDeclaration: Node, fieldName: string): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  for (const member of ast.members(shapeDeclaration)) {
    if (member === undefined) {
      continue;
    }
    const memberKind = ast.kindName(member);
    if (memberKind !== KindPropertyDeclaration && memberKind !== KindPropertySignature) {
      continue;
    }
    const nameNode = ast.name(member);
    if (nameNode === undefined || ast.text(nameNode) !== fieldName) {
      continue;
    }
    return walk.lifecycle.host.facts.get(member, runtimeCarrierFactKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(member));
  }
  return undefined;
}

function safeConstantValue(
  checker: PythonFactWalk["lifecycle"]["compiler"]["checker"],
  node: Node,
): unknown {
  try {
    return checker.getConstantValue(node);
  } catch {
    return undefined;
  }
}

// Numeric-constant enums only; string or computed members leave the whole
// declaration unproven.
function registerEnumFacts(walk: PythonFactWalk, declaration: Node): void {
  const { ast, checker } = walk.lifecycle.compiler;
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  const value = pythonSourceTypeCarrierValue(carrier);
  if (carrier === undefined || value === undefined) {
    return;
  }
  for (const member of ast.members(declaration)) {
    if (member === undefined || ast.kindName(member) !== KindEnumMember) {
      return;
    }
    const nameNode = ast.name(member);
    if (nameNode === undefined || ast.kindName(nameNode) !== KindIdentifier) {
      return;
    }
    const constant = safeConstantValue(checker, member);
    if (typeof constant !== "number" || !Number.isSafeInteger(constant)) {
      return;
    }
  }
  setCarrierFact(walk, declaration, carrier);
  walk.provenSourceTypes.set(sourceTypeKey(value.fileName, value.typeName), declaration);
}

// Record shapes: interfaces whose members are all plain, required property
// signatures with proven carriers.
function registerInterfaceFacts(walk: PythonFactWalk, declaration: Node): void {
  const { ast } = walk.lifecycle.compiler;
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  const value = pythonSourceTypeCarrierValue(carrier);
  if (carrier === undefined || value === undefined) {
    return;
  }
  if (ast.typeParameters(declaration).some((parameter) => parameter !== undefined) ||
      ast.extendsHeritageElements(declaration).some((clause) => clause !== undefined)) {
    return;
  }
  const fields: { member: Node; carrier: TargetTypeRef }[] = [];
  for (const member of ast.members(declaration)) {
    if (member === undefined || ast.kindName(member) !== KindPropertySignature) {
      return;
    }
    if (Node_PostfixToken(member) !== undefined) {
      return;
    }
    const nameNode = ast.name(member);
    if (nameNode === undefined || ast.kindName(nameNode) !== KindIdentifier) {
      return;
    }
    const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
    if (fieldCarrier === undefined) {
      return;
    }
    fields.push({ member, carrier: fieldCarrier });
  }
  setCarrierFact(walk, declaration, carrier);
  for (const field of fields) {
    setCarrierFact(walk, field.member, field.carrier);
  }
  walk.provenSourceTypes.set(sourceTypeKey(value.fileName, value.typeName), declaration);
}

function parameterIsProven(walk: PythonFactWalk, parameter: Node): boolean {
  const { ast } = walk.lifecycle.compiler;
  // Parameter properties, decorators, rest/optional/defaulted parameters
  // leave the declaration unproven.
  if (ast.modifiers(parameter).some((modifier) => modifier !== undefined)) {
    return false;
  }
  if (Node_DotDotDotToken(parameter) !== undefined ||
      Node_QuestionToken(parameter) !== undefined ||
      Node_Initializer(parameter) !== undefined) {
    return false;
  }
  const nameNode = ast.name(parameter);
  if (nameNode === undefined || ast.kindName(nameNode) !== KindIdentifier) {
    return false;
  }
  return resolveTypeNodeCarrier(walk, Node_Type(parameter)) !== undefined;
}

function classDeclarationIsProven(walk: PythonFactWalk, declaration: Node): boolean {
  const { ast } = walk.lifecycle.compiler;
  if (ast.typeParameters(declaration).some((parameter) => parameter !== undefined) ||
      ast.extendsHeritageElements(declaration).some((clause) => clause !== undefined) ||
      ast.implementsHeritageElements(declaration).some((clause) => clause !== undefined) ||
      ast.hasModifierKind(declaration, "abstract") ||
      ast.modifiers(declaration).some((modifier) => modifier !== undefined && ast.kindName(modifier) === KindDecorator)) {
    return false;
  }
  let constructorCount = 0;
  for (const member of ast.members(declaration)) {
    if (member === undefined) {
      return false;
    }
    const memberKind = ast.kindName(member);
    if (memberKind === KindSemicolonClassElement) {
      continue;
    }
    if (ast.modifiers(member).some((modifier) => modifier !== undefined && ast.kindName(modifier) === KindDecorator)) {
      return false;
    }
    if (memberKind === KindPropertyDeclaration) {
      // Minimum field lane: annotated instance fields assigned in the
      // constructor body; declaration-site initializers stay unproven.
      if (ast.hasModifierKind(member, "static") ||
          Node_PostfixToken(member) !== undefined ||
          Node_Initializer(member) !== undefined) {
        return false;
      }
      const nameNode = ast.name(member);
      if (nameNode === undefined || ast.kindName(nameNode) !== KindIdentifier) {
        return false;
      }
      if (resolveTypeNodeCarrier(walk, Node_Type(member)) === undefined) {
        return false;
      }
      continue;
    }
    if (memberKind === KindConstructor || memberKind === KindMethodDeclaration) {
      if (memberKind === KindConstructor) {
        constructorCount += 1;
        if (constructorCount > 1) {
          return false;
        }
      }
      if (ast.body(member) === undefined) {
        return false;
      }
      if (memberKind === KindMethodDeclaration) {
        if (ast.typeParameters(member).some((parameter) => parameter !== undefined) ||
            Node_PostfixToken(member) !== undefined) {
          return false;
        }
        const nameNode = ast.name(member);
        if (nameNode === undefined || ast.kindName(nameNode) !== KindIdentifier) {
          return false;
        }
        const methodReturnCarrier = ast.hasModifierKind(member, "async")
          ? promiseInnerCarrier(walk, Node_Type(member))
          : resolveTypeNodeCarrier(walk, Node_Type(member));
        if (methodReturnCarrier === undefined) {
          return false;
        }
      }
      for (const parameter of ast.parameters(member)) {
        if (parameter === undefined || !parameterIsProven(walk, parameter)) {
          return false;
        }
      }
      continue;
    }
    // Getters/setters, index signatures, static blocks and every other
    // member shape leave the whole class unproven.
    return false;
  }
  return true;
}

function registerClassFacts(walk: PythonFactWalk, declaration: Node): void {
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  const value = pythonSourceTypeCarrierValue(carrier);
  if (carrier === undefined || value === undefined) {
    return;
  }
  const key = sourceTypeKey(value.fileName, value.typeName);
  if (walk.provenSourceTypes.has(key)) {
    return;
  }
  // Provisional registration lets member signatures reference the class
  // itself; a failed proof removes it before any use-site lane opens.
  walk.provenSourceTypes.set(key, declaration);
  if (!classDeclarationIsProven(walk, declaration)) {
    walk.provenSourceTypes.delete(key);
    return;
  }
  setCarrierFact(walk, declaration, carrier);
}

function recordClassFacts(walk: PythonFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier === undefined || provenSourceTypeDeclaration(walk, carrier) !== declaration) {
    return;
  }
  const previousThis = walk.currentThisCarrier;
  walk.currentThisCarrier = carrier;
  for (const member of ast.members(declaration)) {
    if (member === undefined) {
      continue;
    }
    const memberKind = ast.kindName(member);
    if (memberKind === KindPropertyDeclaration) {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
      continue;
    }
    if (memberKind === KindConstructor || memberKind === KindMethodDeclaration) {
      for (const parameter of ast.parameters(member)) {
        if (parameter === undefined) {
          continue;
        }
        const parameterCarrier = resolveTypeNodeCarrier(walk, Node_Type(parameter));
        if (parameterCarrier !== undefined) {
          setCarrierFact(walk, parameter, parameterCarrier);
        }
      }
      let returnCarrier: TargetTypeRef | undefined;
      if (memberKind === KindMethodDeclaration) {
        if (ast.hasModifierKind(member, "async")) {
          const inner = promiseInnerCarrier(walk, Node_Type(member));
          if (inner !== undefined) {
            returnCarrier = inner;
            walk.lifecycle.host.facts.set(member, pythonAsyncFunctionFactKey, { isAsync: true }, [
              { message: "python async method" },
            ]);
            const typeNode = Node_Type(member);
            if (typeNode !== undefined) {
              setCarrierFact(walk, typeNode, inner);
            }
          }
        } else {
          returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
        }
      }
      const body = ast.body(member);
      if (body !== undefined) {
        for (const statement of ast.statements(body)) {
          if (statement !== undefined) {
            recordStatementFacts(walk, statement, sourceFile, returnCarrier);
          }
        }
      }
    }
  }
  walk.currentThisCarrier = previousThis;
}

// Contextually-typed object literals against a proven record shape. Field
// order in the fact follows the shape declaration; the literal must assign
// every field exactly once with a matching carrier.
function resolveRecordLiteralCarrier(
  walk: PythonFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const value = pythonSourceTypeCarrierValue(expected);
  if (expected === undefined || value === undefined || value.shape !== "record") {
    return undefined;
  }
  const shapeDeclaration = provenSourceTypeDeclaration(walk, expected);
  if (shapeDeclaration === undefined) {
    return undefined;
  }
  const shapeFields: { name: string; carrier: TargetTypeRef }[] = [];
  for (const member of ast.members(shapeDeclaration)) {
    if (member === undefined) {
      return undefined;
    }
    const nameNode = ast.name(member);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    const fieldCarrier = walk.lifecycle.host.facts.get(member, runtimeCarrierFactKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(member));
    if (fieldName.length === 0 || fieldCarrier === undefined) {
      return undefined;
    }
    shapeFields.push({ name: fieldName, carrier: fieldCarrier });
  }
  const initializers = new Map<string, Node>();
  for (const property of ast.properties(expression)) {
    if (property === undefined) {
      return undefined;
    }
    const propertyKind = ast.kindName(property);
    if (propertyKind !== KindPropertyAssignment && propertyKind !== KindShorthandPropertyAssignment) {
      return undefined;
    }
    const nameNode = ast.name(property);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    // Shorthand assignments read the value from the name binding itself.
    const initializer = propertyKind === KindShorthandPropertyAssignment ? nameNode : Node_Initializer(property);
    if (fieldName.length === 0 || initializer === undefined || initializers.has(fieldName)) {
      return undefined;
    }
    initializers.set(fieldName, initializer);
  }
  if (initializers.size !== shapeFields.length || shapeFields.some((field) => !initializers.has(field.name))) {
    return undefined;
  }
  for (const field of shapeFields) {
    const initializer = initializers.get(field.name);
    const fieldValueCarrier = initializer === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initializer, sourceFile, field.carrier);
    if (fieldValueCarrier === undefined || !sameCarrier(fieldValueCarrier, field.carrier)) {
      return undefined;
    }
  }
  setPythonOperationFact(walk, expression, {
    kind: "record-literal",
    operationId: "tsonic.python.record.literal",
    resultCarrier: expected,
    fieldNames: shapeFields.map((field) => field.name),
  });
  return setCarrierFact(walk, expression, expected);
}

function trySourceMemberAccess(walk: PythonFactWalk, expression: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const memberDeclaration = projectDeclarationFor(walk, expression);
  if (memberDeclaration === undefined) {
    return undefined;
  }
  const memberKind = ast.kindName(memberDeclaration);
  if (memberKind === KindPropertyDeclaration || memberKind === KindPropertySignature) {
    const owner = ast.parent(memberDeclaration);
    if (owner === undefined || !isProvenSourceTypeDeclaration(walk, owner)) {
      return undefined;
    }
    const fieldCarrier = walk.lifecycle.host.facts.get(memberDeclaration, runtimeCarrierFactKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(memberDeclaration));
    const nameNode = ast.name(memberDeclaration);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    if (fieldCarrier === undefined || fieldName.length === 0) {
      return undefined;
    }
    const operationId = `tsonic.python.source.field:${fieldName}`;
    recordTargetOperation(walk, expression, operationId, "property", fieldName);
    setPythonOperationFact(walk, expression, {
      kind: "source-field",
      operationId,
      name: fieldName,
      resultCarrier: fieldCarrier,
    });
    return setCarrierFact(walk, expression, fieldCarrier);
  }
  if (memberKind === KindEnumMember) {
    const enumDeclaration = ast.parent(memberDeclaration);
    if (enumDeclaration === undefined || !isProvenSourceTypeDeclaration(walk, enumDeclaration)) {
      return undefined;
    }
    const enumCarrier = sourceTypeCarrierForDeclaration(walk, enumDeclaration);
    const nameNode = ast.name(memberDeclaration);
    const memberName = nameNode === undefined ? "" : ast.text(nameNode);
    if (enumCarrier === undefined || memberName.length === 0) {
      return undefined;
    }
    const operationId = `tsonic.python.source.enum-member:${memberName}`;
    recordTargetOperation(walk, expression, operationId, "property", memberName);
    setPythonOperationFact(walk, expression, {
      kind: "source-enum-member",
      operationId,
      name: memberName,
      resultCarrier: enumCarrier,
    });
    return setCarrierFact(walk, expression, enumCarrier);
  }
  return undefined;
}

function trySourceCallLike(
  walk: PythonFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expressionKind: string,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const resolveArguments = (parameters: readonly (Node | undefined)[]): void => {
    for (const [index, argument] of callArguments.entries()) {
      if (argument === undefined) {
        continue;
      }
      const parameter = parameters[index];
      const expected = parameter === undefined
        ? undefined
        : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(parameter));
      resolveExpressionCarrier(walk, argument, sourceFile, expected);
    }
  };
  if (expressionKind === KindNewExpression) {
    const classDeclaration = projectDeclarationFor(walk, callee);
    if (classDeclaration === undefined || ast.kindName(classDeclaration) !== KindClassDeclaration ||
        !isProvenSourceTypeDeclaration(walk, classDeclaration)) {
      return undefined;
    }
    const classCarrier = sourceTypeCarrierForDeclaration(walk, classDeclaration);
    if (classCarrier === undefined) {
      return undefined;
    }
    const constructorMember = ast.members(classDeclaration).find((member) =>
      member !== undefined && ast.kindName(member) === KindConstructor);
    resolveArguments(constructorMember === undefined ? [] : ast.parameters(constructorMember));
    const operationId = "tsonic.python.source.constructor";
    recordTargetOperation(walk, expression, operationId, "constructor", "__init__");
    setPythonOperationFact(walk, expression, {
      kind: "source-constructor",
      operationId,
      resultCarrier: classCarrier,
    });
    return setCarrierFact(walk, expression, classCarrier);
  }
  if (ast.kindName(callee) !== KindPropertyAccessExpression) {
    return undefined;
  }
  const methodDeclaration = projectDeclarationFor(walk, callee);
  if (methodDeclaration === undefined || ast.kindName(methodDeclaration) !== KindMethodDeclaration) {
    return undefined;
  }
  const classDeclaration = ast.parent(methodDeclaration);
  if (classDeclaration === undefined || !isProvenSourceTypeDeclaration(walk, classDeclaration)) {
    return undefined;
  }
  const isStaticMethod = ast.hasModifierKind(methodDeclaration, "static");
  const receiver = Node_Expression(callee);
  if (receiver !== undefined && !isStaticMethod) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  resolveArguments(ast.parameters(methodDeclaration));
  const returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(methodDeclaration));
  const nameNode = ast.name(methodDeclaration);
  const methodName = nameNode === undefined ? "" : ast.text(nameNode);
  if (returnCarrier === undefined || methodName.length === 0) {
    return undefined;
  }
  if (isStaticMethod) {
    const typeCarrier = sourceTypeCarrierForDeclaration(walk, classDeclaration);
    if (typeCarrier === undefined) {
      return undefined;
    }
    const operationId = `tsonic.python.source.static-method:${methodName}`;
    recordTargetOperation(walk, expression, operationId, "method", methodName);
    setPythonOperationFact(walk, expression, {
      kind: "source-static-method",
      operationId,
      name: methodName,
      typeCarrier,
      resultCarrier: returnCarrier,
    });
    return setCarrierFact(walk, expression, returnCarrier);
  }
  const operationId = `tsonic.python.source.method:${methodName}`;
  recordTargetOperation(walk, expression, operationId, "method", methodName);
  setPythonOperationFact(walk, expression, {
    kind: "source-method",
    operationId,
    name: methodName,
    resultCarrier: returnCarrier,
  });
  return setCarrierFact(walk, expression, returnCarrier);
}

// --- Error model --------------------------------------------------------------

// `throw new Error(message)` with a proven str message and rethrows of
// Exception-carrying bindings record throw facts; anything else records
// nothing.
function recordThrowFacts(walk: PythonFactWalk, statement: Node, sourceFile: SourceFile): void {
  const { ast, checker } = walk.lifecycle.compiler;
  const expression = Node_Expression(statement);
  if (expression === undefined) {
    return;
  }
  const kind = ast.kindName(expression);
  if (kind === KindIdentifier) {
    const carrier = resolveExpressionCarrier(walk, expression, sourceFile, undefined);
    if (isPythonExceptionCarrier(carrier)) {
      setPythonOperationFact(walk, statement, { kind: "throw-op", operationId: "tsonic.python.error.rethrow" });
    }
    return;
  }
  if (kind !== KindNewExpression) {
    return;
  }
  const callee = Node_Expression(expression);
  const symbol = callee === undefined
    ? undefined
    : checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined || checker.getSymbolName(symbol) !== "Error") {
    return;
  }
  const isLibError = checker.getSymbolDeclarations(symbol).some((declaration) =>
    declaration !== undefined && ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts"));
  if (!isLibError) {
    return;
  }
  const callArguments = ast.arguments(expression);
  if (callArguments.length !== 1) {
    return;
  }
  const [message] = callArguments;
  const messageCarrier = message === undefined
    ? undefined
    : resolveExpressionCarrier(walk, message, sourceFile, pythonStrTargetType());
  if (!isPythonStrCarrier(messageCarrier)) {
    return;
  }
  setPythonOperationFact(walk, statement, { kind: "throw-op", operationId: "tsonic.python.error.throw" });
}

// --- Async/await ---------------------------------------------------------------

// `await` owns the async call lanes: the awaited call must target a proven
// project async function or an async provider method row, and the result
// carrier is the awaited payload.
function resolveAwaitCarrier(walk: PythonFactWalk, expression: Node, sourceFile: SourceFile): TargetTypeRef | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const operand = unwrapParenthesized(ast, Node_Expression(expression));
  if (operand === undefined || ast.kindName(operand) !== KindCallExpression) {
    return undefined;
  }
  const callee = Node_Expression(operand);
  if (callee === undefined) {
    return undefined;
  }
  const providerAwait = tryAsyncProviderAwait(walk, expression, operand, callee, sourceFile);
  if (providerAwait !== undefined) {
    return providerAwait;
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
  if (ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts") ||
      !ast.hasModifierKind(declaration, "async")) {
    return undefined;
  }
  const inner = promiseInnerCarrier(walk, Node_Type(declaration));
  if (inner === undefined) {
    return undefined;
  }
  const parameters = ast.parameters(declaration);
  for (const [index, argument] of ast.arguments(operand).entries()) {
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
  setPythonOperationFact(walk, expression, {
    kind: "await-op",
    operationId: "tsonic.python.async.await",
    resultCarrier: inner,
  });
  return setCarrierFact(walk, expression, inner);
}

// Awaited calls to async provider method rows: the provider-operation fact
// lands on the call, the await-op fact on the enclosing await expression,
// and the row's result carrier is the awaited payload. The source-side
// declaration types the export as Promise<T>; expectations come from the
// row's parameter carriers, never from the source types.
function tryAsyncProviderAwait(
  walk: PythonFactWalk,
  expression: Node,
  operand: Node,
  callee: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const providerIdentity = providerCallSignatureIdentity(walk, operand) ??
    providerDeclarationIdentityFor(walk, callee);
  if (providerIdentity === undefined) {
    return undefined;
  }
  const row = matchProviderRow(walk.providerRows, providerIdentity, "method");
  if (row === undefined || row.isAsync !== true) {
    return undefined;
  }
  const receiver = ast.kindName(callee) === KindPropertyAccessExpression ? Node_Expression(callee) : undefined;
  if (!providerCallShapeMatchesRow(walk, receiver, row)) {
    return undefined;
  }
  if (!providerArgumentContractHolds(walk, row, ast.arguments(operand), sourceFile)) {
    return undefined;
  }
  if (receiver !== undefined && row.target.form !== "static-method") {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  for (const [index, argument] of ast.arguments(operand).entries()) {
    if (argument !== undefined) {
      resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[index]);
    }
  }
  recordProviderOperationFacts(walk, operand, row, providerIdentity);
  setPythonOperationFact(walk, expression, {
    kind: "await-op",
    operationId: "tsonic.python.async.await",
    resultCarrier: row.resultCarrier,
  });
  return setCarrierFact(walk, expression, row.resultCarrier);
}

// --- JS surface lanes ---------------------------------------------------------

interface PythonLibMemberIdentity {
  readonly ownerName: string;
  readonly memberName: string;
}

// Identity of a selected lib declaration member: the resolved symbol's
// declaration must live in a non-capability .d.ts file; the owner is the
// enclosing interface declaration. Names are read from the declaration
// model, never from the user expression.
function libMemberIdentityFor(walk: PythonFactWalk, reference: Node): PythonLibMemberIdentity | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  for (const declaration of checker.getSymbolDeclarations(symbol)) {
    if (declaration === undefined) {
      continue;
    }
    const declarationFile = ast.getFileName(ast.getSourceFile(declaration));
    if (!declarationFile.endsWith(".d.ts") || facts.get(declaration, providerVirtualDeclarationFactKey) !== undefined) {
      continue;
    }
    let owner: Node | undefined = ast.parent(declaration);
    while (owner !== undefined && ast.kindName(owner) !== KindInterfaceDeclaration) {
      owner = ast.parent(owner);
    }
    if (owner === undefined) {
      continue;
    }
    const ownerName = ast.text(ast.name(owner) ?? owner);
    const memberName = checker.getSymbolName(symbol);
    if (ownerName.length > 0 && memberName.length > 0) {
      return { ownerName, memberName };
    }
  }
  return undefined;
}

function applyJsSelection(
  walk: PythonFactWalk,
  expression: Node,
  selection: JsOperationSelection,
  sourceFile: SourceFile,
  argumentNodes: readonly (Node | undefined)[],
): TargetTypeRef {
  for (const [index, argument] of argumentNodes.entries()) {
    if (argument !== undefined) {
      resolveExpressionCarrier(walk, argument, sourceFile, selection.parameterCarriers?.[index]);
    }
  }
  recordTargetOperation(
    walk,
    expression,
    selection.fact.operationId,
    selection.fact.operationKind,
    providerOperationTargetText(selection.fact.target),
  );
  setPythonOperationFact(walk, expression, selection.fact);
  return setCarrierFact(walk, expression, selection.resultCarrier);
}

function selectJsCallForNode(walk: PythonFactWalk, callee: Node, sourceFile: SourceFile): JsOperationSelection | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (ast.kindName(callee) !== KindPropertyAccessExpression) {
    return undefined;
  }
  const identity = libMemberIdentityFor(walk, callee);
  if (identity === undefined) {
    return undefined;
  }
  const receiverNode = Node_Expression(callee);
  const receiverCarrier = receiverNode === undefined
    ? undefined
    : resolveExpressionCarrier(walk, receiverNode, sourceFile, undefined);
  return selectJsSurfaceOperation({
    ownerName: identity.ownerName,
    memberName: identity.memberName,
    operationKind: "call",
    ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
  });
}

function selectJsConstructorForNode(
  walk: PythonFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
): JsOperationSelection | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined) {
    return undefined;
  }
  const isLibDeclaration = checker.getSymbolDeclarations(symbol).some((declaration) =>
    declaration !== undefined &&
    ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts") &&
    facts.get(declaration, providerVirtualDeclarationFactKey) === undefined);
  if (!isLibDeclaration) {
    return undefined;
  }
  const typeArgumentCarriers = ast.typeArguments(expression).map((typeNode) =>
    typeNode === undefined ? undefined : resolveTypeNodeCarrier(walk, typeNode));
  const argumentCarriers = callArguments.map((argument) =>
    argument === undefined ? undefined : resolveExpressionCarrier(walk, argument, sourceFile, undefined));
  return selectJsSurfaceConstructor({
    className: checker.getSymbolName(symbol),
    typeArgumentCarriers,
    argumentCarriers,
  });
}

// The undefined singleton lowers as a module attribute of the compat
// runtime; holes in sparse literals share the same fact shape.
function recordJsUndefinedFacts(walk: PythonFactWalk, subject: Node): TargetTypeRef {
  const operationId = "tsonic.python.js.undefined";
  recordTargetOperation(walk, subject, operationId, "property", "undefined");
  setPythonOperationFact(walk, subject, {
    kind: "capability-operation",
    operationId,
    operationKind: "property",
    target: pythonJsUndefinedForm,
    resultCarrier: pythonJsValueTargetType(),
  });
  return setCarrierFact(walk, subject, pythonJsValueTargetType());
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

// Overloaded provider exports carry one identity per declared signature; the
// checker's resolved signature selects which overload owns a call site.
function providerCallSignatureIdentity(walk: PythonFactWalk, callLike: Node): ProviderDeclarationIdentity | undefined {
  const { checker } = walk.lifecycle.compiler;
  try {
    const signature = checker.getResolvedSignature(callLike);
    if (signature === undefined) {
      return undefined;
    }
    const declaration = checker.getSignatureDeclaration(signature);
    if (declaration === undefined) {
      return undefined;
    }
    const fact = walk.lifecycle.host.facts.get(declaration, providerVirtualDeclarationFactKey);
    return fact === undefined ? undefined : (fact as ProviderDeclarationIdentity);
  } catch {
    return undefined;
  }
}

// Rows with an argument contract prove every argument carrier before any
// fact lands; an unprovable argument records nothing.
function providerArgumentContractHolds(
  walk: PythonFactWalk,
  row: PythonCapabilityOperationRow,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
): boolean {
  if (row.argumentContract === undefined) {
    return true;
  }
  if (callArguments.length === 0) {
    return false;
  }
  for (const [index, argument] of callArguments.entries()) {
    if (argument === undefined) {
      return false;
    }
    const argumentCarrier = resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[index]);
    if (argumentCarrier === undefined || !isPythonJsonSerializableCarrier(argumentCarrier)) {
      return false;
    }
  }
  return true;
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
  rows: readonly PythonCapabilityOperationRow[],
  identity: ProviderDeclarationIdentity,
  operationKind: PythonCapabilityOperationRow["operationKind"],
): PythonCapabilityOperationRow | undefined {
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

// A receiver names the provider class binding itself (not an instance) when
// the identifier resolves to a bare provider export identity with no member
// selection — e.g. the imported `datetime` in `datetime.now()`.
function isProviderClassBindingReference(walk: PythonFactWalk, receiver: Node | undefined): boolean {
  if (receiver === undefined || walk.lifecycle.compiler.ast.kindName(receiver) !== KindIdentifier) {
    return false;
  }
  const identity = providerDeclarationIdentityFor(walk, receiver);
  return identity !== undefined && identity.memberId === undefined;
}

// Static-method rows lower only through the class binding; every other row
// form requires an instance receiver (or none, for free calls and
// constructors). A mismatched shape records nothing and fails closed.
function providerCallShapeMatchesRow(
  walk: PythonFactWalk,
  receiver: Node | undefined,
  row: PythonCapabilityOperationRow,
): boolean {
  return (row.target.form === "static-method") === isProviderClassBindingReference(walk, receiver);
}

function providerOperationTargetText(target: PythonCapabilityOperationForm): string {
  switch (target.form) {
    case "call":
    case "constructor": {
      return target.import.name ?? target.import.module;
    }
    case "method":
    case "property":
    case "static-attribute":
    case "static-method":
    case "builtin-call": {
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
  row: PythonCapabilityOperationRow,
  identity: ProviderDeclarationIdentity | undefined,
): void {
  const operationId = row.memberId ?? row.signatureId ?? row.exportId;
  const targetOperationText = providerOperationTargetText(row.target);
  recordTargetOperation(walk, expression, operationId, row.operationKind, targetOperationText);
  setPythonOperationFact(walk, expression, {
    kind: "capability-operation",
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
    extensionCode: "PYTHON_CAPABILITY_OPERATION_NOT_MAPPED",
    numericCode: 0,
    category: "error",
    message: `No Python target operation is mapped for provider declaration '${identity.memberId ?? identity.exportId ?? identity.moduleSpecifier}' (${operationKind}).`,
    evidence: [
      { message: `target.capability=python.capability.${operationKind}` },
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
