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

Target capabilities: `createPythonTargetCapability` supplies virtual module
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
returns the `TsonicTargetPlugin` contract carrying the target identity; the
`tsonic` manifest in `package.json` is the generic host discovery shape
(kind `plugin`, contract version, entry) and only locates this entry point.
Third-party Python libraries are installed target-capability plugins built
with `createPythonTargetCapability`: capability identity and module
ownership live on the plugin object, capability metadata validates at
creation (identity-proven rows, Python names, receiver types), and
activation is import-driven. Operation rows ride the standard
`createOperationMappers()` capability hook as a Python-owned mapper subtype
(`kind: "python-operation-rows"`); only the Python target interprets the
rows.

Stdlib capabilities are target-owned (`python-math`, `python-pathlib`,
`python-os`, `python-sys`, `python-datetime`, `python-asyncio`,
`python-json`): the pack
provider owns their module bindings, so they are always available without
configuration selection. Each exposes only closed contracts: module-style
calls and constants, a `pathlib.Path` class lane (constructor, properties,
receiver methods), `datetime.now()` as a static-method row, awaited-only
`asyncio.sleep`, and `json.dumps` gated by a json-serializable argument
contract (str, mapped primitives, `list`/`dict[str, T]` of primitives,
tuples and Optionals of accepted shapes, recursively). `json.loads` is not
shipped: its return shape is dynamic. Concrete stdlib names live only in
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
artifacts. That includes sparse arrays, JS array semantics on non-primitive
elements (`at`, `includes`/`indexOf` over object elements, `.length =`),
template literals with unproven substitutions, class
inheritance/generics/accessors, string enums, enum ordering comparisons,
and, in strict-native mode, every JS
compatibility lane (compat output is selected explicitly through
`typescriptCompatibility: "compat"` or the `js` surface).

## Lane ledger

Complete (fact-backed, runtime-proven):

- Static-native spine: functions, parameters, locals, returns, if/elif/else,
  while, for-of, C-style for desugaring, operators with the truncating
  integer contract, string concat/equality
- Classes, constant integer enums, record dataclasses, object/array
  destructuring, error model, async/await, async script entry
- Template literals to f-strings, Optional/None, dict[str, T], tuples,
  dense-list includes/indexOf, typed json.dumps over closed carriers
- Installed plugin product path: generic host discovery, target
  registration, third-party capability plugins with import-driven
  activation and duplicate-ownership rejection
- GPU host integration consuming the tsonic-gpu host artifact contract with
  gpu-triton kernel modules, wrapper re-exports, and dependency merge
- Packaging: wheel-ready layout, py.typed, deterministic ordering,
  interpreter gates (3.12/3.13/3.14; absent interpreters are explicit
  environment skips)
- JS compatibility subset through the tsonic-python-js runtime, selected by
  compat mode or the js surface: undefined and strict equality, sparse
  arrays with JsArray methods and index writes, UTF-16 string helpers with
  at/codePointAt/concat/string replace/case conversion, Number/Math
  helpers, JSON parse/stringify over JsValue carriers, dynamic
  read/write/delete lanes, Map/Set, Date with now/parse statics, typed
  arrays with bulk set and ArrayBuffer/DataView, and the oracle-proven
  RegExp subset (literal and literal-argument construction; test, replace,
  split, search; selection by first-argument carrier). The runtime parity
  inventory lives in the python-js repository (docs/js-parity.md);
  strict-native output never references the runtime

Hard-reject (fail closed by design, no external dependency):

- json.dumps of class instances and generated dataclass records (no sound
  serialization without a dedicated conversion lane); json.loads (dynamic
  return shape); json.dumps of direct object/array literal arguments (no
  contextual carrier — bind to a typed local first)
- Sparse arrays, .length writes, at(), non-primitive includes/indexOf
- Class inheritance, generics, accessors, parameter properties, static
  fields; string enums; enum ordering comparisons
- continue inside desugared C-style for; unawaited async calls; tuple
  access with non-literal indexes; source names in the generated-helper
  namespace
- JS compat members without closed runtime rows: WeakMap/WeakSet, timers,
  console, fetch, DOM/Web and Node APIs, proxies, symbols, custom toJSON
  and replacer/reviver, RegExp.exec and dynamic RegExp construction
  (out-of-subset patterns raise at runtime construction — the runtime
  engine is the subset authority), and locale surfaces

Blocked by external contract:

- Variadic stdlib APIs (os.path.join and similar): blocked on TSTS
  variadic parameter carriers
- Promise/awaitable provider declarations: blocked on a promise kind in
  the TSTS provider type grammar (async rows declare the payload type)

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
    "pythonVersion": "3.12",                 // "3.12" | "3.13" | "3.14"
    "outputType": "package",                 // "package" | "script"
    "typescriptCompatibility": "strict-native" // "strict-native" | "compat"
  }
}
```

Unknown option keys are rejected.
