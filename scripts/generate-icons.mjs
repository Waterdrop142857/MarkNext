import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The two SVGs are the editable sources. Tauri's installed CLI generates all
// desktop formats; mobile exports stay in the disposable temporary directory.
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
const destination = join(root, "src-tauri", "icons");
const appSvg = readFileSync(join(root, "public", "icons", "marknext.svg"), "utf8");
const logo = appSvg.replace(/^\s*<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
const documentSource = join(root, "public", "icons", "markdown.svg");
const documentSvg = readFileSync(documentSource, "utf8");
const logoSection = /<!-- software-logo:start -->[\s\S]*?<!-- software-logo:end -->/;
if (!logoSection.test(documentSvg)) throw new Error("The Markdown SVG must contain a software-logo section.");
// Keep the small embedded software logo in sync without external SVG links.
const synchronized = documentSvg.replace(logoSection, () => `<!-- software-logo:start -->\n${logo.split("\n").map(line => `    ${line}`).join("\n")}\n    <!-- software-logo:end -->`);
if (synchronized !== documentSvg) writeFileSync(documentSource, synchronized);
const temporary = mkdtempSync(join(tmpdir(), "marknext-icons-"));
try {
  for (const name of ["marknext", "markdown"]) {
    const output = join(temporary, name);
    const result = spawnSync(process.execPath, [cli, "icon", join(root, "public", "icons", `${name}.svg`), "--output", output], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Icon export failed: ${name} (${result.signal ?? result.status})`);
  }
  mkdirSync(destination, { recursive: true });
  for (const file of readdirSync(join(temporary, "marknext"), { withFileTypes: true })) {
    if (file.isFile() && /\.(png|ico|icns)$/.test(file.name)) {
      copyFileSync(join(temporary, "marknext", file.name), join(destination, file.name));
    }
  }
  for (const extension of ["png", "ico", "icns"]) {
    copyFileSync(join(temporary, "markdown", `icon.${extension}`), join(destination, `markdown.${extension}`));
  }
  console.log("Exported application and Markdown desktop icons from SVG.");
}
finally { rmSync(temporary, { recursive: true, force: true }); }
