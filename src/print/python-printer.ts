// Deterministic Python printer. Output for the supported subset must stay
// stable byte-for-byte: 4-space indentation, no trailing whitespace, black
// style blank-line separation for top-level definitions, minimal stable
// parenthesization from a fixed precedence table, trailing newline.

import type {
  PythonBinaryOperator,
  PythonExpression,
  PythonModuleModel,
  PythonParameter,
  PythonStatement,
  PythonTypeAnnotation,
} from "../backend/python-ast/nodes.js";

const indentUnit = "    ";

export function printPythonModule(module: PythonModuleModel): string {
  const lines: string[] = [`# ${module.headerComment}`];
  let previous: PythonStatement | undefined;
  for (const statement of module.statements) {
    if (previous === undefined) {
      lines.push("");
    } else if (isTopLevelDefinition(statement) || isTopLevelDefinition(previous)) {
      lines.push("", "");
    }
    lines.push(...printStatementLines(statement, 0));
    previous = statement;
  }
  return `${lines.join("\n")}\n`;
}

export function printPythonStatement(statement: PythonStatement): string {
  return printStatementLines(statement, 0).join("\n");
}

function isTopLevelDefinition(statement: PythonStatement): boolean {
  return statement.kind === "function-def" || statement.kind === "class-def";
}

// Class bodies separate member definitions with one blank line (black
// style); simple field declarations stay adjacent.
function printClassBody(body: readonly PythonStatement[], depth: number): readonly string[] {
  if (body.length === 0) {
    return failUnsupportedPythonSyntax({ kind: "<empty-class-body>" }, "statement");
  }
  const lines: string[] = [];
  let previous: PythonStatement | undefined;
  for (const statement of body) {
    if (previous !== undefined && (statement.kind === "function-def" || previous.kind === "function-def")) {
      lines.push("");
    }
    lines.push(...printStatementLines(statement, depth));
    previous = statement;
  }
  return lines;
}

function printBlock(body: readonly PythonStatement[], depth: number): readonly string[] {
  if (body.length === 0) {
    return failUnsupportedPythonSyntax({ kind: "<empty-block>" }, "statement");
  }
  const lines: string[] = [];
  for (const child of body) {
    lines.push(...printStatementLines(child, depth));
  }
  return lines;
}

function printStatementLines(statement: PythonStatement, depth: number): readonly string[] {
  const indent = indentUnit.repeat(depth);
  switch (statement.kind) {
    case "import":
      return [`${indent}import ${statement.module}${statement.alias === undefined ? "" : ` as ${statement.alias}`}`];
    case "from-import": {
      if (statement.names.length === 0) {
        return failUnsupportedPythonSyntax(statement, "statement");
      }
      const names = statement.names
        .map((entry) => `${entry.name}${entry.alias === undefined ? "" : ` as ${entry.alias}`}`)
        .join(", ");
      return [`${indent}from ${statement.module} import ${names}`];
    }
    case "pass":
      return [`${indent}pass`];
    case "expr":
      return [`${indent}${printPythonExpression(statement.expression)}`];
    case "return":
      return [
        statement.expression === undefined
          ? `${indent}return`
          : `${indent}return ${printPythonExpression(statement.expression)}`,
      ];
    case "assign": {
      const annotation = statement.annotation === undefined ? "" : `: ${printPythonTypeAnnotation(statement.annotation)}`;
      return [`${indent}${statement.targetName}${annotation} = ${printPythonExpression(statement.value)}`];
    }
    case "subscript-assign":
      return [
        `${indent}${printOperand(statement.target, PythonPrecedence.Primary)}[${printPythonExpression(statement.index)}] = ${printPythonExpression(statement.value)}`,
      ];
    case "if": {
      const lines = [
        `${indent}if ${printPythonExpression(statement.condition)}:`,
        ...printBlock(statement.body, depth + 1),
      ];
      if (statement.orelse !== undefined && statement.orelse.length > 0) {
        // Collapse `else: if ...` chains into elif for stable black-style
        // output.
        if (statement.orelse.length === 1 && statement.orelse[0]?.kind === "if") {
          const chained = printStatementLines(statement.orelse[0], depth);
          lines.push(`${indent}el${chained[0]?.slice(indent.length) ?? ""}`, ...chained.slice(1));
        } else {
          lines.push(`${indent}else:`, ...printBlock(statement.orelse, depth + 1));
        }
      }
      return lines;
    }
    case "while":
      return [
        `${indent}while ${printPythonExpression(statement.condition)}:`,
        ...printBlock(statement.body, depth + 1),
      ];
    case "for":
      return [
        `${indent}for ${statement.targetName} in ${printPythonExpression(statement.iterable)}:`,
        ...printBlock(statement.body, depth + 1),
      ];
    case "function-def": {
      const params = statement.params.map(printParameter).join(", ");
      const returns = statement.returns === undefined ? "" : ` -> ${printPythonTypeAnnotation(statement.returns)}`;
      const keyword = statement.isAsync === true ? "async def" : "def";
      return [
        ...(statement.decorators ?? []).map((decorator) => `${indent}@${decorator}`),
        `${indent}${keyword} ${statement.name}(${params})${returns}:`,
        ...printBlock(statement.body, depth + 1),
      ];
    }
    case "class-def": {
      const bases = statement.bases === undefined || statement.bases.length === 0
        ? ""
        : `(${statement.bases.join(", ")})`;
      return [
        ...(statement.decorators ?? []).map((decorator) => `${indent}@${decorator}`),
        `${indent}class ${statement.name}${bases}:`,
        ...printClassBody(statement.body, depth + 1),
      ];
    }
    case "field-decl":
      return [`${indent}${statement.name}: ${printPythonTypeAnnotation(statement.annotation)}`];
    case "attribute-assign":
      return [
        `${indent}${printOperand(statement.target, PythonPrecedence.Primary)}.${statement.name} = ${printPythonExpression(statement.value)}`,
      ];
    case "tuple-assign": {
      if (statement.targetNames.length < 2) {
        return failUnsupportedPythonSyntax(statement, "statement");
      }
      return [`${indent}${statement.targetNames.join(", ")} = ${printPythonExpression(statement.value)}`];
    }
    case "raise":
      return [
        statement.expression === undefined
          ? `${indent}raise`
          : `${indent}raise ${printPythonExpression(statement.expression)}`,
      ];
    case "try": {
      if (statement.handlers.length === 0 && statement.finallyBody === undefined) {
        return failUnsupportedPythonSyntax(statement, "statement");
      }
      const lines = [`${indent}try:`, ...printBlock(statement.body, depth + 1)];
      for (const handler of statement.handlers) {
        const binding = handler.name === undefined ? "" : ` as ${handler.name}`;
        lines.push(`${indent}except ${handler.exceptionType}${binding}:`, ...printBlock(handler.body, depth + 1));
      }
      if (statement.finallyBody !== undefined) {
        lines.push(`${indent}finally:`, ...printBlock(statement.finallyBody, depth + 1));
      }
      return lines;
    }
    default:
      return failUnsupportedPythonSyntax(statement, "statement");
  }
}

