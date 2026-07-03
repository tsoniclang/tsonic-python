// End-to-end test harness: compiles in-memory TypeScript through TSTS with
// the Python target extensions, then plans Python artifacts via the backend.
// Uses only public @tsonic packages — no @tsonic/host.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTsonicCoreSourceExtension } from "@tsonic/source-core";
import { createPythonBackend, createPythonTargetPack } from "../../dist/index.js";
// Deep dist imports keep the helper independent of the root barrel surface.
import { createPythonCompileInputFromSession } from "../../dist/session/compile-input.js";
import { createPythonTargetCapability } from "../../dist/source/capabilities/index.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(testDirectory, "../..");
export const fixturePackagesRoot = resolve(repositoryRoot, "test/fixtures/pypackages");
// Sibling python-js checkout: runtime proofs import tsonic_python_js from it.
export const pythonJsRuntimeRoot = resolve(repositoryRoot, "../python-js/src");

export const strCarrier = { kind: "target-named", id: "python.str" };
export const noneCarrier = { kind: "tuple", elements: [] };
export const int32Carrier = { kind: "source-primitive", name: "int32" };
export const boolCarrier = { kind: "source-primitive", name: "bool" };
export const envCarrier = { kind: "target-named", id: "acme.platform.Env" };
export const vectorCarrier = { kind: "target-named", id: "acme.vectors.Vector" };

export function acmeFilesCapability() {
  return createPythonTargetCapability({
    id: "acme-files",
    displayName: "Acme files",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/files",
      providerModuleId: "acme.files",
      exports: [{
        id: "@acme/files::readText",
        name: "readText",
        kind: "function",
        signatures: [{
          id: "@acme/files::readText(path)",
          name: "readText",
          parameters: [{ name: "path", type: { kind: "string" } }],
          returnType: { kind: "string" },
        }],
      }],
    }],
    operations: [{
      exportId: "@acme/files::readText",
      operationKind: "method",
      target: { form: "call", import: { style: "from", module: "acme_files", name: "read_text" } },
      resultCarrier: strCarrier,
      parameterCarriers: [strCarrier],
    }],
    dependencies: [{ name: "acme-files" }],
  });
}

export function acmeMathCapability() {
  return createPythonTargetCapability({
    id: "acme-math",
    displayName: "Acme math",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/math",
      providerModuleId: "acme.math",
      exports: [{
        id: "@acme/math::add",
        name: "add",
        kind: "function",
        signatures: [{
          id: "@acme/math::add(a,b)",
          name: "add",
          parameters: [
            { name: "a", type: { kind: "source-primitive", name: "int32" } },
            { name: "b", type: { kind: "source-primitive", name: "int32" } },
          ],
          returnType: { kind: "source-primitive", name: "int32" },
        }],
      }],
    }],
    operations: [{
      exportId: "@acme/math::add",
      operationKind: "method",
      // Module-attribute render style: `import acme_math` + `acme_math.add(...)`.
      target: { form: "call", import: { style: "module", module: "acme_math", name: "add" } },
      resultCarrier: int32Carrier,
      parameterCarriers: [int32Carrier, int32Carrier],
    }],
    dependencies: [{ name: "acme-math" }],
  });
}

export function acmePlatformCapability() {
  return createPythonTargetCapability({
    id: "acme-platform",
    displayName: "Acme platform",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/platform",
      providerModuleId: "acme.platform",
      exports: [{
        id: "@acme/platform::Env",
        name: "Env",
        kind: "class",
        members: [
          {
            id: "@acme/platform::Env.constructor",
            name: "constructor",
            kind: "constructor",
            signatures: [{ id: "@acme/platform::Env.constructor()", parameters: [] }],
          },
          { id: "@acme/platform::Env.homeDir", name: "homeDir", kind: "property", readonly: true, type: { kind: "string" } },
        ],
      }],
    }],
    operations: [
      {
        exportId: "@acme/platform::Env",
        operationKind: "constructor",
        target: { form: "constructor", import: { style: "from", module: "acme_platform", name: "Env" } },
        resultCarrier: envCarrier,
        parameterCarriers: [],
      },
      {
        exportId: "@acme/platform::Env",
        memberId: "@acme/platform::Env.homeDir",
        receiverTypeId: "acme.platform.Env",
        operationKind: "property",
        target: { form: "property", name: "home_dir" },
        resultCarrier: strCarrier,
      },
    ],
    dependencies: [{ name: "acme-platform" }],
    targetIdentities: { "@acme/platform::Env": "acme.platform.Env" },
  });
}

