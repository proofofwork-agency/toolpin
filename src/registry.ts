import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { NormalizedServer, RegistryEntry, RegistryListResponse, RegistryServer, RegistrySourceId, RegistrySourceInfo, RegistrySourceMode, RegistrySourceType } from "./types.js";
import { compareVersionish } from "./versions.js";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0";
const DEFAULT_CACHE_PATH = path.join(process.cwd(), ".toolpin", "registry-cache.json");
const DEFAULT_REGISTRY_CONFIG_PATH = path.join(process.cwd(), ".toolpin", "registries.json");
const DOCKER_TREE_URL = "https://api.github.com/repos/docker/mcp-registry/git/trees/main?recursive=1";
const DOCKER_RAW_BASE = "https://raw.githubusercontent.com/docker/mcp-registry/main";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_BACKOFF_MS = 100;
const DEFAULT_DOCKER_CONCURRENCY = 12;
const MAX_DOCKER_CONCURRENCY = 50;
const MAX_RETRY_AFTER_MS = 5_000;

export const BUILTIN_REGISTRY_SOURCES: RegistrySourceInfo[] = [
  {
    id: "official",
    label: "Official MCP Registry",
    type: "official",
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
    mode: "installable",
    trust: "curated",
    enabled: true,
    authRequired: false,
    description: "Curated Docker MCP catalog with reviewed container/remote entries.",
  },
  {
    id: "pulse",
    label: "PulseMCP",
    type: "known",
    mode: "discovery",
    trust: "directory",
    enabled: false,
    authRequired: true,
    description: "Enriched sub-registry API; requires PulseMCP API key and tenant.",
  },
  {
    id: "smithery",
    label: "Smithery",
    type: "known",
    mode: "discovery",
    trust: "directory",
    enabled: false,
    authRequired: true,
    description: "Hosted registry/search API; requires Smithery API key.",
  },
  {
    id: "glama",
    label: "Glama",
    type: "known",
    mode: "discovery",
    trust: "directory",
    enabled: false,
    authRequired: false,
    description: "Large public directory with rich scans; no stable public adapter enabled yet.",
  },
];

export const REGISTRY_SOURCES = BUILTIN_REGISTRY_SOURCES;

export interface RegistryAdapter {
  info: RegistrySourceInfo;
  fetch(options: FetchOptions): Promise<RegistryEntry[]>;
}

export interface RegistryConfig {
  registries: ConfiguredRegistrySource[];
}

