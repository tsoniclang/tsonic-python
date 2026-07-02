import type { Node } from "@tsonic/tsts";
import { KindIdentifier, Node_Name, Node_Type } from "../../common/source-ast.js";
import { isValidPythonIdentifier } from "../../common/python-names.js";
import type { PythonParameter, PythonStatement } from "../python-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planBlockLike } from "./statements.js";
import { diagnosticInput, pythonLocalName } from "./plan-context.js";
import type { PythonPlanContext } from "./plan-context.js";
import { pythonTypeFromCarrier } from "./render-types.js";

export function planFunctionDeclaration(node: Node, context: PythonPlanContext): PythonStatement | undefined {
  const { ast } = context.input;
  if (ast.hasModifierKind(node, "async")) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.async",
      "Async functions are not supported by the static-native Python lowering.",
    ));
    return undefined;
  }
  const nameNode = Node_Name(node);
  const sourceName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  // Function names are part of the module import surface: preserved verbatim,
  // never mangled. Reserved or invalid public names fail closed.
  if (!isValidPythonIdentifier(sourceName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.function",
      `Function name '${sourceName}' is not a valid Python identifier.`,
    ));
    return undefined;
  }
  for (const typeParameter of ast.typeParameters(node)) {
    if (typeParameter !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, typeParameter),
        "python.backend.generics",
        "Generic functions are not supported by the static-native Python lowering.",
      ));
      return undefined;
    }
  }
  const localNames = new Set<string>();
  const params: PythonParameter[] = [];
  let paramsFailed = false;
  for (const parameter of ast.parameters(node)) {
    if (parameter === undefined) {
      continue;
    }
    const parameterSourceName = ast.text(ast.name(parameter) ?? parameter);
    const parameterName = pythonLocalName(parameterSourceName);
    const parameterCarrier = context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
    const parameterType = pythonTypeFromCarrier(parameterCarrier);
    if (parameterName === undefined || parameterType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "python.backend.parameter",
        `Parameter '${parameterSourceName}' has no supported Python carrier fact.`,
      ));
      paramsFailed = true;
      continue;
    }
    if (localNames.has(parameterName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, parameter),
        "python.backend.naming",
        `Parameter '${parameterSourceName}' collides with another binding after reserved-name mangling.`,
      ));
      paramsFailed = true;
      continue;
    }
    localNames.add(parameterName);
    params.push({ name: parameterName, annotation: parameterType });
  }
  const returnTypeNode = Node_Type(node);
  if (returnTypeNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.function",
      "Functions require an explicit return type annotation.",
    ));
    return undefined;
  }
  const returnCarrier = context.input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
  const returns = pythonTypeFromCarrier(returnCarrier);
  if (returns === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode),
      "python.backend.function",
      "Function return type has no supported Python carrier fact.",
    ));
    return undefined;
  }
  const bodyNode = ast.body(node);
  if (bodyNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "python.backend.function",
      "Functions require a body.",
    ));
    return undefined;
  }
  const bodyContext: PythonPlanContext = { ...context, localNames };
  const body = planBlockLike(bodyNode, bodyContext);
  if (paramsFailed || body === undefined) {
    return undefined;
  }
  return {
    kind: "function-def",
    name: sourceName,
    params,
    returns,
    body: body.length === 0 ? [{ kind: "pass" }] : body,
  };
}
