import type { NormalizedServer } from "./types.js";

export interface KnownVersion {
  version: string;
  source: NormalizedServer["registrySource"];
  isLatest: boolean;
}

export type VersionStatus = "current" | "update-available" | "ahead-of-registry" | "unknown";

export interface VersionComparison {
  name: string;
  lockedVersion?: string;
  latestVersion?: string;
  status: VersionStatus;
  previousVersions: KnownVersion[];
}

export function knownVersions(servers: NormalizedServer[], name: string): KnownVersion[] {
  const byVersion = new Map<string, KnownVersion>();
  for (const server of servers) {
    if (server.name !== name) continue;
    const existing = byVersion.get(server.version);
    if (!existing || server.isLatest) {
      byVersion.set(server.version, {
        version: server.version,
        source: server.registrySource,
        isLatest: server.isLatest,
      });
    }
  }
  const sorted = [...byVersion.values()].sort((left, right) => compareVersionish(right.version, left.version));
  return sorted.map((entry, index) => ({ ...entry, isLatest: entry.isLatest || index === 0 }));
}

export function latestKnownVersion(servers: NormalizedServer[], name: string): KnownVersion | undefined {
  return knownVersions(servers, name)[0];
}

export function compareLockedToLatest(name: string, lockedVersion: string | undefined, servers: NormalizedServer[]): VersionComparison {
  const versions = knownVersions(servers, name);
  const latest = versions[0];
  if (!lockedVersion || !latest) {
    return {
      name,
      lockedVersion,
      latestVersion: latest?.version,
      status: "unknown",
      previousVersions: versions.slice(1),
    };
  }

  const delta = compareVersionish(latest.version, lockedVersion);
  return {
    name,
    lockedVersion,
    latestVersion: latest.version,
    status: delta > 0 ? "update-available" : delta < 0 ? "ahead-of-registry" : "current",
    previousVersions: versions.filter((entry) => entry.version !== latest.version),
  };
}

export function compareVersionish(a: string, b: string): number {
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
