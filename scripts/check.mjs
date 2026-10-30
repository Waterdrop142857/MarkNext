import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] ?? "--all";
if (process.argv.length > 3 || !["--all", "--frontend", "--native"].includes(mode)) {
  throw new Error("Usage: pnpm check | pnpm check:frontend | pnpm check:native");
}
const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) throw new Error("Run this workflow through pnpm.");
await mkdir(join(root, "test-results"), { recursive: true });

function run(label, executable, args, cwd = root) {
  process.stdout.write(`\n[check] ${label}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: "inherit", env: process.env });
    const forwardSignal = signal => child.kill(signal);
    const onInterrupt = () => forwardSignal("SIGINT");
    const onTerminate = () => forwardSignal("SIGTERM");
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal ?? `exit ${code}`}). Remaining checks were not run.`));
    });
  });
}
// npm_execpath may point to pnpm.cjs, a Unix launcher, or a standalone binary.
const pnpm = (label, args) => /\.(?:c|m)?js$/.test(pnpmEntry)
  ? run(label, process.execPath, [pnpmEntry, ...args])
  : run(label, pnpmEntry, args);
const cargo = args => run(`cargo ${args.join(" ")}`, "cargo", args, join(root, "src-tauri"));

try {
  if (mode !== "--native") {
    await pnpm("TypeScript and Vue type checking", ["typecheck"]);
    await pnpm("All Vitest regression tests", ["test:unit"]);
  }
  if (mode !== "--frontend") {
    await cargo(["fmt", "--all", "--", "--check"]);
    await cargo(["check", "--locked"]);
    await cargo(["test", "--locked"]);
    await cargo(["clippy", "--locked", "--all-targets", "--", "-D", "warnings"]);
    // Run the real CLI: its feature flags, beforeBuildCommand and asset
    // embedding/linking are not covered by `cargo check` alone.
    await pnpm("Tauri release binary and production frontend", ["exec", "tauri", "build", "--ci", "--no-bundle", "--", "--locked"]);
    // Also guard the plain release configuration (without CLI devtools flags).
    await cargo(["check", "--release", "--locked"]);
    await cargo(["clippy", "--release", "--locked", "--all-targets", "--", "-D", "warnings"]);
  }
  else {
    await pnpm("Production frontend build", ["build"]);
  }
  if (mode !== "--native") {
    await pnpm("Chromium and WebKit UI/security regressions", ["exec", "playwright", "test"]);
  }
  process.stdout.write(`\n[check] All requested checks passed (${mode}).\n`);
}
catch (error) {
  process.stderr.write(`\n[check] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
