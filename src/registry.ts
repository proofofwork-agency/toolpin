import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { NormalizedServer, RegistryAdapterKind, RegistryCacheFileV2, RegistryCachePartition, RegistryEntry, RegistryFetchPageInfo, RegistryFetchResult, RegistryListResponse, RegistryPackage, RegistryRemote, RegistryRepository, RegistryServer, RegistrySourceId, RegistrySourceInfo, RegistrySourceMode, RegistrySourceType, SourceStatus } from "./types.js";
import { safeFetchJson } from "./safeFetch.js";
import { compareVersionish } from "./versions.js";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0";
const DEFAULT_CACHE_PATH = path.join(process.cwd(), ".toolpin", "registry-cache.json");
const DEFAULT_REGISTRY_CONFIG_PATH = path.join(process.cwd(), ".toolpin", "registries.json");
const DOCKER_TREE_URL = "https://api.github.com/repos/docker/mcp-registry/git/trees/main?recursive=1";
const DOCKER_RAW_BASE = "https://raw.githubusercontent.com/docker/mcp-registry/main";
const GLAMA_SERVERS_URL = "https://glama.ai/api/mcp/v1/servers";
const SMITHERY_SERVERS_URL = "https://api.smithery.ai/servers";
const PULSEMCP_SERVERS_URL = "https://api.pulsemcp.com/v0.1/servers";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_BACKOFF_MS = 100;
const DEFAULT_DOCKER_CONCURRENCY = 12;
const MAX_DOCKER_CONCURRENCY = 50;
const MAX_RETRY_AFTER_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OFFICIAL_MAX_PAGES = 25;

export const BUILTIN_REGISTRY_SOURCES: RegistrySourceInfo[] = [
  {
    id: "official",
    label: "Official MCP Registry",
    type: "official",
    adapter: "official-compatible",
    mode: "installable",
    trust: "canonical",
    enabled: true,
    authRequired: false,
    description: "Canonical public MCP server metadata registry.",
  },
  {
    id: "docker",
    label: "Docker MCP Catalog",
    type: "docker",
    adapter: "http-json",
    mode: "installable",
    trust: "curated",
    enabled: true,
    authRequired: false,
    description: "Curated Docker MCP catalog with reviewed container/remote entries.",
  },
  {
    id: "pulsemcp",
    label: "PulseMCP",
    type: "pulsemcp",
    adapter: "pulsemcp",
    mode: "discovery",
    trust: "directory",
    enabled: false,
    authRequired: true,
    url: PULSEMCP_SERVERS_URL,
    status: "auth-missing",
    setupHint: "Set PULSEMCP_API_KEY and PULSEMCP_TENANT_ID to enable PulseMCP discovery.",
    description: "PulseMCP directory discovery source. Entries stay discovery-only unless verified package or remote metadata is present.",
  },
  {
    id: "smithery",
    label: "Smithery",
    type: "smithery",
    adapter: "smithery",
    mode: "discovery",
    trust: "directory",
    enabled: false,
    authRequired: false,
    url: SMITHERY_SERVERS_URL,
    status: "discovery-only",
    setupHint: "Optionally set SMITHERY_API_KEY for higher Smithery rate limits.",
    description: "Smithery directory discovery source. Hosted deployment targets are installable only with explicit opt-in (--allow-hosted-directory-targets) and are subject to Smithery terms; otherwise entries stay discovery-only.",
  },
  {
    id: "glama",
    label: "Glama",
    type: "glama",
    adapter: "glama",
    mode: "discovery",
    trust: "directory",
    enabled: false,
    authRequired: false,
    url: GLAMA_SERVERS_URL,
    status: "discovery-only",
    description: "Glama public MCP directory discovery source. Glama exposes repository metadata only; servers stay discovery-only until they surface a verifiable install target (install via the official registry instead).",
  },
];

export const REGISTRY_SOURCES = BUILTIN_REGISTRY_SOURCES;

export interface RegistryAdapter {
  info: RegistrySourceInfo;
  fetch(options: FetchOptions): Promise<RegistryFetchResult>;
}

export interface RegistryConfig {
  registries: ConfiguredRegistrySource[];
  sources?: Record<string, SourcePreference>;
}

export interface SourcePreference {
  enabled?: boolean;
}

export interface ConfiguredRegistrySource {
  id: string;
  type?: RegistrySourceType;
  adapter?: RegistryAdapterKind;
  url?: string;
  label?: string;
  mode?: RegistrySourceMode;
  trust?: RegistrySourceInfo["trust"];
  enabled?: boolean;
  authEnv?: string;
  auth?: {
    env?: string | string[];
  };
  priority?: number;
  description?: string;
}

export interface FetchOptions {
  registryUrl?: string;
  limit?: number;
  maxPages?: number;
  search?: string;
  source?: RegistrySourceId | "all";
  fetch?: FetchLike;
  registryConfigPath?: string;
  requestTimeoutMs?: number;
  retryBackoffMs?: number;
  dockerConcurrency?: number;
  cacheTtlMs?: number;
  allowStaleCache?: boolean;
  ci?: boolean;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: URL | string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchLikeResponse>;

export interface RegistryParseReport {
  accepted: number;
  skipped: number;
  malformed: number;
  failed: number;
  reasons: string[];
}

export async function fetchRegistry(options: FetchOptions = {}): Promise<RegistryEntry[]> {
  const result = await fetchRegistryResult(options);
  return dedupeRegistryEntries(result.entries);
}

export async function fetchRegistryResult(options: FetchOptions = {}): Promise<RegistryFetchResult & { results?: RegistryFetchResult[] }> {
  const source = options.source ?? "official";
  const adapters = await registryAdapters(options.registryConfigPath);
  if (source === "all") {
    const fetchable = adapters.filter((adapter) => adapter.info.enabled);
    const results = await Promise.all(fetchable.map(async (adapter) => {
      try {
        return await adapter.fetch({ ...options, source: adapter.info.id });
      } catch (error) {
        return fetchErrorResult(adapter.info, error);
      }
    }));
    const entries = dedupeRegistryEntries(results.flatMap((result) => result.entries));
    const failed = results.reduce((count, result) => count + result.failed + (result.status === "fetch-error" ? 1 : 0), 0);
    return {
      source: allSourcesInfo(),
      status: entries.length ? (failed ? "stale" : "ready") : results.some((result) => result.status === "auth-missing") ? "auth-missing" : "fetch-error",
      entries,
      accepted: results.reduce((count, result) => count + result.accepted, 0),
      skipped: results.reduce((count, result) => count + result.skipped, 0),
      malformed: results.reduce((count, result) => count + result.malformed, 0),
      failed,
      lastError: results.filter((result) => result.lastError).map((result) => `${result.source.id}: ${result.lastError}`).join("; ") || undefined,
      fetchedAt: new Date().toISOString(),
      results,
    };
  }

  const adapter = adapters.find((candidate) => candidate.info.id === source);
  if (!adapter) {
    throw new Error(`Unknown registry source: ${source}. Add it to .toolpin/registries.json or run \`toolpin registry list\`.`);
  }
  if (!adapter.info.enabled) {
    throw new Error(`Registry source ${source} is disabled. Run \`toolpin registry enable ${source}\` to enable it.`);
  }
  return adapter.fetch(options);
}

export async function listRegistrySources(options: { registryConfigPath?: string } = {}): Promise<RegistrySourceInfo[]> {
  return (await registryAdapters(options.registryConfigPath)).map((adapter) => adapter.info);
}

export async function listRegistrySourceStatuses(options: { registryConfigPath?: string; cachePath?: string } = {}): Promise<RegistrySourceInfo[]> {
  const sources = await listRegistrySources({ registryConfigPath: options.registryConfigPath });
  const cache = await readCacheMetadata(options.cachePath).catch(() => undefined);
  return sources.map((source) => {
    const partition = cache?.sources[source.id];
    return {
      ...source,
      status: source.enabled ? partition?.status ?? source.status ?? sourceStatus(source) : "disabled",
      setupHint: source.setupHint,
    };
  });
}

export async function readRegistryConfig(configPath = DEFAULT_REGISTRY_CONFIG_PATH): Promise<RegistryConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { registries: [], sources: {} };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid registry config JSON in ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRegistryConfig(parsed)) {
    throw new Error(`Invalid registry config schema in ${configPath}: expected { "registries": [...] }.`);
  }
  return parsed;
}

