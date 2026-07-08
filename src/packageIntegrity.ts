import { createHash } from "node:crypto";
import { safeFetchBuffer, safeFetchJson, type SafeFetchOptions } from "./safeFetch.js";
import { TRUSTED_NPM_PACKUMENT_HOSTS, TRUSTED_NPM_TARBALL_HOSTS, trustedNpmPackumentHost, trustedNpmTarballHost } from "./verificationTrust.js";
import { isFloatingVersion } from "./util.js";

export interface NpmPackageTarget {
  identifier: string;
  version?: string;
}

export interface PackageIntegrityOptions {
  fetch?: SafeFetchOptions["fetch"];
  lookup?: SafeFetchOptions["lookup"];
  timeoutMs?: number;
  maxBytes?: number;
}

export type PackageIntegrityResult = {
  status: "passed" | "failed" | "unavailable";
  expected?: string;
  actual?: string;
  source: string;
  reason?: string;
  issueCode?: string;
  trustedAnchor: boolean;
  trustAnchor?: string;
  tarballUrl?: string;
};

interface NpmPackument {
  versions?: Record<string, {
    dist?: {
      integrity?: string;
      tarball?: string;
    };
  }>;
}

const NPM_PACKUMENT_HOST = "registry.npmjs.org";
const DEFAULT_TARBALL_MAX_BYTES = 128 * 1024 * 1024;

export async function verifyNpmPackageIntegrity(
  target: NpmPackageTarget,
  options: PackageIntegrityOptions = {},
): Promise<PackageIntegrityResult> {
  if (!target.version || isFloatingVersion(target.version)) {
    return {
      status: "failed",
      source: "npm-registry",
      reason: "npm package target must declare an exact version",
      issueCode: "npm_version_missing",
      trustedAnchor: true,
      trustAnchor: NPM_PACKUMENT_HOST,
    };
  }

  const packumentUrl = npmPackumentUrl(target.identifier);
  const packumentHost = trustedNpmPackumentHost(packumentUrl);
  if (!packumentHost) {
    return {
      status: "failed",
      source: "npm-registry",
      reason: "npm packument host is not a ToolPin trusted anchor",
      issueCode: "npm_packument_untrusted",
      trustedAnchor: false,
    };
  }

  let packument: NpmPackument;
  try {
    packument = await safeFetchJson<NpmPackument>(packumentUrl, {
      allowedHosts: TRUSTED_NPM_PACKUMENT_HOSTS,
      fetch: options.fetch,
      lookup: options.lookup,
      timeoutMs: options.timeoutMs,
      maxBytes: 4 * 1024 * 1024,
    });
  } catch (error) {
    return {
      status: "unavailable",
      source: "npm-registry",
      reason: error instanceof Error ? error.message : String(error),
      trustedAnchor: true,
      trustAnchor: packumentHost,
    };
  }

  const version = packument.versions?.[target.version];
  if (!version) {
    return {
      status: "failed",
      source: "npm-registry",
      reason: `npm packument does not contain version ${target.version}`,
      issueCode: "npm_version_missing",
      trustedAnchor: true,
      trustAnchor: packumentHost,
    };
  }

  const integrity = version.dist?.integrity;
  if (!integrity) {
    return {
      status: "failed",
      source: "npm-registry",
      reason: `npm packument version ${target.version} does not declare dist.integrity`,
      issueCode: "npm_integrity_missing",
      trustedAnchor: true,
      trustAnchor: packumentHost,
    };
  }

  const expected = sha512FromSri(integrity);
  if (!expected) {
    return {
      status: "failed",
      source: "npm-registry",
      expected: integrity,
      reason: "npm dist.integrity does not include a sha512 Subresource Integrity value",
      issueCode: "npm_integrity_missing",
      trustedAnchor: true,
      trustAnchor: packumentHost,
    };
  }

  const tarballUrl = version.dist?.tarball;
  const tarballHost = tarballUrl ? trustedNpmTarballHost(tarballUrl) : undefined;
  if (!tarballUrl || !tarballHost) {
    return {
      status: "failed",
      source: "npm-tarball",
      expected: integrity,
      tarballUrl,
      reason: tarballUrl ? "npm tarball host is not a ToolPin trusted anchor" : "npm packument version does not declare dist.tarball",
      issueCode: "npm_tarball_untrusted",
      trustedAnchor: false,
      trustAnchor: tarballUrl ? undefined : packumentHost,
    };
  }

  let bytes: Buffer;
  try {
    bytes = await safeFetchBuffer(tarballUrl, {
      allowedHosts: TRUSTED_NPM_TARBALL_HOSTS,
      fetch: options.fetch,
      lookup: options.lookup,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes ?? DEFAULT_TARBALL_MAX_BYTES,
    });
  } catch (error) {
    return {
      status: "unavailable",
      source: "npm-tarball",
      expected: integrity,
      tarballUrl,
      reason: error instanceof Error ? error.message : String(error),
      trustedAnchor: true,
      trustAnchor: tarballHost,
    };
  }

  const actual = createHash("sha512").update(bytes).digest("base64");
  if (actual !== expected) {
    return {
      status: "failed",
      source: "npm-tarball",
      expected: integrity,
      actual: `sha512-${actual}`,
      tarballUrl,
      reason: "npm tarball bytes do not match dist.integrity",
      issueCode: "npm_integrity_mismatch",
      trustedAnchor: true,
      trustAnchor: tarballHost,
    };
  }

  return {
    status: "passed",
    source: "npm-tarball",
    expected: integrity,
    actual: `sha512-${actual}`,
    tarballUrl,
    trustedAnchor: true,
    trustAnchor: tarballHost,
  };
}

function npmPackumentUrl(name: string): string {
  return `https://${NPM_PACKUMENT_HOST}/${encodeURIComponent(name)}`;
}

function sha512FromSri(integrity: string): string | undefined {
  for (const part of integrity.trim().split(/\s+/)) {
    const match = part.match(/^sha512-([A-Za-z0-9+/=]+)$/);
    if (match) return match[1];
  }
  return undefined;
}
