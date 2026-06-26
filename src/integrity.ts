const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const OCI_SHA256_DIGEST_PATTERN = /@sha256:([a-f0-9]{64})$/i;

export function ociDigestPin(identifier: string): string | undefined {
  return OCI_SHA256_DIGEST_PATTERN.exec(identifier)?.[1];
}

export function hasValidOciDigestPin(identifier: string): boolean {
  return ociDigestPin(identifier) !== undefined;
}

export function hasOciDigestMarker(identifier: string): boolean {
  return identifier.includes("@sha256:");
}

export function isValidSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}
