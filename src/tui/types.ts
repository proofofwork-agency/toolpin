import type { ClientName } from "../config.js";
import type { InstallScope } from "../install.js";
import type { Lockfile } from "../plan.js";
import type { ServerTestResult } from "../tester.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceId, RegistrySourceInfo } from "../types.js";

export type View = "discover" | "installed" | "sources" | "details" | "plan" | "config" | "help";
export type InputMode = "normal" | "search" | "command";
export type DataMode = "cache" | "live";
export type SourceMode = RegistrySourceId | "all";
export type ClientSelection = ClientName | "all";
export type BrowseLayout = "flat" | "project" | "category";
export type TuiCommandId =
  | "ingest"
  | "installed"
  | "sources"
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
  registrySources: RegistrySourceInfo[];
  servers: NormalizedServer[];
  lockfile?: Lockfile;
  query: string;
  commandQuery: string;
  commandSelected: number;
  selected: number;
  versionSelections: Record<string, string>;
  installedVersionSelections: Record<string, string>;
  view: View;
  inputMode: InputMode;
  dataMode: DataMode;
  sourceMode: SourceMode;
  browseLayout: BrowseLayout;
  resultLimit: number;
  client: ClientSelection;
  installScope: InstallScope;
  loading: boolean;
  installing: boolean;
  testing: boolean;
  checking: boolean;
  testResult?: ServerTestResult;
  error?: string;
  lastAction?: string;
  commandLog?: CommandLog;
  installFlow?: InstallFlow;
  pendingRemove?: {
    serverName: string;
    client: ClientSelection;
    scope: InstallScope;
  };
  deleteConfirm?: {
    source: "installed";
    serverName: string;
    client: ClientName;
    scope: InstallScope;
    selected: "no" | "yes";
  };
}

export interface InstallFlow {
  step: "version" | "scope" | "client" | "installing" | "complete" | "failed";
  server: NormalizedServer;
  versions: NormalizedServer[];
  scope?: InstallScope;
  preferredClient: ClientSelection;
  selected: number;
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
