import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInstallPlan } from "../dist/plan.js";
import { canonicalRepoUrl, compareRegistrySources, dedupeRegistryEntries, enrichGlamaTarget, enrichSmitheryTarget, fetchRegistry, fetchRegistryResult, listRegistrySources, normalizeEntry, readCache, readCacheMetadata, refreshCache, retryAfterDelayMs, updateRegistrySourceEnabled } from "../dist/registry.js";

const TOOLPIN_REGISTRY_URL = "https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0/servers";

test("fetchRegistry retries one 429 response with an injected fetch", async () => {
  const calls = [];
  const entries = await fetchRegistry({
    registryUrl: "https://registry.test/v0",
    maxPages: 1,
    retryBackoffMs: 0,
    fetch: async (url, init) => {
      calls.push({ url: String(url), signal: init?.signal });
      return calls.length === 1
        ? jsonResponse(429, { error: "slow down" }, "Too Many Requests")
        : jsonResponse(200, { servers: [registryEntry()] });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://registry.test/v0/servers?limit=100");
  assert.equal(typeof calls[0].signal?.aborted, "boolean");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "official");
});

test("directory sources are disabled by default and can be enabled in source preferences", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "registries.json");
    const defaults = await listRegistrySources({ registryConfigPath: configPath });

    assert.equal(defaults[0].id, "toolpin");
    assert.equal(defaults.find((source) => source.id === "toolpin")?.enabled, true);
    assert.equal(defaults.find((source) => source.id === "toolpin")?.pinned, true);
    assert.equal(defaults.find((source) => source.id === "official")?.enabled, true);
    assert.equal(defaults.find((source) => source.id === "docker")?.enabled, true);
    assert.equal(defaults.find((source) => source.id === "glama")?.enabled, false);
    assert.equal(defaults.find((source) => source.id === "smithery")?.enabled, false);

    await updateRegistrySourceEnabled("glama", true, configPath);
    const enabled = await listRegistrySources({ registryConfigPath: configPath });

    assert.equal(enabled.find((source) => source.id === "glama")?.enabled, true);
    assert.equal(enabled.find((source) => source.id === "smithery")?.enabled, false);
  });
});

test("pinned ToolPin source cannot be disabled by source preferences or registry commands", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "registries.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      registries: [],
      sources: {
        toolpin: { enabled: false },
      },
    }), "utf8");

    const sources = await listRegistrySources({ registryConfigPath: configPath });
    assert.equal(sources[0].id, "toolpin");
    assert.equal(sources[0].enabled, true);
    await assert.rejects(() => updateRegistrySourceEnabled("toolpin", false, configPath), /toolpin is pinned and cannot be disabled/);
  });
});

test("ToolPin curated registry fetches the hosted registry and uses hosted entries first", async () => {
  const calls = [];
  const entries = await fetchRegistry({
    source: "toolpin",
    fetch: async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { servers: [toolpinRegistryEntry("io.github.hosted/server")] });
    },
  });

  assert.deepEqual(calls, [TOOLPIN_REGISTRY_URL]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "toolpin");
  assert.equal(entries[0].server.name, "io.github.hosted/server");
});

test("ToolPin curated registry falls back to bundled snapshot when hosted fetch fails", async () => {
  const result = await fetchRegistryResult({
    source: "toolpin",
    search: "contextrelay",
    retryBackoffMs: 0,
    fetch: async (url) => {
      assert.equal(String(url), TOOLPIN_REGISTRY_URL);
      return jsonResponse(503, { error: "unavailable" }, "Service Unavailable");
    },
  });
  const servers = result.entries.map(normalizeEntry);
  const contextRelay = servers.find((server) => server.name === "@proofofwork-agency/contextrelay");

  assert.equal(result.status, "stale");
  assert.match(result.lastError, /ToolPin hosted registry fetch failed; using bundled fallback snapshot/);
  assert.equal(result.entries[0].source, "toolpin");
  assert.ok(contextRelay);
  assert.equal(contextRelay.registrySource, "toolpin");
  assert.equal(contextRelay.raw.packages?.[0]?.runtimeHint, "bun");
});