function printParameter(parameter: PythonParameter): string {
  return parameter.annotation === undefined
    ? parameter.name
    : `${parameter.name}: ${printPythonTypeAnnotation(parameter.annotation)}`;
}

export function printPythonTypeAnnotation(annotation: PythonTypeAnnotation): string {
  switch (annotation.kind) {
    case "name":
      return annotation.name;
    case "subscript":
      return `${annotation.name}[${annotation.arguments.map(printPythonTypeAnnotation).join(", ")}]`;
    case "optional":
      return `${printPythonTypeAnnotation(annotation.inner)} | None`;
    case "none":
      return "None";
    default:
      return failUnsupportedPythonSyntax(annotation, "type annotation");
  }
}

const enum PythonPrecedence {
  Or = 1,
  And = 2,
  Not = 3,
  Comparison = 4,
  Additive = 5,
  Multiplicative = 6,
  Unary = 7,
  Primary = 8,
  Atom = 9,
}

const binaryOperatorPrecedence: Readonly<Record<PythonBinaryOperator, PythonPrecedence>> = {
  or: PythonPrecedence.Or,
  and: PythonPrecedence.And,
  in: PythonPrecedence.Comparison,
  "not in": PythonPrecedence.Comparison,
  is: PythonPrecedence.Comparison,
  "is not": PythonPrecedence.Comparison,
  "==": PythonPrecedence.Comparison,
  "!=": PythonPrecedence.Comparison,
  "<": PythonPrecedence.Comparison,
  "<=": PythonPrecedence.Comparison,
  ">": PythonPrecedence.Comparison,
  ">=": PythonPrecedence.Comparison,
  "+": PythonPrecedence.Additive,
  "-": PythonPrecedence.Additive,
  "*": PythonPrecedence.Multiplicative,
  "/": PythonPrecedence.Multiplicative,
  "//": PythonPrecedence.Multiplicative,
  "%": PythonPrecedence.Multiplicative,
};

function expressionPrecedence(expression: PythonExpression): PythonPrecedence {
  switch (expression.kind) {
    case "binary":
      return binaryOperatorPrecedence[expression.operator];
    case "unary":
      return expression.operator === "not" ? PythonPrecedence.Not : PythonPrecedence.Unary;
    case "attribute":
    case "call":
    case "call-kwargs":
    case "subscript":
      return PythonPrecedence.Primary;
    case "await":
      return PythonPrecedence.Unary;
    default:
      return PythonPrecedence.Atom;
  }
}

