import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { NormalizedServer, RegistryEntry, RegistryListResponse, RegistryServer, RegistrySourceId, RegistrySourceInfo } from "./types.js";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0";
const DEFAULT_CACHE_PATH = path.join(process.cwd(), ".mpm", "registry-cache.json");
const DOCKER_TREE_URL = "https://api.github.com/repos/docker/mcp-registry/git/trees/main?recursive=1";
const DOCKER_RAW_BASE = "https://raw.githubusercontent.com/docker/mcp-registry/main";

export const REGISTRY_SOURCES: RegistrySourceInfo[] = [
  {
    id: "official",
    label: "Official MCP Registry",
    trust: "canonical",
    enabled: true,
    authRequired: false,
    description: "Canonical public MCP server metadata registry.",
  },
  {
    id: "docker",
    label: "Docker MCP Catalog",
    trust: "curated",
    enabled: true,
    authRequired: false,
    description: "Curated Docker MCP catalog with reviewed container/remote entries.",
  },
  {
    id: "pulse",
    label: "PulseMCP",
    trust: "directory",
    enabled: false,
    authRequired: true,
    description: "Enriched sub-registry API; requires PulseMCP API key and tenant.",
  },
  {
    id: "smithery",
    label: "Smithery",
    trust: "directory",
    enabled: false,
    authRequired: true,
    description: "Hosted registry/search API; requires Smithery API key.",
  },
  {
    id: "glama",
    label: "Glama",
    trust: "directory",
    enabled: false,
    authRequired: false,
    description: "Large public directory with rich scans; no stable public adapter enabled yet.",
  },
];

export interface FetchOptions {
  registryUrl?: string;
  limit?: number;
  maxPages?: number;
  search?: string;
  source?: RegistrySourceId | "all";
}

export async function fetchRegistry(options: FetchOptions = {}): Promise<RegistryEntry[]> {
  const source = options.source ?? "official";
  if (source === "all") {
    const [official, docker] = await Promise.all([
      fetchOfficialRegistry(options),
      fetchDockerRegistry(options),
    ]);
    return [...official, ...docker];
  }
  if (source === "docker") return fetchDockerRegistry(options);
  if (source !== "official") {
    const info = REGISTRY_SOURCES.find((candidate) => candidate.id === source);
    throw new Error(`${info?.label ?? source} is known but no unauthenticated adapter is enabled yet.`);
  }
  return fetchOfficialRegistry(options);
}

async function fetchOfficialRegistry(options: FetchOptions = {}): Promise<RegistryEntry[]> {
  const registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL;
  const limit = Math.min(options.limit ?? 100, 100);
  const maxPages = options.maxPages ?? 5;
  const entries: RegistryEntry[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${registryUrl.replace(/\/$/, "")}/servers`);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    if (options.search) url.searchParams.set("search", options.search);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as RegistryListResponse;
    entries.push(...(body.servers ?? []).map((entry) => ({ ...entry, source: "official" as const })));

    cursor = body.metadata?.nextCursor;
    if (!cursor) break;
  }

  return entries;
}

async function fetchDockerRegistry(options: FetchOptions = {}): Promise<RegistryEntry[]> {
  const limit = Math.min(options.limit ?? 100, 500);
  const response = await fetch(DOCKER_TREE_URL, { headers: { "Accept": "application/vnd.github+json" } });
  if (!response.ok) {
    throw new Error(`Docker registry request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as { tree?: Array<{ path: string; type: string }> };
  const fetchCount = options.search ? 500 : limit;
  const serverPaths = (body.tree ?? [])
    .map((entry) => entry.path)
    .filter((entryPath) => /^servers\/[^/]+\/server\.yaml$/.test(entryPath))
    .slice(0, fetchCount);

  const entries = await Promise.all(serverPaths.map(async (entryPath) => {
    const raw = await fetchText(`${DOCKER_RAW_BASE}/${entryPath}`);
    return dockerYamlToEntry(raw, entryPath);
  }));

  return entries.filter((entry): entry is RegistryEntry => Boolean(entry));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${url}`);
  }
  return response.text();
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
      "dev.mpm/source": {
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
    source: "docker",
    _meta: {
      "dev.mpm/source": {
        source: "docker",
        path: entryPath,
        curated: true,
      },
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
  const raw = await readFile(cachePath, "utf8");
  const parsed = JSON.parse(raw) as { entries?: RegistryEntry[] };
  return parsed.entries ?? [];
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

  return {
    registrySource: entry.source ?? detectSource(entry),
    name: server.name,
    title: server.title ?? server.name,
    description: server.description ?? "",
    version: server.version,
    isLatest: officialMeta?.isLatest === true,
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
  const sourceMeta = entry._meta?.["dev.mpm/source"];
  if (sourceMeta && typeof sourceMeta === "object" && (sourceMeta as { source?: unknown }).source === "docker") {
    return "docker";
  }
  return "official";
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

function compareVersionish(a: string, b: string): number {
  const parse = (version: string) =>
    version
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
