import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>;
type UndiciFetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

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

// Connect-time DNS pinning. undici resolves hostnames through this lookup when
// it builds the socket, so the addresses vetted here are exactly the addresses
// the connection uses. A hostname whose DNS answer flips between the preflight
// check and the connection (DNS rebinding) is re-validated here and refused.
function makePinnedLookup(lookupImpl: Lookup, allowPrivateHosts: boolean): LookupFunction {
  return (hostname, options, callback) => {
    lookupImpl(hostname, { all: true, verbatim: true })
      .then((addresses) => {
        const usable = addresses.filter((entry) => isIP(entry.address) !== 0);
        const vetted = allowPrivateHosts ? usable : usable.filter((entry) => !isBlockedIp(entry.address));
        if (vetted.length === 0) {
          callback(new Error(`Refusing private or reserved IP address for ${hostname} at connect time`), []);
          return;
        }
        const results = vetted.map((entry) => ({ address: entry.address, family: isIP(entry.address) }));
        if (options.all) {
          callback(null, results);
        } else {
          callback(null, results[0].address, results[0].family);
        }
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), []);
      });
  };
}

const pinnedAgents = new Map<string, Agent>();

function pinnedDispatcher(allowPrivateHosts: boolean, lookupImpl: Lookup): Agent {
  const connect = { lookup: makePinnedLookup(lookupImpl, allowPrivateHosts) };
  if (lookupImpl !== lookup) {
    // An injected lookup is a test seam; keep those agents from holding idle
    // keep-alive sockets open across the test process.
    return new Agent({ connect, keepAliveTimeout: 10, keepAliveMaxTimeout: 10 });
  }
  const key = allowPrivateHosts ? "allow-private" : "strict";
  const existing = pinnedAgents.get(key);
  if (existing) return existing;
  const agent = new Agent({ connect });
  pinnedAgents.set(key, agent);
  return agent;
}

function pinnedUndiciFetch(input: string | URL, init: RequestInit, dispatcher: Agent): Promise<Response> {
  const undiciInit = { ...init, dispatcher } as UndiciFetchInit;
  return undiciFetch(input, undiciInit) as unknown as Promise<Response>;
}

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
    allowPrivateHosts = false,
    fetch: fetchImpl,
    lookup: lookupImpl = lookup,
    ...fetchOptions
  } = options;
  const init = {
    ...fetchOptions,
    redirect: "error" as const,
    signal: fetchOptions.signal ?? AbortSignal.timeout(timeoutMs),
  };
  // An injected fetch is a test seam and cannot carry an undici dispatcher.
  if (fetchImpl) return fetchImpl(url, init);
  return pinnedUndiciFetch(url, init, pinnedDispatcher(allowPrivateHosts, lookupImpl));
}

// Internal seam used only by tests to reach a local fixture; production callers
// (tester.ts) invoke pinnedFetch as a bare FetchLike and never set these.
export interface PinnedFetchInternalOptions {
  lookup?: Lookup;
  allowPrivateHosts?: boolean;
  allowHttp?: boolean;
}

// Fetch for MCP remote-probe transports: preflights every request URL and pins
// the connection to the vetted addresses. Loopback probe targets keep the
// platform fetch (they are intentional local fixtures) — the caller makes that
// choice per URL (see tester.ts).
//
// redirect:"error" is load-bearing, not cosmetic: undici does NOT run the
// connect-time lookup hook for IP-literal hosts, so a public endpoint that
// answers 3xx with `Location: http://169.254.169.254/...` (or any private IP
// literal) would otherwise be followed straight past the pin. Refusing
// redirects — exactly as safeFetch does — closes that hop; a probe target must
// be a stable final URL. If redirect support is ever needed, it must
// re-run assertSafeUrl on every hop before connecting.
export async function pinnedFetch(input: string | URL, init?: RequestInit, internal: PinnedFetchInternalOptions = {}): Promise<Response> {
  const url = new URL(input);
  const lookupImpl = internal.lookup ?? lookup;
  const allowPrivateHosts = internal.allowPrivateHosts ?? false;
  await assertSafeUrl(url, { allowHttp: internal.allowHttp, allowPrivateHosts, lookup: lookupImpl });
  return pinnedUndiciFetch(url, { ...(init ?? {}), redirect: "error" }, pinnedDispatcher(allowPrivateHosts, lookupImpl));
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

// Layer 1 of the two-layer SSRF guard: validate the scheme, the optional host
// allowlist, and the addresses the hostname resolves to at check time. Layer 2
// lives in safeFetch/pinnedFetch: the undici dispatcher's connect-time lookup
// (makePinnedLookup) re-validates every resolved address when the socket is
// built, so the connection only ever receives vetted IPs. Layer 2 is what
// closes DNS rebinding — a hostname whose answer flips to a private/metadata
// address between this check and the connection is refused at connect time.
// Callers that inject a custom fetch (test seams) bypass layer 2.
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
