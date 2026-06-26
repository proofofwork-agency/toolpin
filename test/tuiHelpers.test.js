import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTuiVersionInfo,
  commandLineFor,
  commandLogForView,
  configTargetLabel,
  formatVersionChoices,
  installClientChoicesForScope,
  selectedClientsForScope,
} from "../dist/tui.js";

test("TUI command-line rendering quotes values and keeps active source/live flags", () => {
  const state = {
    query: "github tools",
    sourceMode: "docker",
    dataMode: "live",
    client: "all",
    installScope: "global",
  };
  const server = serverFixture({ name: "demo server", version: "1.2.0" });

  assert.equal(commandLineFor("search", state), 'toolpin search "github tools" --source docker --live');
  assert.equal(commandLineFor("install", state, server), 'toolpin install "demo server" --client all --scope global --source docker --live');
  assert.equal(commandLineFor("remove", state, server), 'toolpin remove "demo server" --client all --scope global --file mcp-lock.json');
  assert.equal(commandLineFor("test", state), "toolpin test <server-name> --source docker --live --timeout 15000");
});

test("TUI all-client selection respects project and global scope support", () => {
  assert.deepEqual(selectedClientsForScope("opencode", "project"), ["opencode"]);
  assert.deepEqual(selectedClientsForScope("all", "project"), ["claude", "cursor", "vscode", "codex", "opencode", "gemini", "roo"]);
  assert.deepEqual(selectedClientsForScope("all", "global"), ["cursor", "vscode", "codex", "opencode", "windsurf", "cline", "continue", "gemini"]);
});

test("TUI install wizard puts the selected client first when it is valid for scope", () => {
  assert.deepEqual(installClientChoicesForScope("project", "opencode").slice(0, 3), ["opencode", "claude", "cursor"]);
  assert.deepEqual(installClientChoicesForScope("global", "all").slice(0, 3), ["all", "cursor", "vscode"]);
  assert.deepEqual(installClientChoicesForScope("project", "windsurf").slice(0, 3), ["claude", "cursor", "vscode"]);
});

test("TUI installed view keeps update and adopt operation logs visible", () => {
  const updateLog = { title: "update", command: "toolpin update server", ok: true, lines: ["updated server"] };
  const adoptLog = { title: "adopt", command: "toolpin adopt server", ok: true, lines: ["adopted server"] };

  assert.equal(commandLogForView({ view: "installed", commandLog: updateLog }), updateLog);
  assert.equal(commandLogForView({ view: "installed", commandLog: adoptLog }), adoptLog);
  assert.equal(commandLogForView({ view: "discover", commandLog: updateLog }), undefined);
});

test("TUI version labels report selected, locked, latest, and older versions", () => {
  const servers = [
    serverFixture({ version: "1.2.0", isLatest: true }),
    serverFixture({ version: "1.1.0" }),
    serverFixture({ version: "1.0.0" }),
  ];
  const lockfile = {
    lockfileVersion: 2,
    generatedAt: "2026-01-01T00:00:00.000Z",
    servers: {
      "example/server:claude": { name: "example/server", version: "1.0.0", client: "claude" },
    },
  };

  const info = buildTuiVersionInfo(servers, "example/server", "1.1.0", lockfile, "claude", "project");

  assert.deepEqual(info, {
    selectedVersion: "1.1.0",
    latestVersion: "1.2.0",
    lockedLabel: "1.0.0",
    status: "update available",
    versions: ["1.2.0", "1.1.0", "1.0.0"],
  });
  assert.equal(formatVersionChoices(info, 2), "1.2.0 latest, [1.1.0] +1 more");
});

test("TUI version labels report unknown for non-semver locked comparisons", () => {
  const servers = [
    serverFixture({ version: "20f7c0f0dbe3", isLatest: true }),
    serverFixture({ version: "9fceb02d0ae5" }),
  ];
  const lockfile = {
    lockfileVersion: 2,
    generatedAt: "2026-01-01T00:00:00.000Z",
    servers: {
      "example/server:claude": { name: "example/server", version: "9fceb02d0ae5", client: "claude" },
    },
  };

  const info = buildTuiVersionInfo(servers, "example/server", "20f7c0f0dbe3", lockfile, "claude", "project");

  assert.equal(info.latestVersion, "20f7c0f0dbe3");
  assert.equal(info.lockedLabel, "9fceb02d0ae5");
  assert.equal(info.status, "unknown");
});

test("TUI config target labels use resolved install targets and preserve unsupported-scope errors", () => {
  assert.match(configTargetLabel("codex", "project"), /(?:^|\/)\.codex\/config\.toml$/);
  assert.match(configTargetLabel("opencode", "global"), /(?:^|\/)\.config\/opencode\/opencode\.json$/);
  assert.equal(configTargetLabel("windsurf", "project"), "Project Windsurf/Cascade MCP config path is not documented; use --scope global.");
});

function serverFixture(overrides = {}) {
  const version = overrides.version ?? "1.0.0";
  return {
    registrySource: "official",
    name: "example/server",
    title: "Example Server",
    description: "Example server",
    version,
    isLatest: false,
    packageTypes: ["npm"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: false,
    raw: {
      name: "example/server",
      title: "Example Server",
      description: "Example server",
      version,
      packages: [{ registryType: "npm", identifier: "example-server", version }],
    },
    ...overrides,
  };
}
