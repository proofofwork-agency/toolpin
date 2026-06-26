const TRUSTED_OCI_REGISTRIES = new Set([
  "docker.io",
  "registry-1.docker.io",
  "ghcr.io",
  "gcr.io",
  "mcr.microsoft.com",
  "public.ecr.aws",
  "registry.k8s.io",
  "quay.io",
]);

const TRUSTED_AUTH_HOSTS: Record<string, string[]> = {
  "docker.io": ["auth.docker.io", "docker.io", "registry-1.docker.io"],
  "registry-1.docker.io": ["auth.docker.io", "docker.io", "registry-1.docker.io"],
  "ghcr.io": ["ghcr.io"],
  "gcr.io": ["gcr.io"],
  "mcr.microsoft.com": ["mcr.microsoft.com"],
  "public.ecr.aws": ["public.ecr.aws"],
  "registry.k8s.io": ["registry.k8s.io"],
  "quay.io": ["quay.io"],
};

export const TRUSTED_MCPB_SOURCES = new Set([
  "registry.modelcontextprotocol.io",
  "modelcontextprotocol.io",
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "raw.githubusercontent.com",
]);

export const TRUSTED_NPM_PACKUMENT_HOSTS = new Set([
  "registry.npmjs.org",
]);

export const TRUSTED_NPM_TARBALL_HOSTS = new Set([
  "registry.npmjs.org",
]);

export interface CanonicalOciRef {
  host: string;
  repository: string;
  digest: string;
}

export function canonicalizeOciRef(identifier: string): CanonicalOciRef | undefined {
  const digestMatch = identifier.match(/@sha256:([a-fA-F0-9]{64})$/);
  if (!digestMatch) return undefined;

  const image = identifier.slice(0, digestMatch.index);
  if (!image || image.includes("://")) return undefined;

  const parts = image.split("/").filter(Boolean);
  if (!parts.length) return undefined;

  let host: string;
  let repositoryParts: string[];
  if (isExplicitRegistry(parts[0])) {
    host = normalizeDockerHubHost(parts[0].toLowerCase());
    repositoryParts = parts.slice(1);
  } else {
    host = "docker.io";
    repositoryParts = parts;
  }

  if (!repositoryParts.length) return undefined;
  if (host === "docker.io" && repositoryParts.length === 1) {
    repositoryParts = ["library", repositoryParts[0]];
  }

  const repository = repositoryParts.join("/");
  if (!repository || repository.includes("@") || repository.includes(":")) return undefined;

  return {
    host,
    repository,
    digest: `sha256:${digestMatch[1].toLowerCase()}`,
  };
}

export function trustedOciRegistry(ref: CanonicalOciRef | string): boolean {
  const host = typeof ref === "string" ? normalizeDockerHubHost(ref.toLowerCase()) : ref.host;
  return TRUSTED_OCI_REGISTRIES.has(host) || host === "docker.io";
}

export function trustedOciAuthHosts(host: string): Set<string> {
  const normalized = normalizeDockerHubHost(host.toLowerCase());
  return new Set(TRUSTED_AUTH_HOSTS[normalized] ?? [normalized]);
}

export function trustedMcpbSourceHost(url: string | URL): string | undefined {
  return trustedHttpsHost(url, TRUSTED_MCPB_SOURCES);
}

export function trustedNpmPackumentHost(url: string | URL): string | undefined {
  return trustedHttpsHost(url, TRUSTED_NPM_PACKUMENT_HOSTS);
}

export function trustedNpmTarballHost(url: string | URL): string | undefined {
  return trustedHttpsHost(url, TRUSTED_NPM_TARBALL_HOSTS);
}

function isExplicitRegistry(firstPart: string): boolean {
  return firstPart === "localhost" || firstPart.includes(".") || firstPart.includes(":");
}

function normalizeDockerHubHost(host: string): string {
  return host === "registry-1.docker.io" ? "docker.io" : host;
}

function trustedHttpsHost(url: string | URL, trustedHosts: Set<string>): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || !trustedHosts.has(host)) return undefined;
    return host;
  } catch {
    return undefined;
  }
}
