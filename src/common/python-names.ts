// Python keywords plus soft keywords and generated-module names that must
// never collide with a lowered source module or generated package.
export const pythonReservedIdentifiers: ReadonlySet<string> = new Set([
  "False", "None", "True",
  "and", "as", "assert", "async", "await",
  "break", "case", "class", "continue",
  "def", "del",
  "elif", "else", "except",
  "finally", "for", "from",
  "global",
  "if", "import", "in", "is",
  "lambda",
  "match",
  "nonlocal", "not",
  "or",
  "pass",
  "raise", "return",
  "try", "type",
  "while", "with",
  "yield",
  "__init__", "__main__",
]);

const pythonModuleNamePattern = /^[a-z_][a-z0-9_]*$/u;

export function isValidPythonModuleName(name: string): boolean {
  return pythonModuleNamePattern.test(name) && !pythonReservedIdentifiers.has(name);
}

// Naming policy: source names are preserved when they are already valid
// Python identifiers (no silent PEP 8 renaming of public APIs). Reserved
// names on local bindings mangle deterministically with a trailing
// underscore; the planner fails closed on any post-mangling collision.
const pythonIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function isValidPythonIdentifier(name: string): boolean {
  return pythonIdentifierPattern.test(name) && !pythonReservedIdentifiers.has(name);
}

export function isPythonReservedIdentifier(name: string): boolean {
  return pythonReservedIdentifiers.has(name);
}

export function manglePythonReservedName(name: string): string {
  return `${name}_`;
}
