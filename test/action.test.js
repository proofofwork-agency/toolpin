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
  assert.match(installStep.run, /npm install -g "@proofofwork-agency\/toolpin@\$\{TOOLPIN_VERSION\}"/);
});

test("GitHub Action exposes CI hardening inputs, output, and branding", async () => {
  const action = parse(await readFile("action.yml", "utf8"));

  assert.equal(action.inputs.source.default, "");
  assert.equal(action.inputs.doctor.default, "auto");
  assert.equal(action.inputs.strict.default, "false");
  assert.equal(action.inputs.verify.default, "");
  assert.equal(action.inputs["require-verified"].default, "");
  assert.equal(action.inputs.sarif.default, "false");
  assert.equal(action.outputs["sarif-path"].value, "${{ steps.toolpin-ci.outputs.sarif-path }}");
  assert.deepEqual(action.branding, { icon: "lock", color: "blue" });
});

test("GitHub Action command builder covers CI input matrix", async () => {
  const action = parse(await readFile("action.yml", "utf8"));
  const step = action.runs.steps.find((entry) => entry.name === "Run toolpin ci");
  const script = step.run;

  assert.equal(step.id, "toolpin-ci");
  assert.equal(step["working-directory"], "${{ inputs.working-directory }}");
  assert.match(script, /cmd=\(toolpin ci --file "\$TOOLPIN_FILE"\)/);
  assert.match(script, /if \[\[ -n "\$TOOLPIN_SOURCE" \]\]; then\s+cmd\+=\(--source "\$TOOLPIN_SOURCE"\)/);
  assert.match(script, /cmd\+=\(--live\)/);
  assert.match(script, /cmd\+=\(--verify --timeout "\$TOOLPIN_TIMEOUT"\)/);
  assert.match(script, /cmd\+=\(--require-verified\)/);
  assert.match(script, /cmd\+=\(--skip-live-verification\)/);
  assert.match(script, /cmd\+=\(--allow-execute\)/);
  assert.match(script, /cmd\+=\(--expect-digest "\$TOOLPIN_EXPECT_DIGEST"\)/);
  assert.match(script, /cmd\+=\(--signature "\$TOOLPIN_SIGNATURE" --public-key "\$TOOLPIN_PUBLIC_KEY"\)/);
  assert.match(script, /cmd\+=\(--no-policy\)/);
  assert.match(script, /cmd\+=\(--policy "\$TOOLPIN_POLICY"\)/);
  assert.match(script, /cmd\+=\(--sarif\)/);
  assert.match(script, /"\$\{cmd\[@\]\}" > "\$sarif_path"/);
  assert.match(script, /echo "sarif-path=\$sarif_path" >> "\$GITHUB_OUTPUT"/);
});

test("GitHub Action doctor modes and strict conflicts fail closed", async () => {
  const action = parse(await readFile("action.yml", "utf8"));
  const script = action.runs.steps.find((entry) => entry.name === "Run toolpin ci").run;

  assert.match(script, /TOOLPIN_DOCTOR" != "auto"/);
  assert.match(script, /for project_config in \.mcp\.json \.cursor\/mcp\.json \.vscode\/mcp\.json \.codex\/config\.toml opencode\.json \.gemini\/settings\.json \.roo\/mcp\.json/);
  assert.match(script, /doctor_cmd=\(toolpin doctor --file "\$TOOLPIN_FILE" --scope project\)/);
  assert.match(script, /ToolPin doctor: SKIPPED/);
  assert.match(script, /strict:true requires verify:true/);
  assert.match(script, /strict:true requires require-verified:true/);
  assert.match(script, /require-verified:true requires verify:true/);
  assert.match(script, /ToolPin CI requires both signature and public-key when either is set/);
});
