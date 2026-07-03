// Fake npm-installed Python capability plugin: exports the generic plugin
// entry and builds its capability with the target-owned factory.
import { createPythonTargetCapability } from "@tsonic/target-python";

const strCarrier = { kind: "target-named", id: "python.str" };

export function createTsonicPlugin() {
  return createPythonTargetCapability({
    id: "@acme/tsonic-python-files",
    displayName: "Acme Python files",
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
