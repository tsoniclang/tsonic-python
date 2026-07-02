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

Slice P1: target pack registration, target option validation with unknown-key
rejection, fail-closed backend, deterministic generated project layout
(`pyproject.toml`, `src/<package_name>/`), structured Python output model with
a deterministic printer, `python-package` runtime reference mapping, type-only
import erasure, and architecture scanners.

Source constructs without a finalized lowering lane fail closed with
`PYTHON_UNSUPPORTED_AST` diagnostics and zero artifacts.

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
