import React from "react";
import { render } from "ink";
import { MpmTui } from "./tui/app.js";

export type { BrowseLayout, ClientSelection, DataMode, InputMode, SourceMode, TuiCommandId, TuiCommandState, TuiState, TuiVersionInfo, View } from "./tui/types.js";
export type { InstalledRuntimeStatus, InstalledServerState, InstalledViewAction, InstalledViewState } from "./tui/installedState.js";
export type { TuiHitAction, TuiHitZones, TuiMenuLayout, TuiMenuSegment } from "./tui/layout.js";
export { commandLineFor, commandRequiresServer, shellQuote } from "./tui/command.js";
export { installedId, installedViewReducer, loadInstalledServerStates } from "./tui/installedState.js";
export { buildTuiHitZones, computeMenuLayout, hitTestTui, listWindowStart } from "./tui/layout.js";
export {
  buildTuiVersionInfo,
  cacheHasSource,
  commandLogBelongsToView,
  commandLogForView,
  configTargetLabel,
  filterBySource,
  formatVersionChoices,
  initialInstallVersionIndex,
  installClientChoicesForScope,
  installClientLabel,
  nextClient,
  nextSource,
  nextView,
  pruneVersionSelections,
  scopeLabel,
  selectedClients,
  selectedClientsForScope,
  selectedServerVersion,
  switchView,
} from "./tui/selectors.js";

export function runTui(): void {
  render(<MpmTui />, { alternateScreen: Boolean(process.stdout.isTTY) });
}
