import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INTERACTIVE_OPTIONS,
  actionWrites,
  buildCommandPreview,
  buildPrefill,
  highlightMatch,
  interactiveSearch,
  noInputGuidance,
  registryFetchSearchQuery,
  resultLine,
  selectInitialResult,
} from "../dist/interactive/workflow.js";

test("interactive workflow filters with existing search ranking and marks matched terms", () => {
  const servers = [
    packageServer({ name: "io.github/example", title: "GitHub Example" }),
    packageServer({ name: "io.slack/example", title: "Slack Example", repositoryUrl: "https://example.com/slack" }),
  ];
  const results = interactiveSearch(servers, "github", 5);

  assert.equal(results.length, 1);
  assert.equal(results[0].server.name, "io.github/example");
  assert.match(resultLine(results[0], "github"), /\[github\]/i);
  assert.equal(highlightMatch("GitHub Example", "github"), "[GitHub] Example");
});

test("interactive workflow treats source ids as local filters for live fetch search", () => {
  const sources = new Set(["toolpin", "official", "docker"]);

  assert.equal(registryFetchSearchQuery("toolpin", sources), undefined);
  assert.equal(registryFetchSearchQuery("toolpin github", sources), "github");
  assert.equal(registryFetchSearchQuery("official context relay", sources), "context relay");
});

test("interactive workflow auto-selects exact matches", () => {
  const results = interactiveSearch([
    packageServer({ name: "io.github/alpha", title: "Alpha" }),
    packageServer({ name: "io.github/beta", title: "Beta" }),
  ], "io.github/beta", 10);

  assert.equal(selectInitialResult(results, "io.github/beta"), 0);
});

test("interactive workflow prefills client, scope, version, and action from flags and lockfile", () => {
  const server = packageServer({ name: "io.github/example", version: "2.0.0" });
  const options = {
    ...DEFAULT_INTERACTIVE_OPTIONS,
    query: "example",
    client: "codex",
    scope: "global",
    version: "1.5.0",
  };
  const prefill = buildPrefill(server, options, lockfileFor("io.github/example", "claude", "project", "1.0.0"));

  assert.equal(prefill.client, "codex");
  assert.equal(prefill.scope, "global");
  assert.equal(prefill.version, "1.5.0");
  assert.equal(prefill.lockedOutdated, false);
  assert.equal(prefill.recommendation, "Install + lock");
});

test("interactive workflow uses locked context and detects outdated entries", () => {
  const server = packageServer({ name: "io.github/example", version: "2.0.0" });
  const prefill = buildPrefill(server, {
    ...DEFAULT_INTERACTIVE_OPTIONS,
    query: "example",
  }, lockfileFor("io.github/example", "claude", "project", "1.0.0"));

  assert.equal(prefill.client, "claude");
  assert.equal(prefill.scope, "project");
  assert.equal(prefill.version, "1.0.0");
  assert.equal(prefill.lockedVersion, "1.0.0");
  assert.equal(prefill.lockedOutdated, true);
  assert.equal(prefill.recommendation, "Update lock/install");
});

test("interactive workflow builds exact command previews", () => {
  const server = packageServer({ name: "io.github/example", version: "2.0.0" });

  assert.equal(buildCommandPreview({
    action: "install-lock",
    server,
    client: "claude",
    scope: "project",
    source: "official",
    version: "2.0.0",
    verify: true,
    requireVerified: true,
    timeoutMs: 3000,
    enforcePolicy: false,
  }), "toolpin install io.github/example --client claude --scope project --update-lock --source official --version 2.0.0 --verify --require-verified --timeout 3000 --no-policy");

  assert.equal(buildCommandPreview({
    action: "lock-only",
    server,
    client: "codex",
    scope: "global",
    source: "all",
    version: "2.0.0",
  }), "toolpin lock io.github/example --client codex --scope global --source all --version 2.0.0");

  assert.equal(buildCommandPreview({
    action: "cancel",
    server,
    client: "claude",
    scope: "project",
    source: "official",
  }), "No command; cancel exits without writes.");
});

test("interactive workflow no-input guidance and action write classification are explicit", () => {
  const server = packageServer({ name: "io.github/example", title: "GitHub Example" });
  const results = interactiveSearch([server], "github", 10);
  const guidance = noInputGuidance({
    ...DEFAULT_INTERACTIVE_OPTIONS,
    query: "github",
    source: "official",
    client: "claude",
    scope: "project",
  }, results);

  assert.match(guidance, /Equivalent one-shot command:/);
  assert.match(guidance, /No files were written/);
  assert.equal(actionWrites("install-lock"), true);
  assert.equal(actionWrites("lock-only"), true);
  assert.equal(actionWrites("export-config"), false);
  assert.equal(actionWrites("print-command"), false);
  assert.equal(actionWrites("cancel"), false);
});

function lockfileFor(name, client, scope, version) {
  return {
    lockfileVersion: 2,
    generatedAt: new Date(0).toISOString(),
    servers: {
      [`${name}:${client}`]: {
        name,
        version,
        client,
        scope,
        selectedTarget: {},
        trust: { score: 50, badges: [], issues: [] },
        config: {},
        notes: [],
        resolvedAt: new Date(0).toISOString(),
      },
    },
  };
}

function packageServer(overrides = {}) {
  const name = overrides.name ?? "io.github/example";
  const version = overrides.version ?? "1.0.0";
  return {
    registrySource: overrides.registrySource ?? "official",
    registryMode: "installable",
    name,
    title: overrides.title ?? name,
    description: overrides.description ?? "Example MCP server",
    version,
    isLatest: overrides.isLatest ?? true,
    installable: true,
    repositoryUrl: overrides.repositoryUrl ?? `https://github.com/example/${name.split("/").pop()}`,
    packageTypes: ["npm"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: false,
    raw: {
      name,
      title: overrides.title ?? name,
      description: overrides.description ?? "Example MCP server",
      version,
      packages: [
        {
          registryType: "npm",
          identifier: overrides.identifier ?? "@example/server",
          version,
          transport: { type: "stdio" },
        },
      ],
      repository: { url: overrides.repositoryUrl ?? `https://github.com/example/${name.split("/").pop()}` },
    },
  };
}