test("ToolPin curated registry falls back to bundled snapshot when hosted schema is invalid", async () => {
  const result = await fetchRegistryResult({
    source: "toolpin",
    search: "contextrelay",
    fetch: async () => jsonResponse(200, { items: [] }),
  });
  const servers = result.entries.map(normalizeEntry);
  const contextRelay = servers.find((server) => server.name === "@proofofwork-agency/contextrelay");

  assert.equal(result.status, "stale");
  assert.match(result.lastError, /expected ToolPin curated registry to include a servers array/);
  assert.ok(contextRelay);
});

test("refreshCache caches hosted ToolPin registry results", async () => {
  await withTempDir(async (tempDir) => {
    const cachePath = path.join(tempDir, "registry-cache.json");
    const result = await refreshCache({
      source: "toolpin",
      cachePath,
      fetch: async (url) => {
        assert.equal(String(url), TOOLPIN_REGISTRY_URL);
        return jsonResponse(200, { servers: [toolpinRegistryEntry("io.github.cache/server")] });
      },
    });
    const cache = await readCacheMetadata(cachePath);

    assert.equal(result.status, "ready");
    assert.equal(cache.sources.toolpin.status, "ready");
    assert.equal(cache.sources.toolpin.entries[0].server.name, "io.github.cache/server");
  });
});

test("readCacheMetadata replaces stale bundled ToolPin cache partitions", async () => {
  await withTempDir(async (tempDir) => {
    const cachePath = path.join(tempDir, "registry-cache.json");
    const generatedAt = new Date().toISOString();
    await writeFile(cachePath, JSON.stringify({
      schema: "dev.toolpin.registry-cache.v2",
      generatedAt,
      ttlMs: 86_400_000,
      sources: {
        toolpin: {
          source: {
            id: "toolpin",
            label: "ToolPin Curated Registry",
            type: "toolpin",
            mode: "installable",
            trust: "curated",
            enabled: true,
            authRequired: false,
          },
          status: "ready",
          generatedAt,
          ttlMs: 86_400_000,
          entries: [toolpinRegistryEntry("ac.tandem/docs-mcp")],
          accepted: 1,
          skipped: 0,
          malformed: 0,
          failed: 0,
        },
      },
    }), "utf8");

    const cache = await readCacheMetadata(cachePath);

    assert.equal(cache.sources.toolpin.entries.length, 1);
    assert.equal(cache.sources.toolpin.entries[0].server.name, "@proofofwork-agency/contextrelay");
    assert.equal(typeof cache.sources.toolpin.bundledRegistryFingerprint, "string");
  });
});

test("ContextRelay is ToolPin-installable for Codex and external setup for Claude", async () => {
  const entries = await fetchRegistry({
    source: "toolpin",
    search: "contextrelay",
    retryBackoffMs: 0,
    fetch: async () => jsonResponse(503, { error: "unavailable" }, "Service Unavailable"),
  });
  const contextRelay = entries.map(normalizeEntry).find((server) => server.name === "@proofofwork-agency/contextrelay");
  assert.ok(contextRelay);

  const codex = buildInstallPlan(contextRelay, "codex");
  const config = codex.config.mcp_servers["@proofofwork-agency/contextrelay"];
  assert.equal(config.command, "bunx");
  assert.deepEqual(config.args, [`@proofofwork-agency/contextrelay@${contextRelay.version}`, "codex-mcp", "server"]);
  assert.throws(() => buildInstallPlan(contextRelay, "claude"), /external setup/);
  assert.throws(() => buildInstallPlan(contextRelay, "generic"), /not supported/);
});

