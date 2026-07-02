import { parseDocument, stringify } from "yaml";
import { isRecord } from "./util.js";

const DEFAULT_CONTINUE_CONFIG = {
  name: "ToolPin Config",
  version: "1.0.0",
  schema: "v1",
  mcpServers: [] as unknown[],
};

export function continueYamlFromClientConfig(config: unknown): string {
  return `${stringify(normalizeContinueConfig(config))}`;
}

export function mergeContinueYaml(existing: string, incoming: unknown): string {
  const root = normalizeContinueConfig(parseYamlObject(existing));
  const incomingRoot = normalizeContinueConfig(incoming);
  const nextServers = mergeServers(root.mcpServers, incomingRoot.mcpServers);
  return continueYamlFromClientConfig({ ...root, mcpServers: nextServers });
}

export function removeContinueServerYaml(existing: string, serverName: string): string {
  const parsed = parseYamlObject(existing);
  if (!parsed) return existing;

  const root = normalizeContinueConfig(parsed);
  const nextServers = root.mcpServers.filter((server) => asRecord(server).name !== serverName);
  if (nextServers.length === root.mcpServers.length) return existing;
  return continueYamlFromClientConfig({ ...root, mcpServers: nextServers });
}

export function readContinueServerConfig(raw: string, serverName: string): unknown | undefined {
  const parsed = parseYamlObject(raw);
  if (!parsed) return undefined;
  const root = normalizeContinueConfig(parsed);
  return root.mcpServers.find((server) => asRecord(server).name === serverName);
}

function mergeServers(existing: unknown[], incoming: unknown[]): unknown[] {
  const next = [...existing];
  for (const server of incoming) {
    const name = asRecord(server).name;
    if (typeof name !== "string") continue;
    const index = next.findIndex((candidate) => asRecord(candidate).name === name);
    if (index >= 0) {
      next[index] = server;
    } else {
      next.push(server);
    }
  }
  return next;
}

function normalizeContinueConfig(config: unknown): typeof DEFAULT_CONTINUE_CONFIG {
  const root = asRecord(config);
  const mcpServers = Array.isArray(root.mcpServers) ? root.mcpServers : [];
  return {
    ...root,
    name: typeof root.name === "string" ? root.name : DEFAULT_CONTINUE_CONFIG.name,
    version: typeof root.version === "string" ? root.version : DEFAULT_CONTINUE_CONFIG.version,
    schema: typeof root.schema === "string" ? root.schema : DEFAULT_CONTINUE_CONFIG.schema,
    mcpServers,
  };
}

function parseYamlObject(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) return undefined;
  const document = parseDocument(raw);
  if (document.errors.length) {
    throw new Error(document.errors.map((error) => error.message).join("; "));
  }
  const parsed = document.toJS() as unknown;
  return isRecord(parsed) ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
