import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDirs = [
  join(rootDir, "packages", "extension"),
  join(rootDir, "packages", "server"),
];
const [scriptName, ...filters] = process.argv.slice(2);

if (!scriptName) {
  console.error(
    "Usage: node scripts/run-workspaces.mjs <script> [package-name-or-path...]",
  );
  process.exit(1);
}

const workspaces = await Promise.all(workspaceDirs.map(readWorkspacePackage));
const selectedWorkspaces =
  filters.length > 0
    ? workspaces.filter((workspace) =>
        filters.some((filter) => matchesWorkspace(workspace, filter)),
      )
    : workspaces;

if (selectedWorkspaces.length === 0) {
  console.error(`No workspace matched: ${filters.join(", ")}`);
  process.exit(1);
}

for (const workspace of selectedWorkspaces) {
  const script = workspace.scripts[scriptName];

  if (!script) {
    console.log(`Skipping ${workspace.name}: missing "${scriptName}" script.`);
    continue;
  }

  console.log(`\n> ${workspace.name} ${scriptName}`);
  await runScript(script, workspace.dir);
}

async function readWorkspacePackage(dir) {
  const packageJsonPath = join(dir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  return {
    dir,
    name: packageJson.name,
    scripts: packageJson.scripts ?? {},
  };
}

function matchesWorkspace(workspace, filter) {
  const normalizedFilter = normalizePath(filter);
  const normalizedDir = normalizePath(workspace.dir);
  const normalizedRelativeDir = normalizePath(
    workspace.dir.slice(rootDir.length + 1),
  );

  return (
    workspace.name === filter ||
    normalizedDir.endsWith(normalizedFilter) ||
    normalizedRelativeDir === normalizedFilter
  );
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/\/$/, "");
}

function runScript(script, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const env = {
      ...process.env,
      PATH: [
        join(cwd, "node_modules", ".bin"),
        join(rootDir, "node_modules", ".bin"),
        process.env.PATH ?? "",
      ].join(delimiter),
    };

    const child = spawn(script, {
      cwd,
      env,
      shell: true,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const detail = signal
        ? `signal ${signal}`
        : `exit code ${code ?? "unknown"}`;
      rejectPromise(new Error(`Script failed in ${cwd}: ${detail}`));
    });
  });
}