test("fetchRegistry all skips disabled directory sources and explicit disabled source fails", async () => {
  await withTempDir(async (tempDir) => {
    const registryConfigPath = path.join(tempDir, "registries.json");
    const calls = [];
    const entries = await fetchRegistry({
      source: "all",
      registryConfigPath,
      limit: 1,
      maxPages: 1,
      fetch: async (url) => {
        const href = String(url);
        calls.push(href);
        if (href === TOOLPIN_REGISTRY_URL) return jsonResponse(200, { servers: [toolpinRegistryEntry()] });
        if (href.includes("registry.modelcontextprotocol.io")) return jsonResponse(200, { servers: [registryEntry()] });
        if (href.includes("api.github.com/repos/docker/mcp-registry")) return jsonResponse(200, { tree: [] });
        throw new Error(`Unexpected disabled source fetch ${href}`);
      },
    });

    assert.ok(entries.some((entry) => entry.source === "toolpin"));
    assert.ok(entries.some((entry) => entry.source === "official"));
    assert.ok(calls.some((url) => url === TOOLPIN_REGISTRY_URL));
    assert.ok(calls.some((url) => url.includes("registry.modelcontextprotocol.io")));
    assert.ok(calls.some((url) => url.includes("api.github.com/repos/docker/mcp-registry")));
    assert.equal(calls.some((url) => url.includes("glama.ai")), false);
    assert.equal(calls.some((url) => url.includes("smithery.ai")), false);
    await assert.rejects(() => fetchRegistry({ source: "glama", registryConfigPath, fetch: async () => jsonResponse(200, { servers: [] }) }), /glama is disabled/);
  });
});

test("fetchRegistry honors Retry-After over fallback backoff for 429", async () => {
  let calls = 0;
  const started = Date.now();
  const entries = await fetchRegistry({
    registryUrl: "https://registry.test/v0",
    maxPages: 1,
    retryBackoffMs: 5_000,
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(429, { error: "slow down" }, "Too Many Requests", { "retry-after": "0" })
        : jsonResponse(200, { servers: [registryEntry()] });
    },
  });

  assert.equal(calls, 2);
  assert.equal(entries.length, 1);
  assert.ok(Date.now() - started < 1_000);
});

test("retryAfterDelayMs parses seconds and HTTP-date values with a CI-safe cap", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  assert.equal(retryAfterDelayMs("2", now), 2_000);
  assert.equal(retryAfterDelayMs("999", now), 5_000);
  assert.equal(retryAfterDelayMs(new Date(now + 1_250).toUTCString(), now), 1_000);
  assert.equal(retryAfterDelayMs(new Date(now + 10_000).toUTCString(), now), 5_000);
  assert.equal(retryAfterDelayMs("not a date", now), undefined);
});

test("fetchRegistry retries one 5xx response", async () => {
  let calls = 0;
  const entries = await fetchRegistry({
    registryUrl: "https://registry.test/v0",
    maxPages: 1,
    retryBackoffMs: 0,
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(503, { error: "busy" }, "Service Unavailable")
        : jsonResponse(200, { servers: [registryEntry()] });
    },
  });

  assert.equal(calls, 2);
  assert.equal(entries.length, 1);
});

test("fetchRegistry bounds Docker YAML fetch concurrency and preserves result order", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const rawFetchOrder = [];
  const entries = await fetchRegistry({
    source: "docker",
    limit: 4,
    dockerConcurrency: 2,
    retryBackoffMs: 0,
    fetch: async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        return jsonResponse(200, {
          tree: ["alpha", "bravo", "charlie", "delta"].map((name) => ({
            path: `servers/${name}/server.yaml`,
            type: "blob",
          })),
        });
      }

      const name = href.match(/servers\/([^/]+)\/server\.yaml$/)?.[1];
      assert.ok(name);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      rawFetchOrder.push(name);
      await sleep({ alpha: 30, bravo: 5, charlie: 20, delta: 1 }[name]);
      inFlight -= 1;
      return textResponse(200, dockerServerYaml(name));
    },
  });

  assert.equal(maxInFlight, 2);
  assert.deepEqual(entries.map((entry) => entry.server.name), [
    "io.docker.mcp/alpha",
    "io.docker.mcp/bravo",
    "io.docker.mcp/charlie",
    "io.docker.mcp/delta",
  ]);
  assert.deepEqual(rawFetchOrder.slice(0, 2).sort(), ["alpha", "bravo"]);
});

