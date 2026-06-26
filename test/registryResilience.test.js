import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dedupeRegistryEntries, fetchRegistry, fetchRegistryResult, listRegistrySources, readCache, readCacheMetadata, refreshCache, retryAfterDelayMs } from "../dist/registry.js";

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
  const entries = await fetchRegistry({
    source: "glama",
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
});

test("fetchRegistryResult reports PulseMCP auth missing without fetching", async () => {
  const previousKey = process.env.PULSEMCP_API_KEY;
  const previousTenant = process.env.PULSEMCP_TENANT_ID;
  delete process.env.PULSEMCP_API_KEY;
  delete process.env.PULSEMCP_TENANT_ID;
  let calls = 0;
  try {
    const result = await fetchRegistryResult({
      source: "pulsemcp",
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
  } finally {
    setOptionalEnv("PULSEMCP_API_KEY", previousKey);
    setOptionalEnv("PULSEMCP_TENANT_ID", previousTenant);
  }
});

test("fetchRegistryResult sends optional Smithery bearer auth", async () => {
  const previous = process.env.SMITHERY_API_KEY;
  process.env.SMITHERY_API_KEY = "smithery-token";
  try {
    const result = await fetchRegistryResult({
      source: "smithery",
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
      const result = await refreshCache({
        source: "all",
        cachePath,
        limit: 1,
        maxPages: 1,
        retryBackoffMs: 0,
        fetch: async (url) => {
          const href = String(url);
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
      assert.equal(cache.sources.pulsemcp.status, "auth-missing");
    } finally {
      setOptionalEnv("PULSEMCP_API_KEY", previousKey);
      setOptionalEnv("PULSEMCP_TENANT_ID", previousTenant);
    }
  });
});

test("dedupeRegistryEntries prefers trusted built-ins for duplicate repository entries", () => {
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
});

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
