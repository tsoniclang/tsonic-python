import type { Node } from "@tsonic/tsts";
import { KindIdentifier, Node_Initializer, Node_Name, Node_Type } from "../../common/source-ast.js";
import { isValidPythonIdentifier } from "../../common/python-names.js";
import { pythonAsyncFunctionFactKey } from "../../source/python-facts/keys.js";
import type { PythonParameter, PythonStatement, PythonTypeAnnotation } from "../python-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planBlockLike } from "./statements.js";
import { collectFromImport, diagnosticInput, pythonGeneratedNamePrefix, pythonLocalName } from "./plan-context.js";
import type { PythonPlanContext } from "./plan-context.js";
import { pythonTypeFromCarrierInContext } from "./render-types.js";

// Declared type names share the function name policy: public, preserved
// verbatim, valid in Python, and outside the generated-helper namespace.
function declaredTypeName(node: Node, context: PythonPlanContext, capabilityId: string): string | undefined {
  const { ast } = context.input;
  const nameNode = Node_Name(node);
  const name = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  if (!isValidPythonIdentifier(name) || name.startsWith(pythonGeneratedNamePrefix)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      capabilityId,
      `Declared type name '${name}' is not a valid Python identifier.`,
    ));
    return undefined;
  }
  return name;
}

function memberAnnotation(member: Node, context: PythonPlanContext): PythonTypeAnnotation | undefined {
  const facts = context.input.facts;
  const memberCarrier = facts.getRuntimeCarrierFact(member)?.carrier;
  const typeNode = Node_Type(member);
  const typeCarrier = typeNode === undefined ? undefined : facts.getRuntimeCarrierFact(typeNode)?.carrier;
  return pythonTypeFromCarrierInContext(memberCarrier, context) ??
    pythonTypeFromCarrierInContext(typeCarrier, context);
}

interface PlannedMemberParameters {
  readonly params: readonly PythonParameter[];
  readonly localNames: Set<string>;
  readonly failed: boolean;
}

function planMemberParameters(member: Node, context: PythonPlanContext): PlannedMemberParameters {
  const { ast } = context.input;
  const localNames = new Set<string>();
  const params: PythonParameter[] = [];
  let failed = false;
  for (const parameter of ast.parameters(member)) {
    if (parameter === undefined) {
      continue;
    }
    if (ast.hasModifierKind(parameter, "public") || ast.hasModifierKind(parameter, "private") ||
      ast.hasModifierKind(parameter, "protected") || ast.hasModifierKind(parameter, "readonly")) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, parameter),
        "python.backend.class",
        "Parameter properties are not supported by the Python class lowering.",
      ));
      failed = true;
      continue;
    }
    const parameterSourceName = ast.text(ast.name(parameter) ?? parameter);
    const parameterName = pythonLocalName(parameterSourceName);
    const parameterCarrier = context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
    const parameterType = pythonTypeFromCarrierInContext(parameterCarrier, context);
    if (parameterName === undefined || parameterType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "python.backend.parameter",
        `Parameter '${parameterSourceName}' has no supported Python carrier fact.`,
      ));
      failed = true;
      continue;
    }
    if (localNames.has(parameterName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, parameter),
        "python.backend.naming",
        `Parameter '${parameterSourceName}' collides with another binding after reserved-name mangling.`,
      ));
      failed = true;
      continue;
    }
    localNames.add(parameterName);
    params.push({ name: parameterName, annotation: parameterType });
  }
  return { params, localNames, failed };
}

// Reserves the implicit receiver name in a member's local scope; a parameter
// spelled `self` would shadow the receiver and fails closed.
function reserveSelfName(member: Node, localNames: Set<string>, context: PythonPlanContext): boolean {
  if (localNames.has("self")) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "python.backend.naming",
      "A parameter collides with the implicit method receiver binding.",
    ));
    return false;
  }
  localNames.add("self");
  return true;
}

function paddedSuite(statements: readonly PythonStatement[]): readonly PythonStatement[] {
  return statements.length === 0 ? [{ kind: "pass" }] : statements;
}

