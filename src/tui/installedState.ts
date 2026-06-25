export type {
  InstalledLifecycleAction,
  InstalledRegistryStatus,
  InstalledRuntimeStatus,
  InstalledServerState,
  InstalledTestSource,
} from "../installed.js";
export { installedId, loadInstalledServerStates } from "../installed.js";

export interface InstalledViewState {
  rows: import("../installed.js").InstalledServerState[];
  selected: number;
  scope: import("../inventory.js").InventoryScope;
  loading: boolean;
}

export type InstalledViewAction =
  | { type: "loading" }
  | { type: "loaded"; rows: import("../installed.js").InstalledServerState[] }
  | { type: "select"; selected: number }
  | { type: "move"; delta: number }
  | { type: "scope"; scope: import("../inventory.js").InventoryScope };

export function installedViewReducer(state: InstalledViewState, action: InstalledViewAction): InstalledViewState {
  switch (action.type) {
    case "loading":
      return { ...state, loading: true };
    case "loaded":
      return {
        ...state,
        rows: action.rows,
        selected: clamp(state.selected, 0, Math.max(0, action.rows.length - 1)),
        loading: false,
      };
    case "select":
      return { ...state, selected: clamp(action.selected, 0, Math.max(0, state.rows.length - 1)) };
    case "move":
      return { ...state, selected: clamp(state.selected + action.delta, 0, Math.max(0, state.rows.length - 1)) };
    case "scope":
      return { ...state, scope: action.scope, selected: 0, loading: true };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
