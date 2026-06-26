import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "ink";
import {
  browseSearchResults,
  buildTuiVersionInfo,
  cacheCoverage,
  commandLineFor,
  commandLogForView,
  configTargetLabel,
  formatVersionChoices,
  initialInstallVersionIndex,
  installClientChoicesForScope,
  InstallWizard,
  nextResultLimit,
  OptionList,
  persistentRefreshOptions,
  selectedClientsForScope,
  sourceCountLabel,
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

test("TUI install wizard starts on selected version when v/V picked one", () => {
  const versions = [
    serverFixture({ version: "1.2.0", isLatest: true }),
    serverFixture({ version: "1.1.0" }),
    serverFixture({ version: "1.0.0" }),
  ];

  assert.equal(initialInstallVersionIndex(versions, "1.1.0"), 1);
  assert.equal(initialInstallVersionIndex(versions, "9.9.9"), 0);
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

test("TUI cache coverage accepts zero-entry cache partitions for unavailable enabled sources", () => {
  for (const status of ["auth-missing", "stale", "fetch-error", "disabled"]) {
    const coverage = cacheCoverage(
      [
        entryFixture("official"),
        entryFixture("docker"),
        entryFixture("smithery"),
      ],
      "all",
      [
        sourceFixture("official", { cacheEntries: 1 }),
        sourceFixture("docker", { cacheEntries: 1 }),
        sourceFixture("smithery", { cacheEntries: 1 }),
        sourceFixture("pulsemcp", { status, cacheEntries: 0 }),
      ],
    );

    assert.deepEqual(coverage, { covered: true, missing: [] }, status);
  }

  const missingPartition = cacheCoverage(
    [entryFixture("official"), entryFixture("docker"), entryFixture("smithery")],
    "all",
    [
      sourceFixture("official", { cacheEntries: 1 }),
      sourceFixture("docker", { cacheEntries: 1 }),
      sourceFixture("smithery", { cacheEntries: 1 }),
      sourceFixture("pulsemcp", { status: "auth-missing" }),
    ],
  );
  assert.deepEqual(missingPartition, { covered: false, missing: ["pulsemcp"] });
});

test("TUI persistent refresh is source-wide and uses broad cache settings", () => {
  const options = persistentRefreshOptions("all");

  assert.deepEqual(options, { source: "all", limit: 500, maxPages: 25 });
  assert.equal("search" in options, false);
});

test("TUI browse ranking reaches beyond 500 matches while initially showing 50", () => {
  const servers = Array.from({ length: 625 }, (_, index) => serverFixture({
    name: `example/matching-${index}`,
    title: `Matching Server ${index}`,
    isLatest: true,
  }));
  const results = browseSearchResults(servers, "matching", "latest");
  let shown = 50;

  assert.equal(results.length, 625);
  assert.equal(shown, 50);
  while (shown < results.length) shown = nextResultLimit(shown, results.length);
  assert.equal(shown, 625);
});

test("TUI source count labels mark partial cached and loaded sources", () => {
  const source = sourceFixture("official", {
    cachePageInfo: { fetchedPages: 3, maxPages: 25, hasMore: true },
  });

  assert.equal(sourceCountLabel(source, 300, "cache"), "300+ cached");
  assert.equal(sourceCountLabel(source, 400, "live"), "400+ loaded");
  assert.equal(sourceCountLabel(sourceFixture("docker"), 328, "cache"), "328 cached");
});

test("TUI empty browse state renders loader only while initial registry data is loading", () => {
  const loading = renderToString(React.createElement(OptionList, {
    results: [],
    totalMatches: 0,
    totalServers: 0,
    totalVersions: 0,
    selected: 0,
    height: 12,
    width: 80,
    query: "",
    loading: true,
    browseLayout: "flat",
  }));
  const empty = renderToString(React.createElement(OptionList, {
    results: [],
    totalMatches: 0,
    totalServers: 0,
    totalVersions: 0,
    selected: 0,
    height: 12,
    width: 80,
    query: "",
    loading: false,
    browseLayout: "flat",
  }));

  assert.match(loading, /ToolPin sync/);
  assert.match(loading, /registry/);
  assert.doesNotMatch(loading, /No servers found/);
  assert.match(empty, /No servers found/);
});

test("TUI install wizard uses step counts before install and activity bar only while installing", () => {
  const flow = installFlowFixture({ step: "client", scope: "project" });
  const choosing = renderToString(React.createElement(InstallWizard, {
    flow,
    width: 80,
    height: 16,
  }));
  const installing = renderToString(React.createElement(InstallWizard, {
    flow: { ...flow, step: "installing", selected: 0 },
    width: 80,
    height: 16,
  }));
  const complete = renderToString(React.createElement(InstallWizard, {
    flow: { ...flow, step: "complete", selected: 0 },
    width: 80,
    height: 16,
  }));

  assert.match(choosing, /Choose client/);
  assert.match(choosing, /Step 2 of 2/);
  assert.doesNotMatch(choosing, /100%|progress|installing/);
  assert.match(installing, /Writing config and mcp-lock\.json/);
  assert.match(installing, /installing/);
  assert.doesNotMatch(installing, /Step \d of \d|100%|progress 100%/);
  assert.match(complete, /Install complete/);
  assert.doesNotMatch(complete, /100%|progress/);
});

function entryFixture(source) {
  return {
    source,
    server: {
      name: `example/${source}`,
      title: `${source} server`,
      version: "1.0.0",
      packages: [{ registryType: "npm", identifier: `@example/${source}`, version: "1.0.0" }],
    },
  };
}

function sourceFixture(id, overrides = {}) {
  return {
    id,
    label: id,
    type: id,
    mode: id === "official" || id === "docker" ? "installable" : "discovery",
    trust: id === "official" ? "canonical" : id === "docker" ? "curated" : "directory",
    enabled: true,
    authRequired: id === "pulsemcp",
    description: `${id} source`,
    status: id === "official" || id === "docker" ? "ready" : "discovery-only",
    ...overrides,
  };
}

function installFlowFixture(overrides = {}) {
  return {
    step: "scope",
    server: serverFixture({ name: "example/installable", title: "Installable Server", isLatest: true }),
    versions: [serverFixture({ name: "example/installable", title: "Installable Server", isLatest: true })],
    scope: undefined,
    preferredClient: "claude",
    selected: 0,
    ...overrides,
  };
}

function serverFixture(overrides = {}) {
  const version = overrides.version ?? "1.0.0";
  return {
    registrySource: "official",
    registryMode: "installable",
    name: "example/server",
    title: "Example Server",
    description: "Example server",
    version,
    isLatest: false,
    installable: true,
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
