import { LIST_ROW_START, MENU_ROW } from "./constants.js";
import { truncate } from "./format.js";
import type { View } from "./types.js";

export type TuiHitAction = { kind: "view"; view: View } | { kind: "server"; index: number };

export interface TuiMenuSegment {
  view: View;
  label: string;
  from: number;
  to: number;
  enabled: boolean;
}

export interface TuiMenuLayout {
  selectedLabel: string;
  selectedFrom: number;
  selectedTo: number;
  segments: TuiMenuSegment[];
}

export interface TuiHitZones {
  menuY: number;
  menu: TuiMenuSegment[];
  list?: {
    fromY: number;
    toY: number;
    start: number;
    total: number;
  };
}

export function buildTuiHitZones({
  width,
  listHeight,
  selectedIndex,
  resultCount,
  hasSelection,
  selectedLabel,
  listActive,
}: {
  width: number;
  listHeight: number;
  selectedIndex: number;
  resultCount: number;
  hasSelection: boolean;
  selectedLabel?: string;
  listActive: boolean;
}): TuiHitZones {
  const visibleCount = Math.max(2, listHeight - 2);
  const listStart = listWindowStart(selectedIndex, visibleCount, resultCount);
  const menuLayout = computeMenuLayout({ width, hasSelection, selectedLabel });
  return {
    menuY: MENU_ROW,
    menu: menuLayout.segments,
    list: listActive ? {
      fromY: LIST_ROW_START,
      toY: LIST_ROW_START + visibleCount - 1,
      start: listStart,
      total: resultCount,
    } : undefined,
  };
}

export function computeMenuLayout({ width, hasSelection, selectedLabel }: { width: number; hasSelection: boolean; selectedLabel?: string }): TuiMenuLayout {
  const contentStart = 3;
  const helpLabel = "Help";
  const helpTo = Math.max(contentStart + helpLabel.length - 1, width - 2);
  const helpFrom = Math.max(contentStart, helpTo - helpLabel.length + 1);
  const labelWidth = Math.max(4, Math.min(28, width - 78));
  const chosenLabel = truncate(selectedLabel || "select a server", labelWidth);
  const segments: TuiMenuSegment[] = [];
  let cursor = contentStart;

  const push = (view: View, label: string, enabled: boolean) => {
    segments.push({ view, label, from: cursor, to: cursor + label.length - 1, enabled });
    cursor += label.length;
  };

  push("discover", "Browse", true);
  cursor += "  ".length;
  push("installed", "Installed", true);
  cursor += "  |  ".length;
  cursor += "Selected: ".length;
  const selectedFrom = cursor;
  const selectedTo = cursor + chosenLabel.length - 1;
  cursor += chosenLabel.length;
  cursor += "  |  ".length;
  push("details", "Overview", hasSelection);
  cursor += "  ".length;
  push("plan", "Install", hasSelection);
  cursor += "  ".length;
  push("config", "Config", hasSelection);

  segments.push({ view: "help", label: helpLabel, from: helpFrom, to: helpTo, enabled: true });
  return { selectedLabel: chosenLabel, selectedFrom, selectedTo, segments };
}

export function hitTestTui(x: number, y: number, zones: TuiHitZones): TuiHitAction | undefined {
  if (y === zones.menuY) {
    const zone = zones.menu.find((entry) => x >= entry.from && x <= entry.to);
    return zone?.enabled ? { kind: "view", view: zone.view } : undefined;
  }

  if (zones.list && y >= zones.list.fromY && y <= zones.list.toY) {
    const index = zones.list.start + (y - zones.list.fromY);
    return index < zones.list.total ? { kind: "server", index } : undefined;
  }

  return undefined;
}

export function listWindowStart(selected: number, visibleCount: number, total: number): number {
  const maxStart = Math.max(0, total - visibleCount);
  const preferred = selected < visibleCount ? 0 : selected - visibleCount + 1;
  return Math.max(0, Math.min(preferred, maxStart));
}
