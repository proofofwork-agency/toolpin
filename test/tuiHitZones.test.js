import assert from "node:assert/strict";
import test from "node:test";
import { buildTuiHitZones, computeMenuLayout, hitTestTui, listWindowStart } from "../dist/tui.js";

test("listWindowStart lets selection move down before scrolling", () => {
  assert.equal(listWindowStart(0, 5, 20), 0);
  assert.equal(listWindowStart(3, 5, 20), 0);
  assert.equal(listWindowStart(4, 5, 20), 0);
  assert.equal(listWindowStart(5, 5, 20), 1);
  assert.equal(listWindowStart(19, 5, 20), 15);
});

test("TUI hit zones route menu clicks and dim unavailable selected-server facets", () => {
  const noSelection = buildTuiHitZones({
    width: 100,
    listHeight: 10,
    selectedIndex: 0,
    resultCount: 20,
    hasSelection: false,
    selectedLabel: "Long selected server label",
    listActive: true,
  });

  const emptyLayout = computeMenuLayout({ width: 100, hasSelection: false, selectedLabel: "Long selected server label" });
  assert.deepEqual(hitTestTui(pointInside(emptyLayout, "discover"), noSelection.menuY, noSelection), { kind: "view", view: "discover" });
  assert.equal(emptyLayout.segments.some((entry) => ["details", "plan", "config"].includes(entry.view)), false);
  assert.deepEqual(hitTestTui(pointInside(emptyLayout, "help"), noSelection.menuY, noSelection), { kind: "view", view: "help" });

  const withSelection = buildTuiHitZones({
    width: 100,
    listHeight: 10,
    selectedIndex: 0,
    resultCount: 20,
    hasSelection: true,
    selectedLabel: "Long selected server label",
    listActive: true,
  });
  const layout = computeMenuLayout({ width: 100, hasSelection: true, selectedLabel: "Long selected server label" });

  assert.equal(hitTestTui(layout.selectedFrom, withSelection.menuY, withSelection), undefined);
  assert.deepEqual(hitTestTui(pointInside(layout, "details"), withSelection.menuY, withSelection), { kind: "view", view: "details" });
  assert.deepEqual(hitTestTui(pointInside(layout, "plan"), withSelection.menuY, withSelection), { kind: "view", view: "plan" });
  assert.deepEqual(hitTestTui(pointInside(layout, "config"), withSelection.menuY, withSelection), { kind: "view", view: "config" });
});

test("TUI menu layout keeps hit zones aligned after truncating selected labels", () => {
  const layout = computeMenuLayout({
    width: 72,
    hasSelection: true,
    selectedLabel: "A very long selected server label that must truncate",
  });

  assert.ok(layout.selectedLabel.length <= 11);
  for (const segment of layout.segments) {
    assert.ok(segment.from <= segment.to, `${segment.view} has a valid span`);
    assert.ok(segment.to <= 70, `${segment.view} stays inside padded content`);
  }
});

test("TUI hit zones map visible list rows through the same scrolling window", () => {
  const zones = buildTuiHitZones({
    width: 100,
    listHeight: 7,
    selectedIndex: 7,
    resultCount: 20,
    hasSelection: true,
    listActive: true,
  });

  assert.deepEqual(hitTestTui(5, 8, zones), { kind: "server", index: 3 });
  assert.deepEqual(hitTestTui(5, 12, zones), { kind: "server", index: 7 });
  assert.equal(hitTestTui(5, 13, zones), undefined);
});

function pointInside(layout, view) {
  const segment = layout.segments.find((entry) => entry.view === view);
  assert.ok(segment, `missing ${view} segment`);
  return segment.from;
}