export async function updateRegistrySourceEnabled(sourceId: string, enabled: boolean, configPath = DEFAULT_REGISTRY_CONFIG_PATH): Promise<RegistryConfig> {
  const config = await readRegistryConfig(configPath);
  const known = await listRegistrySources({ registryConfigPath: configPath });
  if (!known.some((source) => source.id === sourceId)) {
    throw new Error(`Unknown registry source: ${sourceId}. Run \`toolpin registry list\` to see available sources.`);
  }
  const next: RegistryConfig = {
    registries: config.registries,
    sources: {
      ...(config.sources ?? {}),
      [sourceId]: {
        ...(config.sources?.[sourceId] ?? {}),
        enabled,
      },
    },
  };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function registryAdapters(configPath?: string): Promise<RegistryAdapter[]> {
  const config = await readRegistryConfig(configPath);
  const builtins: RegistryAdapter[] = BUILTIN_REGISTRY_SOURCES.map((baseInfo) => {
    const info = applySourcePreference(baseInfo, config.sources?.[baseInfo.id]);
    return {
    info,
    fetch: info.id === "official"
      ? (options) => fetchOfficialRegistry({ ...options, sourceInfo: info })
      : info.id === "docker"
        ? (options) => fetchDockerRegistry({ ...options, sourceInfo: info })
        : info.id === "glama"
          ? (options) => fetchGlamaRegistry(info, options)
          : info.id === "smithery"
            ? (options) => fetchSmitheryRegistry(info, options)
            : info.id === "pulsemcp"
              ? (options) => fetchPulseMcpRegistry(info, options)
              : async () => emptyResult(info, sourceStatus(info)),
    };
  });

  const custom = config.registries.map(configuredRegistryAdapter);
  return mergeAdapters([...builtins, ...custom]);
}

function applySourcePreference(source: RegistrySourceInfo, preference: SourcePreference | undefined): RegistrySourceInfo {
  const enabled = preference?.enabled ?? source.enabled;
  return {
    ...source,
    enabled,
    status: enabled ? source.status : "disabled",
  };
}

function configuredRegistryAdapter(config: ConfiguredRegistrySource): RegistryAdapter {
  const adapter = adapterKind(config.adapter ?? config.type);
  const type = config.type ?? (adapter === "official-compatible" || adapter === "http-json" ? "custom" : adapter);
  const url = config.url ?? defaultUrlForAdapter(adapter);
  const authEnv = config.authEnv ?? firstAuthEnv(config.auth?.env);
  const mode = config.mode ?? (adapter === "official-compatible" ? "installable" : "discovery");
  const info: RegistrySourceInfo = {
    id: config.id,
    label: config.label ?? config.id,
    type,
    adapter,
    mode,
    trust: config.trust ?? "private",
    enabled: config.enabled !== false,
    authRequired: Boolean(authEnv),
    description: config.description ?? `${type} registry configured in .toolpin/registries.json.`,
    url,
    status: config.enabled === false ? "disabled" : mode === "discovery" ? "discovery-only" : "ready",
  };
  return {
    info,
    fetch: adapter === "http-json"
      ? (options) => fetchHttpJsonRegistry(requiredUrl(url, info), info, options)
      : adapter === "glama"
        ? (options) => fetchGlamaRegistry(info, options)
        : adapter === "smithery"
          ? (options) => fetchSmitheryRegistry(info, options)
          : adapter === "pulsemcp"
            ? (options) => fetchPulseMcpRegistry(info, options)
            : (options) => fetchOfficialRegistry({ ...options, registryUrl: requiredUrl(url, info), sourceInfo: info }),
  };
}

async function fetchOfficialRegistry(options: FetchOptions & { sourceInfo?: RegistrySourceInfo } = {}): Promise<RegistryFetchResult> {
  const sourceInfo = options.sourceInfo ?? BUILTIN_REGISTRY_SOURCES.find((source) => source.id === "official")!;
  const registryUrl = options.registryUrl ?? sourceInfo.url ?? DEFAULT_REGISTRY_URL;
  const limit = Math.min(options.limit ?? 100, 100);
  const maxPages = options.maxPages ?? DEFAULT_OFFICIAL_MAX_PAGES;
  const entries: RegistryEntry[] = [];
  let cursor: string | undefined;
  let hasMore = false;
  let total: number | undefined;
  let fetchedPages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${registryUrl.replace(/\/$/, "")}/servers`);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    if (options.search) url.searchParams.set("search", options.search);

    const response = await fetchWithRetry(url, {}, options, "Registry request");
    if (!response.ok) {
      throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
    }

    const body = await responseJson(response, "official registry response");
    if (!isRegistryListResponse(body)) {
      throw new Error("Registry schema drift: expected official registry response to include a servers array.");
    }
    entries.push(...body.servers.map((entry) => tagRegistryEntry(entry, sourceInfo)));
    fetchedPages += 1;
    total = typeof body.metadata?.total === "number" ? body.metadata.total : total;

    cursor = body.metadata?.nextCursor;
    hasMore = Boolean(cursor);
    if (!cursor) break;
  }

  return successResult(sourceInfo, entries, {
    accepted: entries.length,
    pageInfo: { fetchedPages, maxPages, hasMore, nextCursor: cursor, total },
  });
}

async function fetchDockerRegistry(options: FetchOptions & { sourceInfo?: RegistrySourceInfo } = {}): Promise<RegistryFetchResult> {
  const sourceInfo = options.sourceInfo ?? BUILTIN_REGISTRY_SOURCES.find((source) => source.id === "docker")!;
  const limit = Math.min(options.limit ?? 100, 500);
  const response = await fetchWithRetry(DOCKER_TREE_URL, { headers: githubHeaders() }, options, "Docker registry request");
  if (!response.ok) {
    throw new Error(`Docker registry request failed: ${response.status} ${response.statusText}`);
  }

  const body = await responseJson(response, "Docker registry tree response");
  if (!isDockerTreeResponse(body)) {
    throw new Error("Registry schema drift: expected Docker registry tree response to include a tree array.");
  }
  const fetchCount = options.search ? 500 : limit;
  const serverPaths = body.tree
    .map((entry) => entry.path)
    .filter((entryPath) => /^servers\/[^/]+\/server\.yaml$/.test(entryPath))
    .slice(0, fetchCount);

  const concurrency = clampInteger(options.dockerConcurrency ?? DEFAULT_DOCKER_CONCURRENCY, 1, MAX_DOCKER_CONCURRENCY);
  const report: RegistryParseReport = { accepted: 0, skipped: 0, malformed: 0, failed: 0, reasons: [] };
  const entries = await mapConcurrent(serverPaths, concurrency, async (entryPath) => {
    try {
      const raw = await fetchText(`${DOCKER_RAW_BASE}/${entryPath}`, options);
      const parsed = dockerYamlToEntry(raw, entryPath);
      if (!parsed.entry) {
        report.skipped += 1;
        report.reasons.push(`${entryPath}: ${parsed.reason}`);
        return undefined;
      }
      report.accepted += 1;
      return tagRegistryEntry(parsed.entry, sourceInfo);
    } catch (error) {
      report.failed += 1;
      report.reasons.push(`${entryPath}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  });
  if (report.failed || report.skipped || report.malformed) warnRegistryReport("Docker registry", report, options);

  const acceptedEntries = entries.filter((entry): entry is RegistryEntry => Boolean(entry));
  return successResult(sourceInfo, acceptedEntries, {
    accepted: report.accepted,
    skipped: report.skipped,
    malformed: report.malformed,
    failed: report.failed,
    pageInfo: { fetchedPages: 1, maxPages: 1, hasMore: serverPaths.length < body.tree.length },
  });
}