export interface ConfiguredRegistrySource {
  id: string;
  type?: RegistrySourceType;
  url: string;
  label?: string;
  mode?: RegistrySourceMode;
  trust?: RegistrySourceInfo["trust"];
  enabled?: boolean;
  authEnv?: string;
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

export async function fetchRegistry(options: FetchOptions = {}): Promise<RegistryEntry[]> {
  const source = options.source ?? "official";
  const adapters = await registryAdapters(options.registryConfigPath);
  if (source === "all") {
    const fetchable = adapters.filter((adapter) => adapter.info.enabled && adapter.info.type !== "known");
    const entries = (await Promise.all(fetchable.map((adapter) => adapter.fetch(options)))).flat();
    return dedupeRegistryEntries(entries);
  }

  const adapter = adapters.find((candidate) => candidate.info.id === source);
  if (!adapter) {
    throw new Error(`Unknown registry source: ${source}. Add it to .toolpin/registries.json or run \`toolpin registry list\`.`);
  }
  if (!adapter.info.enabled || adapter.info.type === "known") {
    throw new Error(`--source ${adapter.info.id} is known but not enabled yet. ${adapter.info.label} has no fetch adapter enabled.`);
  }
  return adapter.fetch(options);
}

export async function listRegistrySources(options: { registryConfigPath?: string } = {}): Promise<RegistrySourceInfo[]> {
  return (await registryAdapters(options.registryConfigPath)).map((adapter) => adapter.info);
}

export async function readRegistryConfig(configPath = DEFAULT_REGISTRY_CONFIG_PATH): Promise<RegistryConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { registries: [] };
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

async function registryAdapters(configPath?: string): Promise<RegistryAdapter[]> {
  const config = await readRegistryConfig(configPath);
  const builtins: RegistryAdapter[] = BUILTIN_REGISTRY_SOURCES.map((info) => ({
    info,
    fetch: info.id === "official"
      ? (options) => fetchOfficialRegistry({ ...options, sourceInfo: info })
      : info.id === "docker"
        ? fetchDockerRegistry
        : async () => {
            throw new Error(`${info.label} is known but no unauthenticated adapter is enabled yet.`);
          },
  }));

  const custom = config.registries.map(configuredRegistryAdapter);
  return mergeAdapters([...builtins, ...custom]);
}

function configuredRegistryAdapter(config: ConfiguredRegistrySource): RegistryAdapter {
  const type = config.type ?? "official-compatible";
  const mode = config.mode ?? (type === "official-compatible" ? "installable" : "discovery");
  const info: RegistrySourceInfo = {
    id: config.id,
    label: config.label ?? config.id,
    type,
    mode,
    trust: config.trust ?? "private",
    enabled: config.enabled !== false,
    authRequired: Boolean(config.authEnv),
    description: config.description ?? `${type} registry configured in .toolpin/registries.json.`,
    url: config.url,
  };
  return {
    info,
    fetch: type === "http-json"
      ? (options) => fetchHttpJsonRegistry(config.url, info, options)
      : (options) => fetchOfficialRegistry({ ...options, registryUrl: config.url, sourceInfo: info }),
  };
}

async function fetchOfficialRegistry(options: FetchOptions & { sourceInfo?: RegistrySourceInfo } = {}): Promise<RegistryEntry[]> {
  const sourceInfo = options.sourceInfo ?? BUILTIN_REGISTRY_SOURCES.find((source) => source.id === "official")!;
  const registryUrl = options.registryUrl ?? sourceInfo.url ?? DEFAULT_REGISTRY_URL;
  const limit = Math.min(options.limit ?? 100, 100);
  const maxPages = options.maxPages ?? 5;
  const entries: RegistryEntry[] = [];
  let cursor: string | undefined;

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

    cursor = body.metadata?.nextCursor;
    if (!cursor) break;
  }

  return entries;
}

async function fetchDockerRegistry(options: FetchOptions = {}): Promise<RegistryEntry[]> {
  const sourceInfo = BUILTIN_REGISTRY_SOURCES.find((source) => source.id === "docker")!;
  const limit = Math.min(options.limit ?? 100, 500);
  const response = await fetchWithRetry(DOCKER_TREE_URL, { headers: { "Accept": "application/vnd.github+json" } }, options, "Docker registry request");
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
  const entries = await mapConcurrent(serverPaths, concurrency, async (entryPath) => {
    const raw = await fetchText(`${DOCKER_RAW_BASE}/${entryPath}`, options);
    const entry = dockerYamlToEntry(raw, entryPath);
    return entry ? tagRegistryEntry(entry, sourceInfo) : null;
  });

  return entries.filter((entry): entry is RegistryEntry => Boolean(entry));
}

async function fetchHttpJsonRegistry(url: string, sourceInfo: RegistrySourceInfo, options: FetchOptions = {}): Promise<RegistryEntry[]> {
  const response = await fetchWithRetry(url, {}, options, `${sourceInfo.label} registry request`);
  if (!response.ok) {
    throw new Error(`${sourceInfo.label} registry request failed: ${response.status} ${response.statusText}`);
  }

  const body = await responseJson(response, `${sourceInfo.label} registry response`);
  const rawEntries = extractHttpJsonEntries(body);
  if (!rawEntries) {
    throw new Error(`Registry schema drift: expected ${sourceInfo.id} response to include a servers or entries array.`);
  }
  return rawEntries.map((entry) => tagRegistryEntry(entry, sourceInfo));
}

async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const response = await fetchWithRetry(url, {}, options, "Request");
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
  return fetch(url, init) as unknown as FetchLikeResponse;
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

