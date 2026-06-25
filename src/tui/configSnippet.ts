import type { ClientName } from "../config.js";
import { codexTomlFromClientConfig } from "../codexToml.js";
import { continueYamlFromClientConfig } from "../continueYaml.js";

export function formatClientConfigSnippet(client: ClientName, config: unknown): { extension: "json" | "toml" | "yaml"; content: string } {
  if (client === "codex") {
    return { extension: "toml", content: `${codexTomlFromClientConfig(config)}\n` };
  }
  if (client === "continue") {
    return { extension: "yaml", content: continueYamlFromClientConfig(config) };
  }
  return { extension: "json", content: `${JSON.stringify(config, null, 2)}\n` };
}