async function fetchHttpJsonRegistry(url: string, sourceInfo: RegistrySourceInfo, options: FetchOptions = {}): Promise<RegistryFetchResult> {
  const response = await fetchWithRetry(url, {}, options, `${sourceInfo.label} registry request`);
  if (!response.ok) {
    throw new Error(`${sourceInfo.label} registry request failed: ${response.status} ${response.statusText}`);
  }

  const body = await responseJson(response, `${sourceInfo.label} registry response`);
  const parsed = extractHttpJsonEntries(body);
  if (!parsed) {
    throw new Error(`Registry schema drift: expected ${sourceInfo.id} response to include a servers or entries array.`);
  }
  if (parsed.report.skipped || parsed.report.malformed || parsed.report.failed) {
    warnRegistryReport(sourceInfo.label, parsed.report, options);
  }
  const entries = parsed.entries.map((entry) => tagRegistryEntry(entry, sourceInfo));
  return successResult(sourceInfo, entries, {
    accepted: parsed.report.accepted,
    skipped: parsed.report.skipped,
    malformed: parsed.report.malformed,
    failed: parsed.report.failed,
    pageInfo: { fetchedPages: 1, maxPages: 1, hasMore: false },
  });
}

async function fetchGlamaRegistry(sourceInfo: RegistrySourceInfo, options: FetchOptions = {}): Promise<RegistryFetchResult> {
  const urlBase = sourceInfo.url ?? GLAMA_SERVERS_URL;
  const first = Math.min(options.limit ?? 100, 100);
  const maxPages = options.maxPages ?? 5;
  return fetchCursorDirectory(sourceInfo, options, {
    urlBase,
    maxPages,
    buildUrl: (cursor) => {
      const url = new URL(urlBase);
      url.searchParams.set("first", String(first));
      if (cursor) url.searchParams.set("after", cursor);
      if (options.search) url.searchParams.set("query", options.search);
      return url;
    },
  });
}

async function fetchSmitheryRegistry(sourceInfo: RegistrySourceInfo, options: FetchOptions = {}): Promise<RegistryFetchResult> {
  const urlBase = sourceInfo.url ?? SMITHERY_SERVERS_URL;
  const headers: Record<string, string> = {};
  if (process.env.SMITHERY_API_KEY) headers.Authorization = `Bearer ${process.env.SMITHERY_API_KEY}`;
  return fetchCursorDirectory(sourceInfo, options, {
    urlBase,
    headers,
    maxPages: options.maxPages ?? 3,
    buildUrl: (cursor) => {
      const url = new URL(urlBase);
      url.searchParams.set("pageSize", String(Math.min(options.limit ?? 100, 100)));
      if (cursor) url.searchParams.set("cursor", cursor);
      if (options.search) url.searchParams.set("q", options.search);
      return url;
    },
  });
}

async function fetchPulseMcpRegistry(sourceInfo: RegistrySourceInfo, options: FetchOptions = {}): Promise<RegistryFetchResult> {
  const apiKey = process.env.PULSEMCP_API_KEY;
  const tenantId = process.env.PULSEMCP_TENANT_ID;
  if (!apiKey || !tenantId) {
    return emptyResult(
      {
        ...sourceInfo,
        status: "auth-missing",
        setupHint: sourceInfo.setupHint ?? "Set PULSEMCP_API_KEY and PULSEMCP_TENANT_ID to enable PulseMCP discovery.",
      },
      "auth-missing",
      "Missing PULSEMCP_API_KEY or PULSEMCP_TENANT_ID.",
    );
  }

  const urlBase = sourceInfo.url ?? PULSEMCP_SERVERS_URL;
  return fetchCursorDirectory(sourceInfo, options, {
    urlBase,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "x-tenant-id": tenantId,
    },
    maxPages: options.maxPages ?? 3,
    buildUrl: (cursor) => {
      const url = new URL(urlBase);
      url.searchParams.set("limit", String(Math.min(options.limit ?? 100, 100)));
      if (cursor) url.searchParams.set("cursor", cursor);
      if (options.search) url.searchParams.set("query", options.search);
      return url;
    },
  });
}

async function fetchCursorDirectory(
  sourceInfo: RegistrySourceInfo,
  options: FetchOptions,
  config: {
    urlBase: string;
    maxPages: number;
    headers?: Record<string, string>;
    buildUrl(cursor: string | undefined): URL;
  },
): Promise<RegistryFetchResult> {
  const entries: RegistryEntry[] = [];
  const report: RegistryParseReport = { accepted: 0, skipped: 0, malformed: 0, failed: 0, reasons: [] };
  let cursor: string | undefined;
  let hasMore = false;
  let total: number | undefined;
  let fetchedPages = 0;

  for (let page = 0; page < config.maxPages; page += 1) {
    const response = await fetchWithRetry(config.buildUrl(cursor), { headers: config.headers }, options, `${sourceInfo.label} registry request`);
    if (!response.ok) {
      throw new Error(`${sourceInfo.label} registry request failed: ${response.status} ${response.statusText}`);
    }
    const body = await responseJson(response, `${sourceInfo.label} registry response`);
    const parsed = extractDirectoryEntries(body, sourceInfo);
    if (!parsed) {
      throw new Error(`Registry schema drift: expected ${sourceInfo.id} response to include a servers, data, items, or results array.`);
    }
    entries.push(...parsed.entries);
    report.accepted += parsed.report.accepted;
    report.skipped += parsed.report.skipped;
    report.malformed += parsed.report.malformed;
    report.failed += parsed.report.failed;
    report.reasons.push(...parsed.report.reasons);
    fetchedPages += 1;
    cursor = parsed.pageInfo.nextCursor;
    total = parsed.pageInfo.total ?? total;
    hasMore = parsed.pageInfo.hasMore;
    if (!cursor || !hasMore) break;
  }

  if (report.skipped || report.malformed || report.failed) warnRegistryReport(sourceInfo.label, report, options);
  return successResult(sourceInfo, entries, {
    status: sourceInfo.mode === "discovery" ? "discovery-only" : "ready",
    accepted: report.accepted,
    skipped: report.skipped,
    malformed: report.malformed,
    failed: report.failed,
    pageInfo: { fetchedPages, maxPages: config.maxPages, hasMore, nextCursor: cursor, total },
  });
}

