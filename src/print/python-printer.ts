// Deterministic Python printer. Output for the supported subset must stay
// stable byte-for-byte: 4-space indentation, no trailing whitespace, black
// style blank-line separation for top-level definitions, trailing newline.

import type {
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
    } else if (statement.kind === "function-def" || previous.kind === "function-def") {
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
    case "function-def": {
      if (statement.body.length === 0) {
        return failUnsupportedPythonSyntax(statement, "statement");
      }
      const params = statement.params.map(printParameter).join(", ");
      const returns = statement.returns === undefined ? "" : ` -> ${printPythonTypeAnnotation(statement.returns)}`;
      const keyword = statement.isAsync === true ? "async def" : "def";
      const lines = [`${indent}${keyword} ${statement.name}(${params})${returns}:`];
      for (const child of statement.body) {
        lines.push(...printStatementLines(child, depth + 1));
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
    case "none":
      return "None";
    default:
      return failUnsupportedPythonSyntax(annotation, "type annotation");
  }
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
      return `${printPythonExpression(expression.value)}.${expression.name}`;
    case "call":
      return `${printPythonExpression(expression.callee)}(${expression.args.map(printPythonExpression).join(", ")})`;
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
