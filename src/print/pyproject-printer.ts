import type { PyprojectManifestPlan } from "../backend/planner/pyproject.js";

const ruffTargetVersionByPythonVersion = {
  "3.12": "py312",
  "3.13": "py313",
} as const;

export function printPyprojectManifest(manifest: PyprojectManifestPlan): string {
  const lines: string[] = [
    "[project]",
    `name = ${tomlString(manifest.packageName)}`,
    'version = "0.1.0"',
    `requires-python = ${tomlString(`>=${manifest.pythonVersion}`)}`,
  ];
  if (manifest.dependencies.length === 0) {
    lines.push("dependencies = []");
  } else {
    lines.push("dependencies = [");
    for (const dependency of manifest.dependencies) {
      const requirement = dependency.version === undefined
        ? dependency.name
        : `${dependency.name}==${dependency.version}`;
      lines.push(`    ${tomlString(requirement)},`);
    }
    lines.push("]");
  }
  lines.push(
    "",
    "[tool.ruff]",
    `target-version = ${tomlString(ruffTargetVersionByPythonVersion[manifest.pythonVersion])}`,
    "",
    "[tool.pytest.ini_options]",
    'testpaths = ["tests"]',
  );
  return `${lines.join("\n")}\n`;
}

function tomlString(value: string): string {
  let escaped = '"';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\") {
      escaped += "\\\\";
    } else if (character === '"') {
      escaped += '\\"';
    } else if (codePoint < 0x20 || codePoint === 0x7f) {
      escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    } else {
      escaped += character;
    }
  }
  return `${escaped}"`;
}
