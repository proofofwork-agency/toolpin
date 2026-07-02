import type { ClientName } from "./config.js";
import type { NormalizedServer } from "./types.js";
import { isRecord } from "./util.js";

export const TOOLPIN_CLIENT_SUPPORT_META = "dev.toolpin/clientSupport";

export type ToolPinClientSupportStatus = "toolpin-installable" | "external-setup" | "unsupported";

export interface ToolPinClientSupportEntry {
  status: ToolPinClientSupportStatus;
  installMode?: string;
  requirements?: string[];
  setupCommands?: string[];
  notes?: string;
}

export interface ToolPinClientSupportBlock {
  default: ToolPinClientSupportStatus;
  clients: Record<string, ToolPinClientSupportEntry>;
}

export interface ToolPinClientSkip {
  client: ClientName;
  status: Exclude<ToolPinClientSupportStatus, "toolpin-installable">;
  reason: string;
}

export function clientSupportBlock(server: NormalizedServer): ToolPinClientSupportBlock | undefined {
  const value = server.raw._meta?.[TOOLPIN_CLIENT_SUPPORT_META] ?? server.registryMeta?.[TOOLPIN_CLIENT_SUPPORT_META];
  if (!isRecord(value)) return undefined;
  const defaultStatus = statusValue(value.default);
  if (!defaultStatus) return undefined;
  const clientsValue = isRecord(value.clients) ? value.clients : {};
  const clients: Record<string, ToolPinClientSupportEntry> = {};
  for (const [client, entry] of Object.entries(clientsValue)) {
    if (!isRecord(entry)) continue;
    const status = statusValue(entry.status);
    if (!status) continue;
    clients[client] = {
      status,
      installMode: typeof entry.installMode === "string" ? entry.installMode : undefined,
      requirements: stringArray(entry.requirements),
      setupCommands: stringArray(entry.setupCommands),
      notes: typeof entry.notes === "string" ? entry.notes : undefined,
    };
  }
  return { default: defaultStatus, clients };
}

export function clientSupportFor(server: NormalizedServer, client: ClientName): ToolPinClientSupportEntry | undefined {
  const support = clientSupportBlock(server);
  if (!support) return undefined;
  return support.clients[client] ?? { status: support.default };
}

export function assertToolPinInstallableForClient(server: NormalizedServer, client: ClientName): void {
  const support = clientSupportFor(server, client);
  if (!support || support.status === "toolpin-installable") return;
  throw new Error(clientSupportSkipReason(server, client, support));
}

export function installableClientsForServer(
  server: NormalizedServer,
  clients: ClientName[],
): { clients: ClientName[]; skipped: ToolPinClientSkip[] } {
  const installable: ClientName[] = [];
  const skipped: ToolPinClientSkip[] = [];
  for (const client of clients) {
    const support = clientSupportFor(server, client);
    if (!support || support.status === "toolpin-installable") {
      installable.push(client);
      continue;
    }
    skipped.push({
      client,
      status: support.status,
      reason: clientSupportSkipReason(server, client, support),
    });
  }
  return { clients: installable, skipped };
}

export function clientSupportSkipReason(server: NormalizedServer, client: ClientName, support = clientSupportFor(server, client)): string {
  if (!support || support.status === "toolpin-installable") return `${server.name}@${server.version} is ToolPin-installable for ${client}.`;
  if (support.status === "external-setup") {
    const commands = support.setupCommands?.length ? ` Setup: ${support.setupCommands.join("; ")}` : "";
    const notes = support.notes ? ` ${support.notes}` : "";
    return `${server.name}@${server.version} supports ${client} through external setup, not ToolPin direct install.${notes}${commands}`;
  }
  return `${server.name}@${server.version} is not supported for ${client} by this ToolPin curated entry.`;
}

function statusValue(value: unknown): ToolPinClientSupportStatus | undefined {
  return value === "toolpin-installable" || value === "external-setup" || value === "unsupported" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