function printOperand(expression: PythonExpression, minimum: PythonPrecedence): string {
  const text = printPythonExpression(expression);
  return expressionPrecedence(expression) < minimum ? `(${text})` : text;
}

export function printPythonExpression(expression: PythonExpression): string {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
      return expression.text;
    case "bool-literal":
      return expression.value ? "True" : "False";
    case "string-literal":
      return escapePythonString(expression.value);
    case "none-literal":
      return "None";
    case "name":
      return expression.name;
    case "attribute":
      return `${printOperand(expression.value, PythonPrecedence.Primary)}.${expression.name}`;
    case "call":
      return `${printOperand(expression.callee, PythonPrecedence.Primary)}(${expression.args.map(printPythonExpression).join(", ")})`;
    case "call-kwargs": {
      const parts = [
        ...expression.args.map(printPythonExpression),
        ...expression.kwargs.map((entry) => `${entry.name}=${printPythonExpression(entry.value)}`),
      ];
      return `${printOperand(expression.callee, PythonPrecedence.Primary)}(${parts.join(", ")})`;
    }
    case "await":
      return `await ${printOperand(expression.operand, PythonPrecedence.Unary)}`;
    case "f-string":
      return printFString(expression.parts);
    case "dict":
      return `{${expression.entries.map((entry) => `${printPythonExpression(entry.key)}: ${printPythonExpression(entry.value)}`).join(", ")}}`;
    case "tuple": {
      if (expression.elements.length === 0) {
        return failUnsupportedPythonSyntax(expression, "expression");
      }
      const printed = expression.elements.map(printPythonExpression);
      return expression.elements.length === 1 ? `(${printed[0]},)` : `(${printed.join(", ")})`;
    }
    case "subscript":
      return `${printOperand(expression.value, PythonPrecedence.Primary)}[${printPythonExpression(expression.index)}]`;
    case "list":
      return `[${expression.elements.map(printPythonExpression).join(", ")}]`;
    case "binary": {
      const precedence = binaryOperatorPrecedence[expression.operator];
      // Comparisons are non-associative in this model; both sides parenthesize
      // at equal precedence to avoid accidental chained comparisons. Other
      // binary operators are left-associative.
      const rightMinimum = precedence === PythonPrecedence.Comparison
        ? PythonPrecedence.Comparison + 1
        : precedence + 1;
      const leftMinimum = precedence === PythonPrecedence.Comparison
        ? PythonPrecedence.Comparison + 1
        : precedence;
      return `${printOperand(expression.left, leftMinimum)} ${expression.operator} ${printOperand(expression.right, rightMinimum)}`;
    }
    case "unary": {
      const operand = printOperand(
        expression.operand,
        expression.operator === "not" ? PythonPrecedence.Not : PythonPrecedence.Unary,
      );
      return expression.operator === "not" ? `not ${operand}` : `-${operand}`;
    }
    default:
      return failUnsupportedPythonSyntax(expression, "expression");
  }
}

export function escapePythonString(value: string): string {
  let escaped = '"';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\") {
      escaped += "\\\\";
    } else if (character === '"') {
      escaped += '\\"';
    } else if (character === "\n") {
      escaped += "\\n";
    } else if (character === "\r") {
      escaped += "\\r";
    } else if (character === "\t") {
      escaped += "\\t";
    } else if (codePoint < 0x20 || codePoint === 0x7f) {
      escaped += `\\x${codePoint.toString(16).padStart(2, "0")}`;
    } else {
      escaped += character;
    }
  }
  return `${escaped}"`;
}

export function failUnsupportedPythonSyntax(node: unknown, category: string): never {
  const kind = typeof node === "object" && node !== null && "kind" in node
    ? String((node as { readonly kind: unknown }).kind)
    : "<missing-kind>";
  throw new Error(`Unsupported Python ${category} syntax reached printer: ${kind}`);
}

// f-strings print double-quoted; literal text escapes quotes/backslashes and
// doubles braces. Field expressions must not contain characters that cannot
// appear inside an f-string replacement field.
function printFString(parts: readonly import("../backend/python-ast/nodes.js").PythonFStringPart[]): string {
  let out = 'f"';
  for (const part of parts) {
    if (part.kind === "text") {
      out += escapePythonString(part.text).slice(1, -1).replace(/\{/gu, "{{").replace(/\}/gu, "}}");
      continue;
    }
    const field = printPythonExpression(part.expression);
    if (field.includes('"') || field.includes("\\") || field.includes("\n") || field.includes("{") || field.includes("}")) {
      return failUnsupportedPythonSyntax(part.expression, "f-string field");
    }
    out += `{${field}}`;
  }
  return `${out}"`;
}
