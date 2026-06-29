import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const canonicalRepositoryUrl = "git+https://github.com/proofofwork-agency/toolpin.git";
const canonicalHomepage = "https://proofofwork-agency.github.io/toolpin/";
const canonicalIssuesUrl = "https://github.com/proofofwork-agency/toolpin/issues";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assertField(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function npmView(args) {
  return spawnSync("npm", ["view", ...args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isNotFound(result) {
  return `${result.stdout}\n${result.stderr}`.includes("E404");
}

assertField(packageJson.name === "@proofofwork-agency/toolpin", "package name must be @proofofwork-agency/toolpin");
assertField(packageJson.version, "package version is required");
assertField(packageJson.license === "Apache-2.0", "license must be Apache-2.0");
assertField(packageJson.repository?.url, "repository.url is required before publish");
assertField(packageJson.homepage, "homepage is required before publish");
assertField(packageJson.bugs?.url, "bugs.url is required before publish");
assertField(packageJson.repository?.url === canonicalRepositoryUrl, `repository.url must be ${canonicalRepositoryUrl}`);
assertField(packageJson.homepage === canonicalHomepage, `homepage must be ${canonicalHomepage}`);
assertField(packageJson.bugs?.url === canonicalIssuesUrl, `bugs.url must be ${canonicalIssuesUrl}`);
assertField(packageJson.bin?.toolpin === "dist/cli.js", "toolpin bin must point at dist/cli.js");
assertField(packageJson.bin?.tpn === "dist/cli.js", "tpn bin must point at dist/cli.js");
assertField(packageJson.files?.includes("dist"), "npm files must include dist");
assertField(packageJson.files?.includes("README.md"), "npm files must include README.md");
assertField(packageJson.files?.includes("LICENSE"), "npm files must include LICENSE");

if (process.exitCode) {
  process.exit(process.exitCode);
}

const nameResult = npmView([packageJson.name, "name"]);
if (nameResult.status === 0) {
  console.log(`npm package name ${packageJson.name} already exists; confirm npm ownership before publishing.`);
} else if (isNotFound(nameResult)) {
  console.log(`npm package name ${packageJson.name} is not published yet.`);
} else {
  console.error(nameResult.stderr || nameResult.stdout);
  fail(`could not check npm package name ${packageJson.name}`);
}

const versionResult = npmView([`${packageJson.name}@${packageJson.version}`, "version"]);
if (versionResult.status === 0) {
  fail(`npm version ${packageJson.name}@${packageJson.version} already exists; bump version before publishing.`);
} else if (isNotFound(versionResult)) {
  console.log(`npm version ${packageJson.name}@${packageJson.version} is not published yet.`);
} else {
  console.error(versionResult.stderr || versionResult.stdout);
  fail(`could not check npm version ${packageJson.name}@${packageJson.version}`);
}
