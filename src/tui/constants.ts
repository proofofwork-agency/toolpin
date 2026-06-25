import { ALL_CLIENTS, type ClientName } from "../config.js";
import type { ClientSelection, TuiCommand, View } from "./types.js";

export const VIEWS: View[] = ["discover", "installed", "details", "plan", "config", "help"];
export const SERVER_VIEWS = new Set<View>(["details", "plan", "config"]);
export const CLIENTS: ClientSelection[] = [...ALL_CLIENTS.filter((client): client is Exclude<ClientName, "generic"> => client !== "generic"), "all"];

export const TUI_COMMANDS: TuiCommand[] = [
  { id: "ingest", label: "Ingest registries", description: "Fetch registry metadata and refresh .toolpin/registry-cache.json." },
  { id: "installed", label: "Installed servers", description: "Show installed MCP servers, lock drift, versions, updates, and lifecycle actions." },
  { id: "search", label: "Search servers", description: "Edit the current search query." },
  { id: "more-results", label: "Show more results", description: "Increase the TUI result window by 50 matches." },
  { id: "reset-view", label: "Reset view defaults", description: "Reset search/source/result count/client/scope to defaults." },
  { id: "info", label: "Server info", description: "Open selected server metadata and trust summary.", requiresServer: true },
  { id: "audit", label: "Audit trust", description: "Show selected server trust score, badges, and issues.", requiresServer: true },
  { id: "plan", label: "Install plan", description: "Preview target, trust, secrets, and config writes.", requiresServer: true },
  { id: "install", label: "Install server", description: "Write selected server into the active client config.", requiresServer: true },
  { id: "remove", label: "Remove server", description: "Delete selected server from active client config and lockfile.", requiresServer: true },
  { id: "doctor", label: "Check config drift", description: "Compare mcp-lock.json against active-scope client configs." },
  { id: "test", label: "Test server", description: "Connect and run MCP tools/list.", requiresServer: true },
  { id: "ci", label: "Frozen lock check", description: "Re-resolve lockfile entries and reject metadata drift." },
  { id: "lock", label: "Write lockfile", description: "Write selected server to mcp-lock.json.", requiresServer: true },
  { id: "export-config", label: "Export config", description: "Save client config snippets under .toolpin/.", requiresServer: true },
  { id: "tui", label: "Open TUI", description: "Current interactive session." },
  { id: "help", label: "Help", description: "Open keyboard and command reference." },
];

export const BLUE = "#8aa7ff";
export const ACCENT = "#22d3ee";
export const MUTED = "#8b8b94";
export const CHROME = "#52525b";
export const SURFACE = "#171719";
export const SURFACE_2 = "#202023";
export const MODAL_BORDER = "#3f3f46";
export const OK = "#4ade80";
export const WARN = "#fbbf24";
export const ERR = "#f87171";
export const MENU_ROW = 6;
export const LIST_ROW_START = 8;
export const DEFAULT_RESULT_LIMIT = 50;
export const RESULT_LIMIT_STEP = 50;
export const MAX_RESULT_LIMIT = 500;
