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

const pythonIdentifierPattern = /^[a-z_][a-z0-9_]*$/u;

export function isValidPythonModuleName(name: string): boolean {
  return pythonIdentifierPattern.test(name) && !pythonReservedIdentifiers.has(name);
}