function dockerYamlToEntry(raw: string, entryPath: string): RegistryEntry | null {
  const parsed = parseYaml(raw) as Record<string, any> | null;
  if (!parsed?.name) return null;

  const name = String(parsed.name);
  const title = String(parsed.about?.title ?? name);
  const description = String(parsed.about?.description ?? "");
  const version = String(parsed.source?.commit ?? parsed.source?.branch ?? "docker-catalog");
  const repositoryUrl = typeof parsed.source?.project === "string" ? parsed.source.project : "https://github.com/docker/mcp-registry";
  const envVars = Array.isArray(parsed.config?.secrets)
    ? parsed.config.secrets.map((secret: any) => ({
        name: String(secret.env ?? secret.name ?? "SECRET"),
        description: typeof secret.description === "string" ? secret.description : undefined,
        isRequired: true,
        isSecret: true,
      }))
    : [];

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
        category: parsed.meta?.category,
        tags: parsed.meta?.tags,
      },
    },
  };

  if (parsed.type === "remote" && parsed.remote?.url) {
    server.remotes = [{
      type: parsed.remote.transport_type ?? "streamable-http",
      url: String(parsed.remote.url),
      headers: Object.keys(parsed.remote.headers ?? {}).map((header) => {
        const value = String(parsed.remote.headers[header]);
        return {
          name: header,
          value,
          env: extractEnvName(value),
          isRequired: true,
          isSecret: value.includes("${"),
        };
      }),
    }];
  } else if (parsed.image) {
    server.packages = [{
      registryType: "oci",
      identifier: String(parsed.image),
      transport: { type: "stdio" },
      runtimeHint: "docker",
      environmentVariables: envVars,
    }];
  }

  return {
    server,
    _meta: {
      "dev.toolpin/source": {
        source: "docker",
        path: entryPath,
        curated: true,
      },
    },
  };
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
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2),
    "utf8",
  );
}

export async function readCache(cachePath = DEFAULT_CACHE_PATH): Promise<RegistryEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(cachePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CacheSchemaError(`Invalid registry cache JSON in ${cachePath}: ${error.message}`);
    }
    throw error;
  }
  if (!isCacheFile(parsed)) {
    throw new CacheSchemaError(`Invalid registry cache schema in ${cachePath}: expected an object with an entries array.`);
  }
  return parsed.entries;
}

export class CacheSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheSchemaError";
  }
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
  const installable = registryMode === "installable" && hasInstallTarget;

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
        ? "registry source is discovery-only"
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isCacheFile(value: unknown): value is { entries: RegistryEntry[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every((entry) => (
      isRecord(entry) &&
      isRecord(entry.server) &&
      typeof entry.server.name === "string" &&
      typeof entry.server.version === "string"
    ))
  );
}

function isRegistryConfig(value: unknown): value is RegistryConfig {
  return (
    isRecord(value) &&
    Array.isArray(value.registries) &&
    value.registries.every((entry) => (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      entry.id.length > 0 &&
      typeof entry.url === "string" &&
      entry.url.length > 0 &&
      (entry.type === undefined || ["official-compatible", "http-json"].includes(String(entry.type))) &&
      (entry.mode === undefined || entry.mode === "installable" || entry.mode === "discovery") &&
      (entry.enabled === undefined || typeof entry.enabled === "boolean")
    ))
  );
}

function extractHttpJsonEntries(body: unknown): Array<RegistryEntry | { server: RegistryServer }> | undefined {
  const value = isRecord(body) ? body.servers ?? body.entries : undefined;
  if (!Array.isArray(value)) return undefined;
  const entries: Array<RegistryEntry | { server: RegistryServer }> = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (isRecord(item.server) && typeof item.server.name === "string" && typeof item.server.version === "string") {
      entries.push(item as unknown as RegistryEntry);
    } else if (typeof item.name === "string" && typeof item.version === "string") {
      entries.push({ server: item as unknown as RegistryServer });
    }
  }
  return entries;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
