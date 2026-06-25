import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("CLI rejects known disabled registry sources before fetching", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [CLI, "search", "github", "--source", "smithery"]),
    /--source smithery is known but not enabled yet/,
  );
});

test("CLI boolean flags do not consume positional arguments", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      CLI,
      "remove",
      "--project",
      "io.github/example",
      "--client",
      "claude",
    ]);

    assert.match(stdout, /Remove/);
    assert.match(stdout, /server\s+io\.github\/example/);
  });
});

test("CLI treats unknown double-dash flags as boolean for positional parsing", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      CLI,
      "remove",
      "--future-boolean",
      "io.github/example",
      "--client",
      "claude",
    ]);

    assert.match(stdout, /Remove/);
    assert.match(stdout, /server\s+io\.github\/example/);
  });
});

test("CLI accepts short client and scope aliases", async () => {
  await withTempCwd(async () => {
    const listed = await execFileAsync(process.execPath, [CLI, "list", "-s", "global", "-c", "continue", "--json"]);
    const parsed = JSON.parse(listed.stdout);

    assert.equal(parsed.checked, 1);
    assert.equal(parsed.entries.length, 0);

    const removed = await execFileAsync(process.execPath, [
      CLI,
      "remove",
      "-p",
      "io.github/example",
      "-c",
      "claude",
    ]);

    assert.match(removed.stdout, /Remove/);
    assert.match(removed.stdout, /scope\s+project/);
    assert.match(removed.stdout, /server\s+io\.github\/example/);
  });
});

test("CLI accepts npm-style -g as global scope", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI, "doctor", "-g", "--json"]);
    const parsed = JSON.parse(stdout);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.checked, 0);
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-cli-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}