async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const response = await fetchWithRetry(url, { headers: githubHeaders() }, options, "Request");
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${url}`);
  }
  return response.text();
}

async function fetchWithRetry(
  url: URL | string,
  init: { headers?: Record<string, string> },
  options: FetchOptions,
  errorPrefix: string,
): Promise<FetchLikeResponse> {
  const fetchLike = options.fetch ?? defaultFetch;
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const retryBackoffMs = Math.max(0, options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchOnce(fetchLike, url, init, timeoutMs, errorPrefix);
    if (attempt === 0 && isRetryableStatus(response.status)) {
      await delay(retryDelayMs(response, retryBackoffMs));
      continue;
    }
    return response;
  }

  throw new Error(`${errorPrefix} failed after retry.`);
}

async function fetchOnce(
  fetchLike: FetchLike,
  url: URL | string,
  init: { headers?: Record<string, string> },
  timeoutMs: number,
  errorPrefix: string,
): Promise<FetchLikeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchLike(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${errorPrefix} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultFetch(url: URL | string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<FetchLikeResponse> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response: FetchLikeResponse, fallbackMs: number): number {
  if (response.status !== 429) return fallbackMs;
  return retryAfterDelayMs(response.headers?.get("retry-after") ?? response.headers?.get("Retry-After"), Date.now()) ?? fallbackMs;
}

export function retryAfterDelayMs(value: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number.parseInt(trimmed, 10) * 1000, MAX_RETRY_AFTER_MS);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.min(Math.max(0, dateMs - nowMs), MAX_RETRY_AFTER_MS);
}

function delay(ms: number): Promise<void> {
  return ms === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseJson(response: FetchLikeResponse, description: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON from ${description}: ${message}`);
  }
}

function isRegistryListResponse(value: unknown): value is RegistryListResponse {
  return isRecord(value) && Array.isArray(value.servers);
}

function isDockerTreeResponse(value: unknown): value is { tree: Array<{ path: string; type: string }> } {
  return (
    isRecord(value) &&
    Array.isArray(value.tree) &&
    value.tree.every((entry) => isRecord(entry) && typeof entry.path === "string" && typeof entry.type === "string")
  );
}

function dockerYamlToEntry(raw: string, entryPath: string): { entry?: RegistryEntry; reason?: string } {
  const parsed = parseYaml(raw) as unknown;
  if (!isRecord(parsed)) return { reason: "YAML root is not an object" };
  if (typeof parsed.name !== "string" || !parsed.name) return { reason: "missing name" };

  const name = String(parsed.name);
  const about = asRecord(parsed.about);
  const source = asRecord(parsed.source);
  const config = asRecord(parsed.config);
  const title = String(about.title ?? name);
  const description = String(about.description ?? "");
  const version = String(source.commit ?? source.branch ?? "docker-catalog");
  const repositoryUrl = typeof source.project === "string" ? source.project : "https://github.com/docker/mcp-registry";
  const secrets = Array.isArray(config.secrets) ? config.secrets : [];
  const envVars = secrets
    .filter(isRecord)
    .map((secret) => ({
        name: String(secret.env ?? secret.name ?? "SECRET"),
        description: typeof secret.description === "string" ? secret.description : undefined,
        isRequired: true,
        isSecret: true,
      }));

  const server: RegistryServer = {
    name: `io.docker.mcp/${name}`,
    title,
    description,
    version,
    repository: {
      url: repositoryUrl,
      source: "github",
    },
    _meta: {
      "dev.toolpin/source": {
        source: "docker",
        path: entryPath,
        category: asRecord(parsed.meta).category,
        tags: asRecord(parsed.meta).tags,
      },
    },
  };

  const remote = asRecord(parsed.remote);
  if (parsed.type === "remote" && typeof remote.url === "string") {
    const headers = asRecord(remote.headers);
    server.remotes = [{
      type: typeof remote.transport_type === "string" ? remote.transport_type : "streamable-http",
      url: String(remote.url),
      headers: Object.keys(headers).map((header) => {
        const value = String(headers[header]);
        return {
          name: header,
          value,
          env: extractEnvName(value),
          isRequired: true,
          isSecret: value.includes("${"),
        };
      }),
    }];
  } else if (typeof parsed.image === "string" && parsed.image) {
    server.packages = [{
      registryType: "oci",
      identifier: parsed.image,
      transport: { type: "stdio" },
      runtimeHint: "docker",
      environmentVariables: envVars,
    }];
  }

  return { entry: {
    server,
    _meta: {
      "dev.toolpin/source": {
        source: "docker",
        path: entryPath,
        curated: true,
      },
    },
  } };
}

function tagRegistryEntry(entry: RegistryEntry | { server: RegistryServer }, sourceInfo: RegistrySourceInfo): RegistryEntry {
  const maybeEntry = entry as RegistryEntry;
  const existingMeta = isRecord(maybeEntry._meta) ? maybeEntry._meta : {};
  const existingServerMeta = isRecord(entry.server._meta) ? entry.server._meta : {};
  const existingSourceMeta = isRecord(existingMeta["dev.toolpin/source"]) ? existingMeta["dev.toolpin/source"] as Record<string, unknown> : {};
  const sourceMeta = {
    ...existingSourceMeta,
    source: sourceInfo.id,
    type: sourceInfo.type,
    mode: sourceInfo.mode,
    trust: sourceInfo.trust,
    url: sourceInfo.url,
  };
  return {
    ...entry,
    source: sourceInfo.id,
    server: {
      ...entry.server,
      _meta: {
        ...existingServerMeta,
        "dev.toolpin/source": {
          ...(isRecord(existingServerMeta["dev.toolpin/source"]) ? existingServerMeta["dev.toolpin/source"] as Record<string, unknown> : {}),
          ...sourceMeta,
        },
      },
    },
    _meta: {
      ...existingMeta,
      "dev.toolpin/source": sourceMeta,
    },
  };
}

export async function writeCache(entries: RegistryEntry[], cachePath = DEFAULT_CACHE_PATH): Promise<void> {
  const bySource = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    const source = entry.source ?? detectSource(entry);
    bySource.set(source, [...(bySource.get(source) ?? []), entry]);
  }
  const adapters = await registryAdapters().catch(() => []);
  const now = new Date().toISOString();
  const results = [...bySource.entries()].map(([sourceId, sourceEntries]): RegistryFetchResult => {
    const source = adapters.find((adapter) => adapter.info.id === sourceId)?.info ?? {
      id: sourceId,
      label: sourceId,
      type: "custom",
      mode: "installable",
      trust: "private",
      enabled: true,
      authRequired: false,
      description: "Registry source inferred from cached entries.",
    };
    return successResult(source, sourceEntries, { accepted: sourceEntries.length, fetchedAt: now });
  });
  await writeCacheResults(results, cachePath);
}

export async function writeCacheResults(results: RegistryFetchResult[], cachePath = DEFAULT_CACHE_PATH): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const generatedAt = new Date().toISOString();
  const sources: Record<string, RegistryCachePartition> = {};
  for (const result of results) {
    if (result.source.id === "all") continue;
    sources[result.source.id] = resultToPartition(result);
  }
  await writeFile(
    cachePath,
    JSON.stringify({ schema: "dev.toolpin.registry-cache.v2", generatedAt, ttlMs: DEFAULT_CACHE_TTL_MS, sources }, null, 2),
    "utf8",
  );
}

