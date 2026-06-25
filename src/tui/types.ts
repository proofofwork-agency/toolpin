import type { ClientName } from "../config.js";
import type { InstallScope } from "../install.js";
import type { Lockfile } from "../plan.js";
import type { ServerTestResult } from "../tester.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceId } from "../types.js";

export type View = "discover" | "installed" | "details" | "plan" | "config" | "help";
export type InputMode = "normal" | "search" | "command";
export type DataMode = "cache" | "live";
export type SourceMode = RegistrySourceId | "all";
export type ClientSelection = ClientName | "all";
export type TuiCommandId =
  | "ingest"
  | "installed"
  | "search"
  | "more-results"
  | "reset-view"
  | "info"
  | "audit"
  | "plan"
  | "install"
  | "remove"
  | "ci"
  | "doctor"
  | "test"
  | "lock"
  | "export-config"
  | "tui"
  | "help";

export interface TuiCommand {
  id: TuiCommandId;
  label: string;
  description: string;
  requiresServer?: boolean;
}

export interface CommandLog {
  title: string;
  command: string;
  ok: boolean;
  lines: string[];
}

export interface TuiState {
  entries: RegistryEntry[];
  servers: NormalizedServer[];
  lockfile?: Lockfile;
  query: string;
  commandQuery: string;
  commandSelected: number;
  selected: number;
  versionSelections: Record<string, string>;
  view: View;
  inputMode: InputMode;
  dataMode: DataMode;
  sourceMode: SourceMode;
  resultLimit: number;
  client: ClientSelection;
  installScope: InstallScope;
  loading: boolean;
  installing: boolean;
  testing: boolean;
  testResult?: ServerTestResult;
  error?: string;
  lastAction?: string;
  commandLog?: CommandLog;
  pendingRemove?: {
    serverName: string;
    client: ClientSelection;
    scope: InstallScope;
  };
}

export interface TuiVersionInfo {
  selectedVersion: string;
  latestVersion: string;
  lockedLabel: string;
  status: "current" | "update available" | "not locked" | "ahead of registry" | "unknown";
  versions: string[];
}

export interface TuiCommandState {
  query: string;
  sourceMode: SourceMode;
  dataMode: DataMode;
  client: ClientSelection;
  installScope: InstallScope;
}
