import net from "node:net";
import { readInstalledServerConfig } from "./doctor.js";
import { resolveConfigTarget, type InstallScope } from "./install.js";
import type { ClientName } from "./config.js";

export interface LocalHttpRuntimeAdvisory {
  url: string;
  host: string;
  port: number;
  running: boolean;
  message: string;
}

export async function localHttpRuntimeAdvisory(
  serverName: string,
  client: ClientName,
  scope: InstallScope,
): Promise<LocalHttpRuntimeAdvisory | undefined> {
  const target = resolveConfigTarget(client, scope);
  const installed = await readInstalledServerConfig(target.file, serverName, client);
  if (installed.kind !== "ok") return undefined;

  const endpoint = localHttpEndpoint(installed.config);
  if (!endpoint) return undefined;

  const running = await isTcpPortOpen(endpoint.host, endpoint.port);
  return {
    ...endpoint,
    running,
    message: running
      ? `local HTTP endpoint ${endpoint.url} is accepting connections; delete removes config/lock only and does not stop that process.`
      : `local HTTP endpoint ${endpoint.url} is configured, but port ${endpoint.port} is not accepting connections right now.`,
  };
}

export function localHttpEndpoint(config: unknown): { url: string; host: string; port: number } | undefined {
  const record = asRecord(config);
  const raw = firstString(record.url, record.httpUrl, record.serverUrl);
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!url.port) return undefined;

  const host = normalizeHost(url.hostname);
  if (!isLoopbackHost(host)) return undefined;

  const port = Number.parseInt(url.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { url: raw, host, port };
}

async function isTcpPortOpen(host: string, port: number, timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: connectHost(host), port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

function connectHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, "");
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
