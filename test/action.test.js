import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("GitHub Action installs from action source by default", async () => {
  const action = parse(await readFile("action.yml", "utf8"));
  const installStep = action.runs.steps.find((step) => step.name === "Install ToolPin");

  assert.equal(action.inputs["toolpin-version"].default, "");
  assert.match(installStep.run, /\$GITHUB_ACTION_PATH/);
  assert.match(installStep.run, /npm ci --prefix/);
  assert.match(installStep.run, /npm install -g "toolpin@\$\{TOOLPIN_VERSION\}"/);
});