export async function refreshCache(options: FetchOptions & { cachePath?: string } = {}): Promise<RegistryFetchResult & { results?: RegistryFetchResult[] }> {
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  const result = await fetchRegistryResult(options);
  const existing = await readCacheMetadata(cachePath).catch(() => emptyCacheFile());
  const next: RegistryCacheFileV2 = {
    schema: "dev.toolpin.registry-cache.v2",
    generatedAt: new Date().toISOString(),
    ttlMs: DEFAULT_CACHE_TTL_MS,
    sources: { ...existing.sources },
  };
  const results = result.results ?? [result];
  for (const sourceResult of results) {
    if (sourceResult.source.id === "all") continue;
    if (sourceResult.status === "fetch-error" || sourceResult.status === "auth-missing" || sourceResult.status === "disabled") {
      const stale = next.sources[sourceResult.source.id];
      next.sources[sourceResult.source.id] = stale
        ? { ...stale, source: sourceResult.source, status: "stale", lastError: sourceResult.lastError, failed: stale.failed + Math.max(1, sourceResult.failed) }
        : resultToPartition(sourceResult);
      continue;
    }
    next.sources[sourceResult.source.id] = resultToPartition(sourceResult);
  }
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return result;
}

export async function readCache(cachePath = DEFAULT_CACHE_PATH, options: Pick<FetchOptions, "cacheTtlMs" | "allowStaleCache" | "ci"> = {}): Promise<RegistryEntry[]> {
  return flattenCache(await readCacheMetadata(cachePath, options));
}

export async function readCacheMetadata(cachePath = DEFAULT_CACHE_PATH, options: Pick<FetchOptions, "cacheTtlMs" | "allowStaleCache" | "ci"> = {}): Promise<RegistryCacheFileV2> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(cachePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CacheSchemaError(`Invalid registry cache JSON in ${cachePath}: ${error.message}`);
    }
    throw error;
  }
  if (!isCacheFile(parsed) && !isCacheFileV2(parsed)) {
    throw new CacheSchemaError(`Invalid registry cache schema in ${cachePath}: expected an object with an entries array.`);
  }
  const cache = isCacheFileV2(parsed) ? parsed : v1CacheToV2(parsed);
  const generatedAt = Date.parse(cache.generatedAt);
  const ttlMs = options.cacheTtlMs ?? cache.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const stale = Number.isFinite(generatedAt) && Date.now() - generatedAt > ttlMs;
  if (stale) {
    const message = `Registry cache ${cachePath} is stale; generatedAt=${cache.generatedAt}, ttlMs=${ttlMs}.`;
    if (options.ci && !options.allowStaleCache) throw new CacheSchemaError(message);
    process.stderr.write(`Warning: ${message}\n`);
  }
  return cache;
}

export class CacheSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheSchemaError";
  }
}

function emptyCacheFile(): RegistryCacheFileV2 {
  return {
    schema: "dev.toolpin.registry-cache.v2",
    generatedAt: new Date().toISOString(),
    ttlMs: DEFAULT_CACHE_TTL_MS,
    sources: {},
  };
}

function resultToPartition(result: RegistryFetchResult): RegistryCachePartition {
  return {
    source: result.source,
    status: result.status,
    generatedAt: result.fetchedAt,
    ttlMs: DEFAULT_CACHE_TTL_MS,
    entries: result.entries,
    pageInfo: result.pageInfo,
    accepted: result.accepted,
    skipped: result.skipped,
    malformed: result.malformed,
    failed: result.failed,
    lastError: result.lastError,
  };
}

function v1CacheToV2(cache: { generatedAt: string; ttlMs?: number; entries: RegistryEntry[] }): RegistryCacheFileV2 {
  const sources: Record<string, RegistryCachePartition> = {};
  for (const entry of cache.entries) {
    const sourceId = entry.source ?? detectSource(entry);
    const source = sources[sourceId]?.source ?? {
      id: sourceId,
      label: sourceId,
      type: sourceId === "official" ? "official" : sourceId === "docker" ? "docker" : "custom",
      mode: "installable",
      trust: sourceId === "official" ? "canonical" : sourceId === "docker" ? "curated" : "private",
      enabled: true,
      authRequired: false,
      description: "Registry source migrated from v1 cache.",
    } satisfies RegistrySourceInfo;
    const existing = sources[sourceId];
    sources[sourceId] = {
      source,
      status: "ready",
      generatedAt: cache.generatedAt,
      ttlMs: cache.ttlMs ?? DEFAULT_CACHE_TTL_MS,
      entries: [...(existing?.entries ?? []), entry],
      accepted: (existing?.accepted ?? 0) + 1,
      skipped: existing?.skipped ?? 0,
      malformed: existing?.malformed ?? 0,
      failed: existing?.failed ?? 0,
    };
  }
  return {
    schema: "dev.toolpin.registry-cache.v2",
    generatedAt: cache.generatedAt,
    ttlMs: cache.ttlMs ?? DEFAULT_CACHE_TTL_MS,
    sources,
  };
}

function flattenCache(cache: RegistryCacheFileV2): RegistryEntry[] {
  return Object.values(cache.sources).flatMap((partition) => partition.entries);
}

export function normalizeEntry(entry: RegistryEntry): NormalizedServer {
  const server = entry.server;
  const officialMeta = getOfficialMeta(entry._meta);
  const packages = server.packages ?? [];
  const remotes = server.remotes ?? [];
  const packageTypes = unique(packages.map((pkg) => pkg.registryType).filter(Boolean));
  const remoteTypes = unique(remotes.map((remote) => remote.type).filter(Boolean));
  const packageTransports = packages.map((pkg) => pkg.transport?.type).filter(Boolean) as string[];
  const transports = unique([...packageTransports, ...remoteTypes]);
  const sourceMeta = getToolpinSourceMeta(entry);
  const registrySource = entry.source ?? detectSource(entry);
  const registryMode = sourceMeta.mode === "discovery" ? "discovery" : "installable";
  const hasInstallTarget = packages.length > 0 || remotes.length > 0;
  const hasVerifiableTarget = hasVerifiableInstallTarget(server);
  const glamaNeedsOfficialResolution = registrySource === "glama" && registryMode === "discovery";
  const installable = hasInstallTarget && (registryMode === "installable" || (hasVerifiableTarget && !glamaNeedsOfficialResolution));

  return {
    registrySource,
    registryMode,
    name: server.name,
    title: server.title ?? server.name,
    description: server.description ?? "",
    version: server.version,
    isLatest: officialMeta?.isLatest === true,
    installable,
    installableReason: installable
      ? undefined
      : registryMode === "discovery"
        ? glamaNeedsOfficialResolution
          ? "Glama entries require official registry re-resolution before install"
          : "registry entry has no verifiable package or HTTPS remote target"
        : "registry entry has no package or remote install target",
    repositoryUrl: server.repository?.url,
    packageTypes,
    remoteTypes,
    transports,
    requiresSecrets: hasSecrets(server),
    raw: server,
    registryMeta: entry._meta,
  };
}

function detectSource(entry: RegistryEntry): RegistrySourceId {
  const sourceMeta = getToolpinSourceMeta(entry);
  return typeof sourceMeta.source === "string" ? sourceMeta.source : "official";
}

function getToolpinSourceMeta(entry: RegistryEntry): { source?: unknown; mode?: unknown } {
  const meta = entry._meta?.["dev.toolpin/source"] ?? entry.server._meta?.["dev.toolpin/source"];
  return isRecord(meta) ? meta : {};
}

function extractEnvName(value: string): string | undefined {
  return value.match(/\$\{([^}]+)\}/)?.[1];
}

export function normalizeEntries(entries: RegistryEntry[]): NormalizedServer[] {
  return entries.map(normalizeEntry);
}

