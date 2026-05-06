import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await runNodeScript("scripts/run-workspaces.mjs", ["build"]);
await runNodeScript("scripts/smoke-extension-content.mjs", []);
await runNodeScript("scripts/smoke-extension-background.mjs", []);
await runNodeScript("scripts/smoke-server.mjs", []);

function runNodeScript(scriptPath, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
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
      rejectPromise(new Error(`${scriptPath} failed with ${detail}`));
    });
  });
}