export function planClassDeclaration(node: Node, context: PythonPlanContext): PythonStatement | undefined {
  const { ast } = context.input;
  const className = declaredTypeName(node, context, "python.backend.class");
  if (className === undefined) {
    return undefined;
  }
  if (ast.extendsHeritageElements(node).length > 0 || ast.implementsHeritageElements(node).length > 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.class",
      "Class inheritance and interface implementation are not supported by the Python target.",
    ));
    return undefined;
  }
  for (const typeParameter of ast.typeParameters(node)) {
    if (typeParameter !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, typeParameter),
        "python.backend.generics",
        "Generic classes are not supported by the static-native Python lowering.",
      ));
      return undefined;
    }
  }
  const fields: PythonStatement[] = [];
  let constructorMember: Node | undefined;
  const methodMembers: Node[] = [];
  let failed = false;
  for (const member of ast.members(node)) {
    if (member === undefined) {
      continue;
    }
    const memberKind = ast.kindName(member);
    if (memberKind === "KindPropertyDeclaration") {
      if (ast.hasModifierKind(member, "static")) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, member),
          "python.backend.class",
          "Static class fields are not supported by the Python target.",
        ));
        failed = true;
        continue;
      }
      if (Node_Initializer(member) !== undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, member),
          "python.backend.class",
          "Class fields must be initialized in the constructor.",
        ));
        failed = true;
        continue;
      }
      const fieldNameNode = ast.name(member);
      const fieldName = fieldNameNode === undefined ? "" : ast.text(fieldNameNode);
      const annotation = memberAnnotation(member, context);
      if (!isValidPythonIdentifier(fieldName) || annotation === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, member),
          "python.backend.class",
          `Class field '${fieldName}' has no supported Python carrier fact.`,
        ));
        failed = true;
        continue;
      }
      fields.push({ kind: "field-decl", name: fieldName, annotation });
      continue;
    }
    if (memberKind === "KindConstructor") {
      if (constructorMember !== undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, member),
          "python.backend.class",
          "Classes support at most one constructor.",
        ));
        failed = true;
        continue;
      }
      constructorMember = member;
      continue;
    }
    if (memberKind === "KindMethodDeclaration") {
      methodMembers.push(member);
      continue;
    }
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "python.backend.class",
      "This class member is not supported by the Python target.",
    ));
    failed = true;
  }
  const body: PythonStatement[] = [...fields];
  if (constructorMember !== undefined) {
    const initDef = planConstructor(constructorMember, context);
    if (initDef === undefined) {
      failed = true;
    } else {
      body.push(initDef);
    }
  }
  for (const method of methodMembers) {
    const planned = planMethod(method, context);
    if (planned === undefined) {
      failed = true;
      continue;
    }
    body.push(planned);
  }
  if (failed) {
    return undefined;
  }
  return { kind: "class-def", name: className, body: paddedSuite(body) };
}

function planConstructor(member: Node, context: PythonPlanContext): PythonStatement | undefined {
  const { ast } = context.input;
  const planned = planMemberParameters(member, context);
  const bodyNode = ast.body(member);
  if (bodyNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "python.backend.class",
      "Constructors require a body.",
    ));
    return undefined;
  }
  if (!reserveSelfName(member, planned.localNames, context)) {
    return undefined;
  }
  const bodyContext: PythonPlanContext = { ...context, localNames: planned.localNames, selfName: "self" };
  const body = planBlockLike(bodyNode, bodyContext);
  if (planned.failed || body === undefined) {
    return undefined;
  }
  return {
    kind: "function-def",
    name: "__init__",
    params: [{ name: "self" }, ...planned.params],
    returns: { kind: "none" },
    body: paddedSuite(body),
  };
}