export function latestOnly(servers: NormalizedServer[]): NormalizedServer[] {
  const byName = new Map<string, NormalizedServer>();
  for (const server of servers) {
    const existing = byName.get(server.name);
    if (!existing || server.isLatest || compareVersionish(server.version, existing.version) > 0) {
      byName.set(server.name, server);
    }
  }
  return [...byName.values()];
}

function getOfficialMeta(meta?: Record<string, unknown>): { isLatest?: boolean } | undefined {
  const value = meta?.["io.modelcontextprotocol.registry/official"];
  return value && typeof value === "object" ? (value as { isLatest?: boolean }) : undefined;
}

function hasSecrets(server: { packages?: unknown[]; remotes?: unknown[] }): boolean {
  const packages = (server.packages ?? []) as Array<{ environmentVariables?: Array<{ isSecret?: boolean }> }>;
  const remotes = (server.remotes ?? []) as Array<{ headers?: Array<{ isSecret?: boolean }> }>;
  return (
    packages.some((pkg) => pkg.environmentVariables?.some((env) => env.isSecret)) ||
    remotes.some((remote) => remote.headers?.some((header) => header.isSecret))
  );
}

function hasVerifiableInstallTarget(server: RegistryServer): boolean {
  return (server.packages ?? []).some(isVerifiablePackageTarget)
    || (server.remotes ?? []).some((remote) => isHttpsUrl(remote.url));
}

