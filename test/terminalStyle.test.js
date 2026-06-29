import assert from "node:assert/strict";
import test from "node:test";
import { parseColorMode, terminalStyle } from "../dist/terminalStyle.js";

test("terminal style honors auto TTY color and non-TTY plain output", () => {
  assert.match(terminalStyle({ color: "auto", isTTY: true, env: {} }).ok("VERIFIED"), /\x1b\[32mVERIFIED\x1b\[0m/);
  assert.equal(terminalStyle({ color: "auto", isTTY: false, env: {} }).ok("VERIFIED"), "VERIFIED");
});

test("terminal style honors NO_COLOR and FORCE_COLOR conventions", () => {
  assert.equal(terminalStyle({ color: "auto", isTTY: true, env: { NO_COLOR: "1" } }).warn("REVIEW"), "REVIEW");
  assert.match(terminalStyle({ color: "auto", isTTY: false, env: { FORCE_COLOR: "1" } }).warn("REVIEW"), /\x1b\[33mREVIEW\x1b\[0m/);
  assert.equal(terminalStyle({ color: "auto", isTTY: false, env: { FORCE_COLOR: "0" } }).warn("REVIEW"), "REVIEW");
});

test("terminal style explicit modes override auto behavior", () => {
  assert.match(terminalStyle({ color: "always", isTTY: false, env: { NO_COLOR: "1" } }).error("FAILED"), /\x1b\[31mFAILED\x1b\[0m/);
  assert.equal(terminalStyle({ color: "never", isTTY: true, env: { FORCE_COLOR: "1" } }).cyan("command"), "command");
});

test("terminal style suppresses color for machine-readable output unless forced", () => {
  assert.equal(terminalStyle({ color: "auto", isTTY: true, env: {}, machineReadable: true }).ok("VERIFIED"), "VERIFIED");
  assert.match(terminalStyle({ color: "always", isTTY: false, env: {}, machineReadable: true }).ok("VERIFIED"), /\x1b\[32mVERIFIED\x1b\[0m/);
});

test("terminal style rejects invalid --color values", () => {
  assert.equal(parseColorMode("auto"), "auto");
  assert.equal(parseColorMode("always"), "always");
  assert.equal(parseColorMode("never"), "never");
  assert.throws(() => parseColorMode("sometimes"), /--color must be auto, always, or never/);
});