test("fetchRegistry does not retry non-retryable client errors", async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchRegistry({
      registryUrl: "https://registry.test/v0",
      maxPages: 1,
      retryBackoffMs: 0,
      fetch: async () => {
        calls += 1;
        return jsonResponse(400, { error: "bad request" }, "Bad Request");
      },
    }),
    /Registry request failed: 400 Bad Request/,
  );

  assert.equal(calls, 1);
});

test("fetchRegistry aborts slow requests with the configured timeout", async () => {
  await assert.rejects(
    () => fetchRegistry({
      registryUrl: "https://registry.test/v0",
      maxPages: 1,
      requestTimeoutMs: 5,
      retryBackoffMs: 0,
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    }),
    /Registry request timed out after 5ms/,
  );
});

test("fetchRegistry reports official registry schema drift explicitly", async () => {
  await assert.rejects(
    () => fetchRegistry({
      registryUrl: "https://registry.test/v0",
      maxPages: 1,
      fetch: async () => jsonResponse(200, { items: [registryEntry()] }),
    }),
    /Registry schema drift: expected official registry response to include a servers array/,
  );
});

test("fetchRegistry reports Docker registry schema drift explicitly", async () => {
  await assert.rejects(
    () => fetchRegistry({
      source: "docker",
      fetch: async () => jsonResponse(200, { items: [] }),
    }),
    /Registry schema drift: expected Docker registry tree response to include a tree array/,
  );
});

test("readCache rejects malformed cache JSON", async () => {
  await withTempDir(async (tempDir) => {
    const cachePath = path.join(tempDir, "registry-cache.json");
    await writeFile(cachePath, "{not-json}\n", "utf8");

    await assert.rejects(() => readCache(cachePath), /Invalid registry cache JSON/);
  });
});

test("readCache rejects cache files with the wrong entries shape", async () => {
  await withTempDir(async (tempDir) => {
    const cachePath = path.join(tempDir, "registry-cache.json");
    await writeFile(cachePath, '{"generatedAt":"now","entries":{}}\n', "utf8");

    await assert.rejects(() => readCache(cachePath), /Invalid registry cache schema/);
  });
});

test("fetchRegistry loads official-compatible custom registries from config", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, ".toolpin", "registries.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      registries: [{
        id: "company",
        type: "official-compatible",
        url: "https://registry.company.test/v0",
        mode: "installable",
        trust: "private",
      }],
    }), "utf8");

    const entries = await fetchRegistry({
      source: "company",
      registryConfigPath: configPath,
      maxPages: 1,
      fetch: async (url) => {
        assert.equal(String(url), "https://registry.company.test/v0/servers?limit=100");
        return jsonResponse(200, { servers: [registryEntry()] });
      },
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, "company");
    assert.equal(entries[0]._meta["dev.toolpin/source"].mode, "installable");
  });
});

test("listRegistrySources includes configured discovery registries", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, ".toolpin", "registries.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      registries: [{
        id: "glama-public",
        type: "http-json",
        url: "https://example.test/servers.json",
      }],
    }), "utf8");

    const sources = await listRegistrySources({ registryConfigPath: configPath });
    const source = sources.find((entry) => entry.id === "glama-public");

    assert.equal(source.mode, "discovery");
    assert.equal(source.enabled, true);
    assert.equal(source.type, "http-json");
  });
});

