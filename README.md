# tsonic-python

Python target pack for Tsonic (`@tsonic/target-python`).

This package owns the TypeScript-side Python target implementation: target
descriptor, Python target options, target-semantics extension, backend
planning/printing, pyproject generation, and Python toolchain integration.
The backend is fail-closed: constructs without finalized lowering facts
produce deterministic diagnostics, never guessed Python source.

Runtime packages are intentionally split into sibling repositories, matching
the C# and Rust package layout:

- `python-js` — JS compatibility runtime for Python (selected only in compat
  mode or through a selected JS surface capability)

This repository must not own JS/Node runtime surface implementations, GPU
kernel IR (`tsonic-gpu`), or Triton lowering (`gpu-triton`).

## Supported lanes

Target infrastructure: target pack registration, target option validation
with unknown-key rejection, fail-closed backend, deterministic generated
project layout (`pyproject.toml` with an explicit hatchling `[build-system]`,
`src/<package_name>/`), structured Python output model with a deterministic
printer, `python-package` runtime reference mapping, type-only import erasure,
and architecture scanners.

Static-native spine: fact-backed functions, parameters, locals, returns,
if/elif/else, while, for-of over proven dense lists,
arithmetic/comparison/boolean operators, string concat/equality, and the
dense list lane (literals, index read/write, `.length` to `len()`, `.push` to
`.append()`). Primitive lowering: proven integer widths to `int`,
`float32`/`float64` to `float`, `bool` to `bool`, `string` to `str`, `void`
to `None`. Integer division and remainder lower to generated module helpers
(`_tsonic_int_div`/`_tsonic_int_rem`) that truncate toward zero per the
shared integer contract — Python's flooring `//` and divisor-signed `%` are
not equivalent for negative operands; float remainder lowers to `math.fmod`.

Naming policy: source names are preserved verbatim when they are valid Python
identifiers (no silent PEP 8 renaming of public APIs); reserved names on
locals mangle deterministically with a trailing underscore; reserved public
names and post-mangling collisions fail closed.

Provider packages: `createPythonProviderPackage` supplies virtual module
declarations, selected identity mapping, Python operation rows
(call/constructor/property/indexer with from-import or module-attribute
rendering), and pyproject dependency rows. Provider exports without operation
rows fail closed.

Source constructs without a finalized lowering lane fail closed with
`PYTHON_UNSUPPORTED_AST`/`PYTHON_MISSING_TARGET_FACT` diagnostics and zero
artifacts. That includes sparse arrays, JS array semantics (`at`, `includes`,
`.length =`), template literals, classes, async, error handling, and the
`compat` typescript-compatibility mode (which requires the `python-js`
runtime package and is rejected at option validation).

## Build and test

```sh
npm install
npm test
```

The build requires the sibling `tsonic` repository checked out at
`../tsonic` with its packages prebuilt (`@tsonic/tsts`, `@tsonic/target-api`,
`@tsonic/source-core`). The build never writes into the sibling repository.

## Target options

```jsonc
{
  "id": "python",
  "options": {
    "packageName": "tsonic_generated",      // ^[a-z][a-z0-9_]*$
    "pythonVersion": "3.12",                 // "3.12" | "3.13"
    "outputType": "package",                 // "package" | "script"
    "typescriptCompatibility": "strict-native" // "strict-native" | "compat"
  }
}
```

Unknown option keys are rejected.
