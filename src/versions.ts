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
  const sorted = [...byVersion.values()].sort(compareKnownVersions);
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

  const delta = compareSemver(latest.version, lockedVersion);
  return {
    name,
    lockedVersion,
    latestVersion: latest.version,
    status: delta === undefined
      ? "unknown"
      : delta > 0
        ? "update-available"
        : delta < 0
          ? "ahead-of-registry"
          : "current",
    previousVersions: versions.filter((entry) => entry.version !== latest.version),
  };
}

export function compareVersionish(a: string, b: string): number {
  return compareSemver(a, b) ?? 0;
}

export function compareVersionStatus(a: string, b: string): number | undefined {
  return compareSemver(a, b);
}

function compareKnownVersions(left: KnownVersion, right: KnownVersion): number {
  const semverDelta = compareSemver(right.version, left.version);
  if (semverDelta !== undefined && semverDelta !== 0) return semverDelta;
  if (left.isLatest !== right.isLatest) return left.isLatest ? -1 : 1;
  return 0;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_PATTERN = new RegExp(
  "^v?"
    + "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)"
    + "(?:-((?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    + "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?"
    + "$",
);

function compareSemver(a: string, b: string): number | undefined {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return undefined;

  const versionDelta =
    compareNumbers(left.major, right.major)
    || compareNumbers(left.minor, right.minor)
    || compareNumbers(left.patch, right.patch);
  if (versionDelta !== 0) return versionDelta;

  return comparePrerelease(left.prerelease, right.prerelease);
}

function parseSemver(version: string): ParsedSemver | undefined {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const leftIdentifier = left[i];
    const rightIdentifier = right[i];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const identifierDelta = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (identifierDelta !== 0) return identifierDelta;
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = isNumericIdentifier(left);
  const rightNumeric = isNumericIdentifier(right);
  if (leftNumeric && rightNumeric) return compareNumbers(Number.parseInt(left, 10), Number.parseInt(right, 10));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left === right ? 0 : left > right ? 1 : -1;
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left > right ? 1 : -1;
}

function isNumericIdentifier(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}
