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

Integer range policy: in-range exactness. For operands and results within
the declared width, generated Python computes the same values as the C# and
Rust targets. Out-of-range results are exact unbounded integers: Python does
not wrap. This matches the sibling targets' policy of native sized-integer
semantics (C# wraps unchecked, Rust panics or wraps by build profile), none
of which promise a shared overflow behavior.

Naming policy: source names are preserved verbatim when they are valid Python
identifiers (no silent PEP 8 renaming of public APIs); reserved names on
locals mangle deterministically with a trailing underscore; reserved public
names and post-mangling collisions fail closed.

Provider packages: `createPythonProviderPackage` supplies virtual module
declarations, selected identity mapping, Python operation rows
(call/constructor/property/method/static-attribute/indexer with from-import
or module-attribute rendering), and pyproject dependency rows. Package
creation validates metadata structurally: duplicate modules/exports/rows,
rows referencing undeclared exports, invalid Python names, receiver-form rows
without a receiver type, and misplaced `isAsync` all throw. Rows marked
`isAsync` lower only as await operands; unawaited calls fail closed. Python
needs no fallibility marking on rows: exceptions propagate natively, unlike
targets that lower errors through result types. Provider exports without
operation rows fail closed. Concrete Python library names live only in
provider metadata, tests, and package definitions — never in compiler
branches, which the architecture scanners enforce.

Expansion lanes: template literals with proven str/numeric/bool
substitutions lower to f-strings; `T | null` lowers to Optional carriers
(`T | None` annotations, `is None`/`is not None` checks, `None` returns);
`Record<string, T>` lowers to `dict[str, T]` with literal/read/write lanes;
TS tuples lower to `tuple[...]` with literal-index reads; dense-list
`includes`/`indexOf` lower to `in` and the generated `_tsonic_index_of`
helper for primitive and str element carriers only.

Semantic closure lanes: project-source classes (annotated fields,
constructor with `self` attribute writes, instance methods, `@staticmethod`
statics), constant integer enums as `IntEnum` classes with fact-backed member
access and equality, record interfaces as `@dataclass` classes with
keyword-argument object literals, object/array destructuring to per-field
reads, C-style `for` loops desugared to `while`, compound assignment and
`++`/`--` through finalized operator facts, the selected error model (source
`Error` ≙ Python `Exception`: `raise Exception(...)`,
`except Exception as e`, `.message` as `str(e)`, `finally`), and
`async def`/`await` gated on async lowering facts (calls to async functions
lower only as await operands).

## Installed plugin architecture

`@tsonic/target-python` is an installed target plugin: `createTsonicPlugin()`
returns the `TsonicTargetPlugin` contract, validated against the `tsonic`
manifest in `package.json`. Third-party Python libraries are installed
target-capability plugins built with `createPythonTargetCapability`:
capability metadata validates at creation (identity-proven rows, Python
names, receiver types), manifests validate against the shipped capability,
and activation is import-driven. Operation rows are a Python-owned contract
interpreted only by this target — the generic capability operation mapper is
not the operation interface.

Stdlib capabilities are target-owned (`python-math`, `python-pathlib`,
`python-os`, `python-sys`, `python-datetime`, `python-asyncio`): the pack
provider owns their module bindings, so they are always available without
configuration selection. Each exposes only closed contracts: module-style
calls and constants, a `pathlib.Path` class lane (constructor, properties,
receiver methods), `datetime.now()` as a static-method row, and awaited-only
`asyncio.sleep`. `@python/json` is not shipped: `loads`/`dumps` traffic in
dynamic values with no closed row shape. Concrete stdlib names live only in
`src/source/capabilities/stdlib.ts`.

Generated packages carry a PEP 561 `py.typed` marker. Script output supports
async entry points: an exported async `main` lowers to a `__main__` that runs
`asyncio.run(main())`.

GPU host integration: `mergePythonHostArtifacts` accepts host artifact
contributions from GPU backends (`tsonic-gpu`/`gpu-triton`), places kernel
modules under `src/<package_name>/kernels/`, merges contributed dependencies
through the validated pyproject manifest, and fails closed on unsupported
languages, invalid or duplicate module names, and path collisions. No GPU
logic lives in this repository.

Source constructs without a finalized lowering lane fail closed with
`PYTHON_UNSUPPORTED_AST`/`PYTHON_MISSING_TARGET_FACT` diagnostics and zero
artifacts. That includes sparse arrays, JS array semantics (`at`, `includes`,
`.length =`), template literals, class inheritance/generics/accessors,
string enums, enum ordering comparisons, and the `compat`
typescript-compatibility mode (which requires the `python-js` runtime
package and is rejected at option validation).

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