test("fetchRegistry normalizes Glama discovery entries", async () => {
  await withTempDir(async (tempDir) => {
    const registryConfigPath = path.join(tempDir, "registries.json");
    await updateRegistrySourceEnabled("glama", true, registryConfigPath);
    const entries = await fetchRegistry({
      source: "glama",
      registryConfigPath,
      limit: 1,
      maxPages: 1,
      fetch: async (url) => {
        assert.equal(String(url), "https://glama.ai/api/mcp/v1/servers?first=1");
        return jsonResponse(200, {
          servers: [{
            name: "glama/example",
            title: "Glama Example",
            description: "Discovery-only server",
            repositoryUrl: "https://github.com/example/glama",
          }],
        });
      },
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, "glama");
    assert.equal(entries[0].server.name, "glama/example");
    assert.equal(entries[0]._meta["dev.toolpin/source"].mode, "discovery");
    assert.equal(normalizeEntry(entries[0]).installable, false);
  });
});

test("canonicalRepoUrl normalizes common git repository URL forms", () => {
  const expected = "github.com/acme/docs-mcp";
  assert.equal(canonicalRepoUrl("git+ssh://git@github.com/Acme/Docs-MCP.git?x=1#frag"), expected);
  assert.equal(canonicalRepoUrl("git@github.com:Acme/Docs-MCP.git"), expected);
  assert.equal(canonicalRepoUrl("github:Acme/Docs-MCP"), expected);
  assert.equal(canonicalRepoUrl("https://www.github.com/Acme/Docs-MCP/"), expected);
});

test("enrichGlamaTarget adopts official install targets by canonical repository match", async () => {
  await withTempDir(async (tempDir) => {
    const cachePath = path.join(tempDir, "registry-cache.json");
    await writeRegistryCache(cachePath, [{
      source: "official",
      server: {
        name: "acme/docs-mcp",
        title: "Docs MCP",
        description: "Official install target",
        version: "1.0.0",
        repository: { url: "git+ssh://git@github.com/Acme/Docs-MCP.git?x=1#frag" },
        remotes: [{ type: "streamable-http", url: "https://docs.example.com/mcp" }],
      },
    }]);
    const glama = normalizeEntry({
      source: "glama",
      server: {
        name: "docs-mcp",
        version: "1.0.0",
        repository: { url: "git@github.com:acme/docs-mcp.git" },
      },
      _meta: { "dev.toolpin/source": { source: "glama", mode: "discovery" } },
    });

    const enriched = await enrichGlamaTarget(glama, { cachePath });

    assert.equal(enriched.registrySource, "glama");
    assert.equal(enriched.resolvedFromRegistry, "official");
    assert.equal(enriched.installable, true);
    assert.equal(enriched.raw.remotes?.[0]?.url, "https://docs.example.com/mcp");
    assert.match(enriched.resolutionNote, /matched from Glama by repo/);
  });
});

test("enrichGlamaTarget stays discovery-only on no match or ambiguous repo match", async () => {
  await withTempDir(async (tempDir) => {
    const cachePath = path.join(tempDir, "registry-cache.json");
    await writeRegistryCache(cachePath, [
      {
        source: "official",
        server: {
          name: "acme/alpha",
          version: "1.0.0",
          repository: { url: "https://github.com/acme/monorepo" },
          remotes: [{ type: "streamable-http", url: "https://alpha.example.com/mcp" }],
        },
      },
      {
        source: "official",
        server: {
          name: "acme/beta",
          version: "1.0.0",
          repository: { url: "https://github.com/acme/monorepo.git" },
          remotes: [{ type: "streamable-http", url: "https://beta.example.com/mcp" }],
        },
      },
    ]);
    const noMatch = normalizeEntry({
      source: "glama",
      server: { name: "other", version: "1.0.0", repository: { url: "https://github.com/acme/other" } },
      _meta: { "dev.toolpin/source": { source: "glama", mode: "discovery" } },
    });
    const ambiguous = normalizeEntry({
      source: "glama",
      server: { name: "other", version: "1.0.0", repository: { url: "https://github.com/acme/monorepo" } },
      _meta: { "dev.toolpin/source": { source: "glama", mode: "discovery" } },
    });

    const missed = await enrichGlamaTarget(noMatch, { cachePath });
    const refused = await enrichGlamaTarget(ambiguous, { cachePath });

    assert.equal(missed.installable, false);
    assert.equal(missed.resolvedFromRegistry, undefined);
    assert.match(missed.installableReason, /no matching official-registry entry/);
    assert.equal(refused.installable, false);
    assert.equal(refused.resolvedFromRegistry, undefined);
    assert.match(refused.installableReason, /no matching official-registry entry/);
  });
});

test("fetchRegistry unlocks custom discovery entries with verifiable package targets", async () => {
  await withTempDir(async (tempDir) => {
    const registryConfigPath = path.join(tempDir, "registries.json");
    await writeFile(registryConfigPath, JSON.stringify({
      registries: [{
        id: "directory",
        type: "http-json",
        url: "https://example.com/mcp.json",
        mode: "discovery",
      }],
    }), "utf8");
    const entries = await fetchRegistry({
      source: "directory",
      registryConfigPath,
      limit: 1,
      maxPages: 1,
      fetch: async () => jsonResponse(200, {
        servers: [{
          name: "directory/npm-example",
          title: "Directory npm Example",
          description: "Discovery entry with a verifiable npm target",
          version: "1.0.0",
          repository: { url: "https://github.com/example/npm-example" },
          packages: [{
            registryType: "npm",
            identifier: "@example/server",
            version: "1.0.0",
            transport: { type: "stdio" },
          }],
        }],
      }),
    });

    const normalized = normalizeEntry(entries[0]);
    assert.equal(entries[0]._meta["dev.toolpin/source"].mode, "discovery");
    assert.equal(normalized.installable, true);
    assert.equal(normalized.installableReason, undefined);
  });
});

test("Glama entries with direct package targets still require official re-resolution", async () => {
  await withTempDir(async (tempDir) => {
    const registryConfigPath = path.join(tempDir, "registries.json");
    await updateRegistrySourceEnabled("glama", true, registryConfigPath);
    const entries = await fetchRegistry({
      source: "glama",
      registryConfigPath,
      limit: 1,
      maxPages: 1,
      fetch: async () => jsonResponse(200, {
        servers: [{
          name: "glama/npm-example",
          title: "Glama npm Example",
          description: "Glama entry with package metadata",
          version: "1.0.0",
          repository: { url: "https://github.com/example/npm-example" },
          packages: [{
            registryType: "npm",
            identifier: "@example/server",
            version: "1.0.0",
            transport: { type: "stdio" },
          }],
        }],
      }),
    });

    const normalized = normalizeEntry(entries[0]);
    assert.equal(normalized.installable, false);
    assert.match(normalized.installableReason, /official registry re-resolution/);
  });
});

test("fetchRegistry unlocks discovery entries with HTTPS remote targets", async () => {
  await withTempDir(async (tempDir) => {
    const registryConfigPath = path.join(tempDir, "registries.json");
    await updateRegistrySourceEnabled("smithery", true, registryConfigPath);
    const entries = await fetchRegistry({
      source: "smithery",
      registryConfigPath,
      limit: 1,
      maxPages: 1,
      fetch: async () => jsonResponse(200, {
        servers: [{
          name: "smithery/remote-example",
          title: "Smithery Remote Example",
          description: "Discovery entry with an HTTPS remote target",
          version: "1.0.0",
          repository: { url: "https://github.com/example/remote-example" },
          remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
        }],
      }),
    });

    assert.equal(normalizeEntry(entries[0]).installable, true);
  });
});

test("enrichSmitheryTarget requires opt-in for Smithery-provided hosted targets", async () => {
  const smithery = normalizeEntry({
    source: "smithery",
    server: {
      name: "smithery/remote-example",
      title: "Smithery Remote Example",
      description: "Discovery entry with a hosted target",
      version: "1.0.0",
      remotes: [{ type: "streamable-http", url: "https://example.smithery.ai/mcp" }],
    },
    _meta: { "dev.toolpin/source": { source: "smithery", mode: "discovery" } },
  });

  const blocked = await enrichSmitheryTarget(smithery);
  const allowed = await enrichSmitheryTarget(smithery, { allowHostedDirectoryTargets: true });

  assert.equal(blocked.installable, false);
  assert.match(blocked.installableReason, /explicit opt-in/);
  assert.equal(allowed.installable, true);
  assert.match(allowed.resolutionNote, /hosted by Smithery/);
});

test("fetchRegistryResult reports PulseMCP auth missing without fetching", async () => {
  const previousKey = process.env.PULSEMCP_API_KEY;
  const previousTenant = process.env.PULSEMCP_TENANT_ID;
  delete process.env.PULSEMCP_API_KEY;
  delete process.env.PULSEMCP_TENANT_ID;
  let calls = 0;
  try {
    await withTempDir(async (tempDir) => {
      const registryConfigPath = path.join(tempDir, "registries.json");
      await updateRegistrySourceEnabled("pulsemcp", true, registryConfigPath);
      const result = await fetchRegistryResult({
        source: "pulsemcp",
        registryConfigPath,
        fetch: async () => {
          calls += 1;
          return jsonResponse(200, { servers: [] });
        },
      });

      assert.equal(calls, 0);
      assert.equal(result.status, "auth-missing");
      assert.equal(result.entries.length, 0);
      assert.match(result.lastError, /PULSEMCP_API_KEY/);
      assert.match(result.source.setupHint, /PULSEMCP_API_KEY/);
    });
  } finally {
    setOptionalEnv("PULSEMCP_API_KEY", previousKey);
    setOptionalEnv("PULSEMCP_TENANT_ID", previousTenant);
  }
});

test("fetchRegistryResult sends optional Smithery bearer auth", async () => {
  const previous = process.env.SMITHERY_API_KEY;
  process.env.SMITHERY_API_KEY = "smithery-token";
  try {
    await withTempDir(async (tempDir) => {
      const registryConfigPath = path.join(tempDir, "registries.json");
      await updateRegistrySourceEnabled("smithery", true, registryConfigPath);
      const result = await fetchRegistryResult({
        source: "smithery",
        registryConfigPath,
        limit: 1,
        maxPages: 1,
        fetch: async (url, init) => {
          assert.equal(String(url), "https://api.smithery.ai/servers?pageSize=1");
          assert.equal(init?.headers?.Authorization, "Bearer smithery-token");
          return jsonResponse(200, {
            servers: [{
              name: "smithery/example",
              version: "1.0.0",
              repository: { url: "https://github.com/example/smithery" },
            }],
          });
        },
      });

      assert.equal(result.status, "discovery-only");
      assert.equal(result.accepted, 1);
      assert.equal(result.entries[0].source, "smithery");
    });
  } finally {
    setOptionalEnv("SMITHERY_API_KEY", previous);
  }
});

test("refreshCache isolates source failures and writes successful partitions", async () => {
  await withTempDir(async (tempDir) => {
    const previousKey = process.env.PULSEMCP_API_KEY;
    const previousTenant = process.env.PULSEMCP_TENANT_ID;
    delete process.env.PULSEMCP_API_KEY;
    delete process.env.PULSEMCP_TENANT_ID;
    try {
      const cachePath = path.join(tempDir, "registry-cache.json");
      const registryConfigPath = path.join(tempDir, "registries.json");
      const result = await refreshCache({
        source: "all",
        cachePath,
        registryConfigPath,
        limit: 1,
        maxPages: 1,
        retryBackoffMs: 0,
        fetch: async (url) => {
          const href = String(url);
          if (href === TOOLPIN_REGISTRY_URL) return jsonResponse(200, { servers: [toolpinRegistryEntry()] });
          if (href.includes("github.com/docker/mcp-registry")) throw new Error("docker unavailable");
          if (href.includes("glama.ai")) return jsonResponse(200, { servers: [] });
          if (href.includes("smithery.ai")) return jsonResponse(200, { servers: [] });
          return jsonResponse(200, { servers: [registryEntry()] });
        },
      });
      const cache = await readCacheMetadata(cachePath);

      assert.ok(result.results.some((entry) => entry.source.id === "docker" && entry.status === "fetch-error"));
      assert.equal(cache.sources.official.entries.length, 1);
      assert.equal(cache.sources.official.status, "ready");
      assert.equal(cache.sources.docker.status, "fetch-error");
      assert.equal(cache.sources.pulsemcp, undefined);
    } finally {
      setOptionalEnv("PULSEMCP_API_KEY", previousKey);
      setOptionalEnv("PULSEMCP_TENANT_ID", previousTenant);
    }
  });
});

test("dedupeRegistryEntries prefers trusted built-ins for duplicate repository entries", () => {
  const toolpin = {
    source: "toolpin",
    server: {
      name: "example/server",
      version: "1.0.0",
      repository: { url: "https://github.com/example/server" },
    },
  };
  const official = {
    source: "official",
    server: {
      name: "example/server",
      version: "1.0.0",
      repository: { url: "https://github.com/example/server" },
    },
  };
  const glama = {
    source: "glama",
    server: {
      name: "example/server",
      version: "1.0.0",
      repository: { url: "https://github.com/example/server.git" },
    },
  };

  assert.deepEqual(dedupeRegistryEntries([glama, official]), [official]);
  assert.deepEqual(dedupeRegistryEntries([official, toolpin, glama]), [toolpin]);
});

test("shared registry source comparator keeps pinned ToolPin first", () => {
  const sources = [
    sourceInfo("official", { trust: "canonical" }),
    sourceInfo("docker", { trust: "curated" }),
    sourceInfo("toolpin", { trust: "curated", pinned: true }),
  ];

  assert.deepEqual([...sources].sort(compareRegistrySources).map((source) => source.id), ["toolpin", "official", "docker"]);
});

test("bundled curated registry entries rely on ToolPin source tagging", async () => {
  const bundled = JSON.parse(await readFile(path.resolve("registry/v0/servers"), "utf8"));

  assert.ok(bundled.servers.length > 0);
  assert.equal(bundled.servers.some((entry) => Object.hasOwn(entry, "source")), false);
});

function sourceInfo(id, overrides = {}) {
  return {
    id,
    label: id,
    type: id,
    mode: "installable",
    trust: "private",
    enabled: true,
    authRequired: false,
    description: id,
    ...overrides,
  };
}

function jsonResponse(status, body, statusText = "OK", headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function textResponse(status, body, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function dockerServerYaml(name) {
  return [
    `name: ${name}`,
    "about:",
    `  title: ${name}`,
    "  description: Synthetic Docker entry",
    "image: ghcr.io/example/server:1.0.0",
  ].join("\n");
}

function registryEntry() {
  return {
    server: {
      name: "example/server",
      title: "Example Server",
      description: "Synthetic server",
      version: "1.0.0",
    },
  };
}

function toolpinRegistryEntry(name = "io.github.toolpin/server") {
  return {
    server: {
      name,
      title: "ToolPin Hosted Server",
      description: "Synthetic hosted ToolPin curated entry",
      version: "1.0.0",
      repository: { url: `https://github.com/${name.replace(/^[^/]+\//, "example/")}` },
      packages: [{
        registryType: "npm",
        identifier: "@example/toolpin-hosted-server",
        version: "1.0.0",
        transport: { type: "stdio" },
      }],
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setOptionalEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-registry-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeRegistryCache(cachePath, entries) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const generatedAt = new Date().toISOString();
  await writeFile(cachePath, JSON.stringify({
    schema: "dev.toolpin.registry-cache.v2",
    generatedAt,
    ttlMs: 86_400_000,
    sources: {
      official: {
        source: {
          id: "official",
          label: "Official MCP Registry",
          type: "official",
          mode: "installable",
          trust: "canonical",
          enabled: true,
          authRequired: false,
        },
        status: "ready",
        generatedAt,
        ttlMs: 86_400_000,
        entries,
        accepted: entries.length,
        skipped: 0,
        malformed: 0,
        failed: 0,
      },
    },
  }), "utf8");
}