export const filePathCarrier = { kind: "target-named", id: "acme.paths.FilePath" };

// Stdlib-style fixture: a pathlib-shaped class with constructor, instance
// property, receiver method, and a class-level static attribute.
export function acmePathsCapability() {
  return createPythonTargetCapability({
    id: "acme-paths",
    displayName: "Acme paths",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/paths",
      providerModuleId: "acme.paths",
      exports: [{
        id: "@acme/paths::FilePath",
        name: "FilePath",
        kind: "class",
        members: [
          {
            id: "@acme/paths::FilePath.constructor",
            name: "constructor",
            kind: "constructor",
            signatures: [{
              id: "@acme/paths::FilePath.constructor(text)",
              parameters: [{ name: "text", type: { kind: "string" } }],
            }],
          },
          { id: "@acme/paths::FilePath.suffix", name: "suffix", kind: "property", readonly: true, type: { kind: "string" } },
          {
            id: "@acme/paths::FilePath.withSuffix",
            name: "withSuffix",
            kind: "method",
            signatures: [{
              id: "@acme/paths::FilePath.withSuffix(next)",
              name: "withSuffix",
              parameters: [{ name: "next", type: { kind: "string" } }],
              returnType: { kind: "provider-ref", moduleSpecifier: "@acme/paths", exportName: "FilePath" },
            }],
          },
          { id: "@acme/paths::FilePath.sep", name: "sep", kind: "property", static: true, readonly: true, type: { kind: "string" } },
        ],
      }],
    }],
    operations: [
      {
        exportId: "@acme/paths::FilePath",
        operationKind: "constructor",
        target: { form: "constructor", import: { style: "from", module: "acme_paths", name: "FilePath" } },
        resultCarrier: filePathCarrier,
        parameterCarriers: [strCarrier],
      },
      {
        exportId: "@acme/paths::FilePath",
        memberId: "@acme/paths::FilePath.suffix",
        receiverTypeId: "acme.paths.FilePath",
        operationKind: "property",
        target: { form: "property", name: "suffix" },
        resultCarrier: strCarrier,
      },
      {
        exportId: "@acme/paths::FilePath",
        memberId: "@acme/paths::FilePath.withSuffix",
        receiverTypeId: "acme.paths.FilePath",
        operationKind: "method",
        target: { form: "method", name: "with_suffix" },
        resultCarrier: filePathCarrier,
        parameterCarriers: [strCarrier],
      },
      {
        exportId: "@acme/paths::FilePath",
        memberId: "@acme/paths::FilePath.sep",
        operationKind: "property",
        target: { form: "static-attribute", import: { style: "from", module: "acme_paths", name: "FilePath" }, name: "sep" },
        resultCarrier: strCarrier,
      },
    ],
    dependencies: [{ name: "acme-paths" }],
    targetIdentities: { "@acme/paths::FilePath": "acme.paths.FilePath" },
  });
}

// Async provider fixture: rows marked isAsync lower only as await operands.
export function acmeAioCapability() {
  return createPythonTargetCapability({
    id: "acme-aio",
    displayName: "Acme aio",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/aio",
      providerModuleId: "acme.aio",
      exports: [{
        id: "@acme/aio::fetchText",
        name: "fetchText",
        kind: "function",
        signatures: [{
          id: "@acme/aio::fetchText(key)",
          name: "fetchText",
          parameters: [{ name: "key", type: { kind: "string" } }],
          returnType: { kind: "string" },
        }],
      }],
    }],
    operations: [{
      exportId: "@acme/aio::fetchText",
      operationKind: "method",
      isAsync: true,
      target: { form: "call", import: { style: "from", module: "acme_aio", name: "fetch_text" } },
      resultCarrier: strCarrier,
      parameterCarriers: [strCarrier],
    }],
    dependencies: [{ name: "acme-aio" }],
  });
}

