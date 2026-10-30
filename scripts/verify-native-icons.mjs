// Verify the actual packaged metadata/resources, after tauri build/bundle.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const tauri = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const configuration = JSON.parse(readFileSync(join(tauri, "tauri.conf.json"), "utf8"));
const directory = resolve(process.argv[2] ?? join(tauri, "target/release/bundle"));
const { bundle, productName } = configuration;
const sameIcon = (actual, source) => assert.deepEqual(actual, readFileSync(resolve(tauri, source)), `Document icon mismatch: ${source}`);

if (process.platform === "darwin") {
  const contents = join(directory, "macos", `${productName}.app`, "Contents");
  const plist = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(contents, "Info.plist")], { encoding: "utf8" }));
  assert.equal(plist.CFBundleIdentifier, configuration.identifier);
  const types = plist.CFBundleDocumentTypes;
  assert.equal(types.length, bundle.fileAssociations.length);
  for (const association of bundle.fileAssociations) {
    const type = types.find(type => type.CFBundleTypeName === association.name);
    assert.ok(type, `Missing association: ${association.name}`);
    assert.deepEqual(type.CFBundleTypeExtensions, association.ext);
    assert.equal(type.CFBundleTypeRole, "Editor");
    assert.equal(type.LSHandlerRank, "Alternate");
    const name = type.CFBundleTypeIconFile;
    assert.ok(name && name !== plist.CFBundleIconFile, "Document icon must be separate from app icon");
    sameIcon(readFileSync(join(contents, "Resources", name)), bundle.macOS.files[`Resources/${name}`]);
  }
  const markdown = plist.UTImportedTypeDeclarations.find(type => type.UTTypeIdentifier === "net.daringfireball.markdown");
  assert.ok(markdown, "Missing imported Markdown UTI");
  assert.equal(markdown.UTTypeIconFile, "markdown.icns");
  assert.deepEqual(markdown.UTTypeTagSpecification["public.filename-extension"], ["md", "markdown"]);
  assert.ok(types.find(type => type.LSItemContentTypes.includes("net.daringfireball.markdown")));
  assert.ok(readFileSync(join(contents, "Resources", plist.CFBundleIconFile)).length);
} else if (process.platform === "linux") {
  // Read the final DEB archive rather than trusting only its staging directory.
  const debDirectory = join(directory, "deb");
  const name = `${productName}_${configuration.version}_`;
  const debs = readdirSync(debDirectory).filter(file => file.startsWith(name) && file.endsWith(".deb"));
  assert.equal(debs.length, 1, "Expected exactly one current-version DEB");
  const deb = join(debDirectory, debs[0]);
  const members = execFileSync("ar", ["t", deb], { encoding: "utf8" }).trim().split("\n");
  assert.ok(members.includes("data.tar.gz"), "Expected Tauri's data.tar.gz archive");
  const data = gunzipSync(execFileSync("ar", ["p", deb, "data.tar.gz"], { maxBuffer: 256 * 1024 * 1024 }));
  for (const [path, source] of Object.entries(bundle.linux.deb.files)) {
    const packaged = execFileSync("tar", ["-xOf", "-", path.replace(/^\//, "")], { input: data });
    sameIcon(packaged, source);
  }
  const appDir = join(directory, "appimage", `${productName}.AppDir`);
  for (const [path, source] of Object.entries(bundle.linux.appimage.files)) {
    sameIcon(readFileSync(join(appDir, path.replace(/^\//, ""))), source);
  }
} else {
  throw new Error("Run on Linux or macOS after building its native installers.");
}
console.log(`Native document icon verification passed (${process.platform}).`);
