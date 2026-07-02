// Kind names compared against ast.kindName(node). Field access is duck-typed
// against the TS-Go AST data shapes; no internal TSTS modules are imported.

export const KindEndOfFile = "KindEndOfFile";
export const KindFunctionDeclaration = "KindFunctionDeclaration";
export const KindIdentifier = "KindIdentifier";
export const KindImportDeclaration = "KindImportDeclaration";

import type { Node } from "@tsonic/tsts";

interface NamedNodeData {
  readonly name?: Node;
}

interface TypedNodeData {
  readonly type?: Node;
}

export function Node_Name(node: Node): Node | undefined {
  return (node as NamedNodeData).name;
}

export function Node_Type(node: Node): Node | undefined {
  return (node as TypedNodeData).type;
}
