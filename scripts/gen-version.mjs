#!/usr/bin/env node
// Generates src/version.ts from package.json so the version has a single source
// of truth. Runs in `prebuild`. Idempotent: only writes when the content would
// change, so normal builds leave the working tree clean. `docs:check` still
// asserts version.ts matches package.json as a defense in depth.
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  console.error("gen-version: package.json has no version string");
  process.exit(1);
}

const target = new URL("src/version.ts", root);
const contents = `// Generated from package.json by scripts/gen-version.mjs. Do not edit by hand.
export const TOOLPIN_VERSION = ${JSON.stringify(version)};
`;

const current = await readFile(target, "utf8").catch(() => "");
if (current === contents) process.exit(0);

await writeFile(target, contents, "utf8");
console.log(`gen-version: wrote src/version.ts (TOOLPIN_VERSION = ${version})`);