function isVerifiablePackageTarget(pkg: RegistryPackage): boolean {
  if (pkg.registryType === "oci") return /@sha256:[a-fA-F0-9]{64}$/.test(pkg.identifier);
  if (pkg.registryType === "mcpb") return isValidSha256Hex(pkg.fileSha256) && isHttpsUrl(pkg.identifier);
  if (pkg.registryType === "npm") return Boolean(pkg.version && !isFloatingVersion(pkg.version));
  return false;
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isValidSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isFloatingVersion(version: string): boolean {
  return ["latest", "*"].includes(version.trim().toLowerCase()) || /[~^x*]/i.test(version);
}

function isCacheFile(value: unknown): value is { generatedAt: string; ttlMs?: number; entries: RegistryEntry[] } {
  return (
    isRecord(value) &&
    typeof value.generatedAt === "string" &&
    (value.ttlMs === undefined || typeof value.ttlMs === "number") &&
    Array.isArray(value.entries) &&
    value.entries.every((entry) => (
      isRecord(entry) &&
      isRecord(entry.server) &&
      typeof entry.server.name === "string" &&
      typeof entry.server.version === "string"
    ))
  );
}

function isCacheFileV2(value: unknown): value is RegistryCacheFileV2 {
  return (
    isRecord(value) &&
    value.schema === "dev.toolpin.registry-cache.v2" &&
    typeof value.generatedAt === "string" &&
    typeof value.ttlMs === "number" &&
    isRecord(value.sources) &&
    Object.values(value.sources).every((partition) => (
      isRecord(partition) &&
      isRecord(partition.source) &&
      typeof partition.source.id === "string" &&
      typeof partition.source.label === "string" &&
      typeof partition.generatedAt === "string" &&
      Array.isArray(partition.entries) &&
      partition.entries.every((entry) => (
        isRecord(entry) &&
        isRecord(entry.server) &&
        typeof entry.server.name === "string" &&
        typeof entry.server.version === "string"
      ))
    ))
  );
}

function isRegistryConfig(value: unknown): value is RegistryConfig {
  return (
    isRecord(value) &&
    Array.isArray(value.registries) &&
    (value.sources === undefined || (
      isRecord(value.sources) &&
      Object.values(value.sources).every((entry) => (
        isRecord(entry) &&
        (entry.enabled === undefined || typeof entry.enabled === "boolean")
      ))
    )) &&
    value.registries.every((entry) => (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      entry.id.length > 0 &&
      (entry.url === undefined || (typeof entry.url === "string" && entry.url.length > 0)) &&
      (entry.type === undefined || ["official-compatible", "http-json", "official", "docker", "glama", "smithery", "pulsemcp", "custom"].includes(String(entry.type))) &&
      (entry.adapter === undefined || ["official-compatible", "http-json", "glama", "smithery", "pulsemcp"].includes(String(entry.adapter))) &&
      (entry.mode === undefined || entry.mode === "installable" || entry.mode === "discovery") &&
      (entry.enabled === undefined || typeof entry.enabled === "boolean")
    ))
  );
}

function extractHttpJsonEntries(body: unknown): { entries: RegistryEntry[]; report: RegistryParseReport } | undefined {
  const value = isRecord(body) ? body.servers ?? body.entries : undefined;
  if (!Array.isArray(value)) return undefined;
  const report: RegistryParseReport = { accepted: 0, skipped: 0, malformed: 0, failed: 0, reasons: [] };
  const entries: RegistryEntry[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseRegistryEntry(item);
    if (parsed.entry) {
      entries.push(parsed.entry);
      report.accepted += 1;
    } else {
      report.malformed += 1;
      report.reasons.push(`entry[${index}]: ${parsed.reason}`);
    }
  }
  return { entries, report };
}

function parseRegistryEntry(item: unknown): { entry?: RegistryEntry; reason: string } {
  if (!isRecord(item)) return { reason: "entry is not an object" };
  const maybeServer = isRecord(item.server) ? item.server : item;
  const server = parseRegistryServer(maybeServer);
  if (!server.server) return { reason: server.reason };
  return {
    entry: {
      server: server.server,
      _meta: isRecord(item._meta) ? item._meta : undefined,
      source: typeof item.source === "string" ? item.source : undefined,
    },
    reason: "ok",
  };
}

function extractDirectoryEntries(body: unknown, sourceInfo: RegistrySourceInfo): { entries: RegistryEntry[]; report: RegistryParseReport; pageInfo: RegistryFetchPageInfo } | undefined {
  const array = directoryArray(body);
  if (!array) return undefined;
  const report: RegistryParseReport = { accepted: 0, skipped: 0, malformed: 0, failed: 0, reasons: [] };
  const entries: RegistryEntry[] = [];
  for (const [index, item] of array.entries()) {
    const entry = directoryItemToEntry(item, sourceInfo);
    if (entry.entry) {
      entries.push(tagRegistryEntry(entry.entry, sourceInfo));
      report.accepted += 1;
    } else {
      report.malformed += 1;
      report.reasons.push(`entry[${index}]: ${entry.reason}`);
    }
  }
  return { entries, report, pageInfo: directoryPageInfo(body) };
}

function directoryArray(body: unknown): unknown[] | undefined {
  if (!isRecord(body)) return undefined;
  const candidates = [
    body.servers,
    body.data,
    body.items,
    body.results,
    isRecord(body.page) ? body.page.items : undefined,
  ];
  return candidates.find(Array.isArray);
}

function directoryPageInfo(body: unknown): RegistryFetchPageInfo {
  const root = asRecord(body);
  const pageInfo = asRecord(root.pageInfo ?? root.pagination ?? root.metadata);
  const nextCursor = stringValue(pageInfo.endCursor ?? pageInfo.nextCursor ?? pageInfo.cursor ?? root.nextCursor);
  const hasMoreValue = pageInfo.hasNextPage ?? pageInfo.hasMore ?? root.hasMore;
  return {
    fetchedPages: 1,
    maxPages: 1,
    hasMore: typeof hasMoreValue === "boolean" ? hasMoreValue : Boolean(nextCursor),
    nextCursor,
    total: numberValue(pageInfo.total ?? pageInfo.count ?? root.total ?? root.count),
  };
}

function directoryItemToEntry(item: unknown, sourceInfo: RegistrySourceInfo): { entry?: RegistryEntry; reason: string } {
  if (!isRecord(item)) return { reason: "entry is not an object" };
  const maybeOfficial = parseRegistryEntry(item);
  if (maybeOfficial.entry) return maybeOfficial;

  const name = firstNonEmptyString(item.name, item.qualifiedName, item.packageName, item.slug, item.id);
  if (!name) return { reason: "directory entry has no name, slug, id, packageName, or qualifiedName" };
  const repositoryUrl = repositoryUrlFromDirectoryItem(item);
  const server: RegistryServer = {
    name,
    title: stringValue(item.title ?? item.displayName ?? item.name) ?? name,
    description: stringValue(item.description ?? item.summary ?? item.readme) ?? "",
    version: stringValue(item.version ?? item.latestVersion ?? item.packageVersion) ?? "directory",
    repository: repositoryUrl ? { url: repositoryUrl, source: repositorySource(repositoryUrl) } : undefined,
    _meta: {
      "dev.toolpin/source": {
        source: sourceInfo.id,
        mode: "discovery",
        directoryId: stringValue(item.id ?? item.slug),
        rawUrl: stringValue(item.url ?? item.homepageUrl ?? item.websiteUrl),
      },
    },
  };
  const target = verifiedInstallTarget(item);
  if (target.packages.length || target.remotes.length) {
    server.packages = target.packages.length ? target.packages : undefined;
    server.remotes = target.remotes.length ? target.remotes : undefined;
  }
  return { entry: { server }, reason: "ok" };
}

function repositoryUrlFromDirectoryItem(item: Record<string, unknown>): string | undefined {
  const repository = asRecord(item.repository ?? item.repo);
  return stringValue(repository.url ?? repository.homepage)
    ?? stringValue(item.repositoryUrl ?? item.repoUrl ?? item.sourceUrl ?? item.githubUrl);
}

function repositorySource(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function verifiedInstallTarget(item: Record<string, unknown>): { packages: RegistryPackage[]; remotes: RegistryRemote[] } {
  const packages = Array.isArray(item.packages) ? item.packages.filter(isRegistryPackage) : [];
  const remotes = Array.isArray(item.remotes) ? item.remotes.filter(isRegistryRemote) : [];
  const packageTarget = asRecord(item.package);
  if (packages.length === 0 && typeof packageTarget.registryType === "string" && typeof packageTarget.identifier === "string") {
    packages.push(packageTarget as RegistryPackage);
  }
  const remoteTarget = asRecord(item.remote);
  if (remotes.length === 0 && typeof remoteTarget.type === "string" && typeof remoteTarget.url === "string") {
    remotes.push(remoteTarget as RegistryRemote);
  }
  return { packages, remotes };
}

function parseRegistryServer(value: Record<string, unknown>): { server?: RegistryServer; reason: string } {
  if (typeof value.name !== "string" || !value.name) return { reason: "server.name is required" };
  if (typeof value.version !== "string" || !value.version) return { reason: "server.version is required" };
  const packages = Array.isArray(value.packages) ? value.packages.filter(isRegistryPackage) : undefined;
  const remotes = Array.isArray(value.remotes) ? value.remotes.filter(isRegistryRemote) : undefined;
  return {
    server: {
      $schema: typeof value.$schema === "string" ? value.$schema : undefined,
      name: value.name,
      title: typeof value.title === "string" ? value.title : undefined,
      description: typeof value.description === "string" ? value.description : undefined,
      version: value.version,
      packages,
      remotes,
      repository: isRegistryRepository(value.repository) ? value.repository : undefined,
      _meta: isRecord(value._meta) ? value._meta : undefined,
    },
    reason: "ok",
  };
}

function isRegistryPackage(value: unknown): value is RegistryPackage {
  return isRecord(value) && typeof value.registryType === "string" && typeof value.identifier === "string";
}

function isRegistryRemote(value: unknown): value is RegistryRemote {
  return isRecord(value) && typeof value.type === "string" && typeof value.url === "string";
}

function isRegistryRepository(value: unknown): value is RegistryRepository {
  return isRecord(value) && typeof value.url === "string";
}

function warnRegistryReport(label: string, report: RegistryParseReport, options: FetchOptions): void {
  const message = `${label}: accepted ${report.accepted}, skipped ${report.skipped}, malformed ${report.malformed}, failed ${report.failed}.`;
  if (options.ci && (report.failed || report.malformed)) {
    throw new Error(`${message} ${report.reasons.slice(0, 5).join("; ")}`);
  }
  if (report.skipped || report.malformed || report.failed) {
    process.stderr.write(`Warning: ${message}${report.reasons.length ? ` ${report.reasons.slice(0, 5).join("; ")}` : ""}\n`);
  }
}

function successResult(
  source: RegistrySourceInfo,
  entries: RegistryEntry[],
  options: Partial<Pick<RegistryFetchResult, "status" | "accepted" | "skipped" | "malformed" | "failed" | "lastError" | "pageInfo" | "fetchedAt">> = {},
): RegistryFetchResult {
  return {
    source: { ...source, status: options.status ?? sourceStatus(source) },
    status: options.status ?? sourceStatus(source),
    entries,
    accepted: options.accepted ?? entries.length,
    skipped: options.skipped ?? 0,
    malformed: options.malformed ?? 0,
    failed: options.failed ?? 0,
    lastError: options.lastError,
    pageInfo: options.pageInfo,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
  };
}

function emptyResult(source: RegistrySourceInfo, status: SourceStatus, lastError?: string): RegistryFetchResult {
  return {
    source: { ...source, status },
    status,
    entries: [],
    accepted: 0,
    skipped: 0,
    malformed: 0,
    failed: lastError ? 1 : 0,
    lastError,
    fetchedAt: new Date().toISOString(),
  };
}

function fetchErrorResult(source: RegistrySourceInfo, error: unknown): RegistryFetchResult {
  return emptyResult(source, "fetch-error", error instanceof Error ? error.message : String(error));
}

function allSourcesInfo(): RegistrySourceInfo {
  return {
    id: "all",
    label: "All enabled registry sources",
    type: "custom",
    mode: "discovery",
    trust: "directory",
    enabled: true,
    authRequired: false,
    description: "Aggregated result from every enabled source.",
  };
}

function sourceStatus(source: RegistrySourceInfo): SourceStatus {
  if (!source.enabled) return "disabled";
  if (source.status === "auth-missing" || source.status === "fetch-error" || source.status === "stale") return source.status;
  if (source.mode === "discovery") return "discovery-only";
  return "ready";
}

function defaultUrlForAdapter(adapter: RegistryAdapterKind | RegistrySourceType | undefined): string | undefined {
  if (adapter === "glama") return GLAMA_SERVERS_URL;
  if (adapter === "smithery") return SMITHERY_SERVERS_URL;
  if (adapter === "pulsemcp") return PULSEMCP_SERVERS_URL;
  return undefined;
}

function adapterKind(value: RegistryAdapterKind | RegistrySourceType | undefined): RegistryAdapterKind {
  if (value === "http-json" || value === "glama" || value === "smithery" || value === "pulsemcp") return value;
  return "official-compatible";
}

function firstAuthEnv(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.find(Boolean);
  return value;
}

function requiredUrl(url: string | undefined, source: RegistrySourceInfo): string {
  if (url) return url;
  throw new Error(`${source.label} registry URL is required.`);
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Accept": "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function mergeAdapters(adapters: RegistryAdapter[]): RegistryAdapter[] {
  const byId = new Map<string, RegistryAdapter>();
  for (const adapter of adapters) {
    if (byId.has(adapter.info.id)) continue;
    byId.set(adapter.info.id, adapter);
  }
  return [...byId.values()];
}

export function dedupeRegistryEntries(entries: RegistryEntry[]): RegistryEntry[] {
  const byKey = new Map<string, RegistryEntry>();
  for (const entry of entries) {
    const key = registryEntryKey(entry);
    const existing = byKey.get(key);
    if (!existing || sourceRank(entry.source) < sourceRank(existing.source)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

function registryEntryKey(entry: RegistryEntry): string {
  const repositoryUrl = normalizeUrl(entry.server.repository?.url);
  if (repositoryUrl) return `repo:${repositoryUrl}:${entry.server.name}:${entry.server.version}`;
  return `name:${entry.server.name}:${entry.server.version}`;
}

function sourceRank(source: string | undefined): number {
  if (source === "official") return 0;
  if (source === "docker") return 1;
  return 2;
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function enrichSmitheryTarget(
  server: NormalizedServer,
  options: { allowHostedDirectoryTargets?: boolean } = {},
): Promise<NormalizedServer> {
  if (server.registrySource !== "smithery") return server;
  if (!options.allowHostedDirectoryTargets) {
    return {
      ...server,
      installable: false,
      installableReason:
        "Smithery hosted targets require explicit opt-in (--allow-hosted-directory-targets); subject to Smithery terms",
    };
  }
  if ((server.raw.remotes ?? []).length > 0 || (server.raw.packages ?? []).length > 0) {
    return {
      ...server,
      resolutionNote: "hosted by Smithery; subject to Smithery terms",
    };
  }
  const qualifiedName = server.name;
  if (!qualifiedName) return server;
  const headers: Record<string, string> = {};
  if (process.env.SMITHERY_API_KEY) headers.Authorization = `Bearer ${process.env.SMITHERY_API_KEY}`;
  let detail: { deploymentUrl?: unknown; connections?: unknown };
  try {
    detail = await safeFetchJson<{ deploymentUrl?: unknown; connections?: unknown }>(
      `${SMITHERY_SERVERS_URL}/${encodeURIComponent(qualifiedName)}`,
      { timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS, headers },
    );
  } catch {
    return server;
  }
  const deploymentUrl = firstNonEmptyString(
    detail.deploymentUrl,
    ...(Array.isArray(detail.connections) ? detail.connections : []).map((connection) =>
      isRecord(connection) ? connection.deploymentUrl : undefined,
    ),
  );
  if (!deploymentUrl || !isHttpsUrl(deploymentUrl)) return server;
  const remote: RegistryRemote = { type: "streamable-http", url: deploymentUrl };
  const remotes = [...(server.raw.remotes ?? []), remote];
  const packages = server.raw.packages ?? [];
  const remoteTypes = Array.from(new Set([...server.remoteTypes, "streamable-http"]));
  const transports = Array.from(new Set([...server.transports, "streamable-http"]));
  return {
    ...server,
    raw: { ...server.raw, remotes },
    packageTypes: server.packageTypes,
    remoteTypes,
    transports,
    installable: true,
    installableReason: undefined,
    resolutionNote: "hosted by Smithery; subject to Smithery terms",
  };
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = stringValue(value);
    if (candidate) return candidate;
  }
  return undefined;
}

export function canonicalRepoUrl(input: unknown): string | undefined {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return undefined;
  let s = trimmed
    .replace(/^(git\+|svn\+|hg\+|bzr\+)/i, "")
    .replace(/^github:/i, "https://github.com/")
    .replace(/^git@([^:/#]+):/i, "https://$1/")
    .replace(/^ssh:\/\/git@/i, "https://")
    .replace(/^(ssh|git):\/\//i, "https://");
  let host: string;
  let pathName: string;
  try {
    const url = new URL(s);
    host = url.hostname.toLowerCase().replace(/^www\./, "");
    pathName = url.pathname;
  } catch {
    const fallback = s.replace(/[?#].*$/, "").replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
    return fallback.includes("/") ? fallback : undefined;
  }
  pathName = pathName.replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
  const canonical = host + pathName;
  return canonical === host || !pathName || pathName === "/" ? undefined : canonical;
}

export async function enrichGlamaTarget(server: NormalizedServer, options: { cachePath?: string } = {}): Promise<NormalizedServer> {
  if (server.registrySource !== "glama") return server;
  if ((server.raw.packages ?? []).length > 0 || (server.raw.remotes ?? []).length > 0) return server;
  const glamaRepo = server.repositoryUrl;
  if (!glamaRepo) return server;

  const match = await findOfficialMatch({ repoUrl: glamaRepo, name: server.name, cachePath: options.cachePath });
  if (!match) {
    return {
      ...server,
      installableReason: "no matching official-registry entry; install via the publisher's repo",
    };
  }

  const packages = match.server.packages ?? [];
  const remotes = match.server.remotes ?? [];
  if (packages.length === 0 && remotes.length === 0) return server;

  const packageTypes = unique(packages.map((pkg) => pkg.registryType).filter(Boolean));
  const remoteTypes = unique(remotes.map((remote) => remote.type).filter(Boolean));
  const transports = unique([...server.transports, ...packageTypes, ...remoteTypes]);
  return {
    ...server,
    raw: {
      ...server.raw,
      packages: packages.length ? packages : undefined,
      remotes: remotes.length ? remotes : undefined,
    },
    packageTypes,
    remoteTypes,
    transports,
    installable: true,
    installableReason: undefined,
    resolvedFromRegistry: "official",
    resolutionNote: match.matchedByName
      ? "installed via official registry (matched from Glama by repo + name)"
      : "installed via official registry (matched from Glama by repo)",
  };
}

interface OfficialMatch {
  server: RegistryServer;
  matchedByName: boolean;
}

async function findOfficialMatch(options: { repoUrl: string; name: string; cachePath?: string }): Promise<OfficialMatch | undefined> {
  const canonical = canonicalRepoUrl(options.repoUrl);
  if (!canonical) return undefined;
  const candidates = await loadOfficialCandidates({ cachePath: options.cachePath });
  const sameRepo = candidates.filter((entry) => canonicalRepoUrl(entry.server.repository?.url) === canonical);
  if (sameRepo.length === 0) return undefined;
  if (sameRepo.length === 1) return { server: sameRepo[0].server, matchedByName: false };
  const byName = sameRepo.filter((entry) => namesMatch(entry.server.name, options.name));
  if (byName.length === 1) return { server: byName[0].server, matchedByName: true };
  return undefined;
}

async function loadOfficialCandidates(options: { cachePath?: string } = {}): Promise<RegistryEntry[]> {
  try {
    const cache = await readCacheMetadata(options.cachePath ?? DEFAULT_CACHE_PATH, { allowStaleCache: true });
    const partition = cache.sources?.["official"];
    if (partition?.entries?.length) return partition.entries;
  } catch {
    // fall through to a live fetch
  }
  try {
    const entries = await fetchRegistry({ maxPages: DEFAULT_OFFICIAL_MAX_PAGES });
    return entries.filter((entry) => (entry.source ?? "official") === "official");
  } catch {
    return [];
  }
}

function namesMatch(officialName: string, glamaName: string): boolean {
  const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const officialLeaf = normalizeName(officialName.split("/").pop() ?? officialName);
  const slug = normalizeName(glamaName);
  return officialLeaf.length > 1 && slug.length > 1 && (officialLeaf === slug || officialLeaf.includes(slug) || slug.includes(officialLeaf));
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