export function acmeVectorsCapability() {
  return createPythonTargetCapability({
    id: "acme-vectors",
    displayName: "Acme vectors",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/vectors",
      providerModuleId: "acme.vectors",
      exports: [{
        id: "@acme/vectors::Vector",
        name: "Vector",
        kind: "class",
        members: [
          {
            id: "@acme/vectors::Vector.constructor",
            name: "constructor",
            kind: "constructor",
            signatures: [{
              id: "@acme/vectors::Vector.constructor(x,y)",
              parameters: [
                { name: "x", type: { kind: "source-primitive", name: "int32" } },
                { name: "y", type: { kind: "source-primitive", name: "int32" } },
              ],
            }],
          },
          {
            id: "@acme/vectors::Vector.indexer",
            name: "indexer",
            kind: "indexer",
            signatures: [{
              id: "@acme/vectors::Vector.indexer(index)",
              parameters: [{ name: "index", type: { kind: "source-primitive", name: "int32" } }],
              returnType: { kind: "source-primitive", name: "int32" },
            }],
          },
        ],
      }],
    }],
    operations: [
      {
        exportId: "@acme/vectors::Vector",
        operationKind: "constructor",
        target: { form: "constructor", import: { style: "from", module: "acme_vectors", name: "Vector" } },
        resultCarrier: vectorCarrier,
        parameterCarriers: [int32Carrier, int32Carrier],
      },
      {
        exportId: "@acme/vectors::Vector",
        receiverTypeId: "acme.vectors.Vector",
        operationKind: "indexer",
        target: { form: "index" },
        resultCarrier: int32Carrier,
        parameterCarriers: [int32Carrier],
      },
    ],
    dependencies: [{ name: "acme-vectors" }],
    targetIdentities: { "@acme/vectors::Vector": "acme.vectors.Vector" },
  });
}

// Structural harness for the installed-plugin contract: stdlib capabilities
// are target-owned (always active through the pack provider); third-party
// capabilities are installed plugins passed as selectedCapabilities, with
// activation driven by source imports resolving their owned modules.
export function createPythonSession({ files, target = { id: "python", options: {} }, capabilities = [], surfaces = [], entryPoint = "index.ts" } = {}) {
  const pack = createPythonTargetPack();
  const project = { entryPoint, targets: [target] };
  const selectedSurfaces = (pack.surfaces ?? []).filter((surface) => surfaces.includes(surface.id));
  const providerContext = {
    project,
    target,
    targetPack: pack,
    selectedSurfaces,
    selectedCapabilities: capabilities,
  };
  const fileMap = new Map(Object.entries(files).map(([name, text]) => [`/src/${name}`, text]));
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: fileMap,
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strictNullChecks: true,
      target: "es2022",
    },
    extensionHostOptions: {
      activeTarget: "python",
      extensions: [
        createTsonicCoreSourceExtension(),
        ...pack.provider.createExtensions(providerContext),
        ...capabilities.flatMap((capability) =>
          capability.createExtensions?.({ ...providerContext, capability }) ?? []),
      ],
    },
  });
  return { session, pack, project, target, providerContext };
}

export function checkPythonSession(harness, fileNames) {
  const { session } = harness;
  const checked = fileNames ?? [...session.getSourceFiles()]
    .filter((sourceFile) => sourceFile !== undefined)
    .map((sourceFile) => session.ast.getFileName(sourceFile))
    .filter((fileName) => fileName.startsWith("/src/"));
  for (const fileName of checked) {
    const diagnostics = formatDiagnostics(session.ensureChecked(session.getSourceFile(fileName)));
    if (diagnostics !== "") {
      throw new Error(`TypeScript diagnostics for ${fileName}:\n${diagnostics}`);
    }
  }
  return session.finalizeExtensions();
}

export function compilePython({ files, target = { id: "python", options: {} }, capabilities = [], surfaces = [], entryPoint = "index.ts" }) {
  const harness = createPythonSession({ files, target, capabilities, surfaces, entryPoint });
  const extensionHost = checkPythonSession(harness);
  const contributionContext = harness.providerContext;
  const paths = { projectFilePath: "tsonic.json", projectRoot: ".", outputRoot: "out", targetOutputRoot: "out/python" };
  const runtimeReferences = [
    ...(harness.pack.provider.runtimeContributions?.(contributionContext).references ?? []),
    ...harness.providerContext.selectedSurfaces.flatMap((surface) =>
      surface.runtimeContributions?.(contributionContext).references ?? []),
    ...capabilities.flatMap((capability) =>
      capability.runtimeContributions?.({ ...contributionContext, capability, paths }).references ?? []),
  ];
  const input = createPythonCompileInputFromSession({
    session: harness.session,
    extensionHost,
    project: harness.project,
    target,
    runtimeReferences,
  });
  const backend = createPythonBackend({ project: harness.project, target });
  return { result: backend.compile(input), extensionHost, harness };
}

export function artifactText(result, path) {
  const artifact = result.artifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) {
    throw new Error(`Missing artifact '${path}'. Present: ${result.artifacts.map((a) => a.path).join(", ")}`);
  }
  return artifact.text;
}