function planMethod(member: Node, context: PythonPlanContext): PythonStatement | undefined {
  const { ast } = context.input;
  const isAsync = ast.hasModifierKind(member, "async");
  if (isAsync && context.input.facts.getFact(member, pythonAsyncFunctionFactKey) === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "python.backend.async",
      "Async methods require a finalized Python async lowering fact.",
    ));
    return undefined;
  }
  const methodNameNode = ast.name(member);
  const methodName = methodNameNode === undefined ? "" : ast.text(methodNameNode);
  if (!isValidPythonIdentifier(methodName) || methodName.startsWith(pythonGeneratedNamePrefix)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "python.backend.class",
      `Method name '${methodName}' is not a valid Python identifier.`,
    ));
    return undefined;
  }
  for (const typeParameter of ast.typeParameters(member)) {
    if (typeParameter !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, typeParameter),
        "python.backend.generics",
        "Generic methods are not supported by the static-native Python lowering.",
      ));
      return undefined;
    }
  }
  const planned = planMemberParameters(member, context);
  const returnTypeNode = Node_Type(member);
  if (returnTypeNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "python.backend.class",
      "Methods require an explicit return type annotation.",
    ));
    return undefined;
  }
  const returnCarrier = context.input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
  const returns = pythonTypeFromCarrierInContext(returnCarrier, context);
  if (returns === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode),
      "python.backend.class",
      "Method return type has no supported Python carrier fact.",
    ));
    return undefined;
  }
  const bodyNode = ast.body(member);
  if (bodyNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "python.backend.class",
      "Methods require a body.",
    ));
    return undefined;
  }
  const isStatic = ast.hasModifierKind(member, "static");
  if (!isStatic && !reserveSelfName(member, planned.localNames, context)) {
    return undefined;
  }
  const bodyContext: PythonPlanContext = {
    ...context,
    localNames: planned.localNames,
    ...(isStatic ? {} : { selfName: "self" }),
    ...(isAsync ? { insideAsync: true } : {}),
  };
  const body = planBlockLike(bodyNode, bodyContext);
  if (planned.failed || body === undefined) {
    return undefined;
  }
  return {
    kind: "function-def",
    name: methodName,
    params: isStatic ? planned.params : [{ name: "self" }, ...planned.params],
    returns,
    body: paddedSuite(body),
    ...(isAsync ? { isAsync: true } : {}),
    ...(isStatic ? { decorators: ["staticmethod"] } : {}),
  };
}

// Enums lower to IntEnum subclasses with one member assignment per declared
// member, in declaration order; member values come from the constants the
// shared analysis evaluated, never from source spelling.
export function planEnumDeclaration(node: Node, context: PythonPlanContext): PythonStatement | undefined {
  const { ast } = context.input;
  const enumName = declaredTypeName(node, context, "python.backend.enum");
  if (enumName === undefined) {
    return undefined;
  }
  const body: PythonStatement[] = [];
  for (const member of ast.members(node)) {
    if (member === undefined) {
      continue;
    }
    const memberNameNode = ast.name(member);
    const memberName = memberNameNode === undefined ? "" : ast.text(memberNameNode);
    if (!isValidPythonIdentifier(memberName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "python.backend.enum",
        `Enum member name '${memberName}' is not a valid Python identifier.`,
      ));
      return undefined;
    }
    const constant = context.input.analysis.getEnumMemberConstant(member, { sourceFile: context.sourceFile });
    const value = constant?.value;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "python.backend.enum",
        "Enum members require integer constants evaluated by the shared analysis.",
      ));
      return undefined;
    }
    body.push({
      kind: "assign",
      targetName: memberName,
      value: { kind: "int-literal", text: String(value) },
    });
  }
  collectFromImport(context, "enum", "IntEnum");
  return { kind: "class-def", name: enumName, bases: ["IntEnum"], body: paddedSuite(body) };
}

// Record shapes (interfaces of property signatures) lower to dataclasses
// with one annotated field per declared member, in declaration order.
export function planInterfaceDeclaration(node: Node, context: PythonPlanContext): PythonStatement | undefined {
  const { ast } = context.input;
  const recordName = declaredTypeName(node, context, "python.backend.record");
  if (recordName === undefined) {
    return undefined;
  }
  if (ast.extendsHeritageElements(node).length > 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.record",
      "Interface inheritance is not supported by the Python target.",
    ));
    return undefined;
  }
  for (const typeParameter of ast.typeParameters(node)) {
    if (typeParameter !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, typeParameter),
        "python.backend.generics",
        "Generic interfaces are not supported by the static-native Python lowering.",
      ));
      return undefined;
    }
  }
  const fields: PythonStatement[] = [];
  for (const member of ast.members(node)) {
    if (member === undefined) {
      continue;
    }
    if (ast.kindName(member) !== "KindPropertySignature") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "python.backend.record",
        "Record interfaces support only property signatures.",
      ));
      return undefined;
    }
    const fieldNameNode = ast.name(member);
    const fieldName = fieldNameNode === undefined ? "" : ast.text(fieldNameNode);
    const annotation = memberAnnotation(member, context);
    if (!isValidPythonIdentifier(fieldName) || annotation === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "python.backend.record",
        `Record field '${fieldName}' has no supported Python carrier fact.`,
      ));
      return undefined;
    }
    fields.push({ kind: "field-decl", name: fieldName, annotation });
  }
  collectFromImport(context, "dataclasses", "dataclass");
  return { kind: "class-def", name: recordName, decorators: ["dataclass"], body: paddedSuite(fields) };
}
