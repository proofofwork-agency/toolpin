import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>;

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: Set<string>;
  allowHttp?: boolean;
  allowPrivateHosts?: boolean;
  fetch?: typeof fetch;
  lookup?: Lookup;
}

export interface UrlSafetyOptions {
  allowedHosts?: Set<string>;
  allowHttp?: boolean;
  allowPrivateHosts?: boolean;
  lookup?: Lookup;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const url = new URL(input);
  await assertSafeUrl(url, {
    allowedHosts: options.allowedHosts,
    allowHttp: options.allowHttp,
    allowPrivateHosts: options.allowPrivateHosts,
    lookup: options.lookup,
  });
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes: _maxBytes,
    allowedHosts: _allowedHosts,
    allowHttp: _allowHttp,
    allowPrivateHosts: _allowPrivateHosts,
    fetch: fetchImpl = fetch,
    lookup: _lookup,
    ...fetchOptions
  } = options;
  return fetchImpl(url, {
    ...fetchOptions,
    redirect: "error",
    signal: fetchOptions.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

export async function safeFetchBuffer(input: string | URL, options: SafeFetchOptions = {}): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const response = await safeFetch(input, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return readResponseCapped(response, maxBytes);
}

export async function safeFetchJson<T>(input: string | URL, options: SafeFetchOptions = {}): Promise<T> {
  const bytes = await safeFetchBuffer(input, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  return JSON.parse(bytes.toString("utf8")) as T;
}

// KNOWN LIMITATION (DNS rebinding / TOCTOU): this validates the addresses the
// hostname resolves to *now*, but the subsequent fetch()/transport resolves the
// hostname again independently. A hostname whose DNS answer flips from a public
// address (passes here) to a private/metadata address (used by the real
// connection) can still be reached. Closing this fully requires pinning the
// resolved address into the connection (e.g. an undici dispatcher or node:https
// Agent with a `lookup` that returns the vetted IP) for every caller. This
// preflight still blocks the common cases (literal private IPs, non-HTTPS,
// static private DNS) and is a strict improvement over an unguarded fetch.
export async function assertSafeUrl(url: URL, options: UrlSafetyOptions = {}): Promise<void> {
  const { allowedHosts, allowHttp = false, allowPrivateHosts = false, lookup: lookupImpl = lookup } = options;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error(`Refusing non-HTTPS URL: ${url.href}`);
  }
  const hostname = normalizeHostname(url.hostname);
  if (allowedHosts && !allowedHosts.has(hostname)) {
    throw new Error(`Refusing untrusted host ${hostname}`);
  }
  if (!allowPrivateHosts) await assertPublicHostname(hostname, lookupImpl);
}

async function assertPublicHostname(hostname: string, lookupImpl: Lookup): Promise<void> {
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error(`Refusing private or reserved IP address ${hostname}`);
    return;
  }

  const addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  for (const address of addresses) {
    if (isBlockedIp(address.address)) {
      throw new Error(`Refusing private or reserved IP address ${address.address} for ${hostname}`);
    }
  }
}

export async function readResponseTextCapped(response: Response, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  return (await readResponseCapped(response, maxBytes)).toString("utf8");
}

async function readResponseCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeded ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const family = isIP(host);
  if (family === 4) return host === "127" || host.startsWith("127.");
  if (family === 6) return host === "::1" || host === "0:0:0:0:0:0:0:1";
  return false;
}

function isBlockedIp(address: string): boolean {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mappedIpv4 = lower.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4[1]);
  const groups = parseIpv6Groups(lower);
  if (groups) {
    const embeddedIpv4 = ipv4FromEmbeddedIpv6(groups);
    if (embeddedIpv4 && isBlockedIpv4(embeddedIpv4)) return true;
  }
  return lower === "::"
    || lower === "::1"
    || lower.startsWith("fc")
    || lower.startsWith("fd")
    || lower.startsWith("fe8")
    || lower.startsWith("fe9")
    || lower.startsWith("fea")
    || lower.startsWith("feb")
    || lower.startsWith("ff");
}

function parseIpv6Groups(address: string): number[] | undefined {
  const withoutZone = address.split("%", 1)[0];
  const [headRaw, tailRaw, extra] = withoutZone.split("::");
  if (extra !== undefined) return undefined;
  const head = headRaw ? headRaw.split(":") : [];
  const tail = tailRaw ? tailRaw.split(":") : [];
  if (!withoutZone.includes("::") && head.length !== 8) return undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return undefined;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  if (groups.length !== 8) return undefined;
  const parsed = groups.map((part) => Number.parseInt(part, 16));
  if (parsed.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return undefined;
  return parsed;
}

function ipv4FromEmbeddedIpv6(groups: number[]): string | undefined {
  const firstFiveZero = groups.slice(0, 5).every((group) => group === 0);
  const compatible = firstFiveZero && groups[5] === 0;
  const mapped = firstFiveZero && groups[5] === 0xffff;
  if (!compatible && !mapped) return undefined;
  const high = groups[6];
  const low = groups[7];
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
}
