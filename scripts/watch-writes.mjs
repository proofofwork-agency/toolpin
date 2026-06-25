#!/usr/bin/env node
import { watch, statSync, readFileSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, join, resolve } from "node:path";

const root = resolve(process.argv[2] || process.cwd());
const logDir = join(root, ".watcher");
mkdirSync(logDir, { recursive: true });

const pidFile = join(logDir, "pid");
const hbFile = join(logDir, "heartbeat");
const evFile = join(logDir, "events.log");
const errFile = join(logDir, "errors.log");

const DEBOUNCE = Number(process.env.WATCH_DEBOUNCE_MS || 500);
const MAX_BYTES = 256 * 1024;

const IGNORE = [
  /[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/, /[\\/]dist[\\/]/,
  /[\\/]\.watcher[\\/]/, /[\\/]\.toolpin[\\/]/, /[\\/]\.engram[\\/]/,
  /[\\/]\.contextrelay[\\/]/, /[\\/]\.claude[\\/]/, /[\\/]coverage[\\/]/,
  /\.log$/i, /[\\/]\.DS_Store$/,
];

writeFileSync(pidFile, String(process.pid));
writeFileSync(hbFile, new Date().toISOString());

function ignored(p) {
  const rel = relative(root, p);
  if (!rel || rel.startsWith("..")) return true;
  return IGNORE.some((re) => re.test(p) || re.test(rel));
}

function git(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

function tracked(rel) {
  return git(["ls-files", "--error-unmatch", rel]).status === 0;
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

const pending = new Map();
function schedule(p) {
  if (pending.has(p)) return;
  pending.set(p, setTimeout(() => { pending.delete(p); emit(p); }, DEBOUNCE));
}

function emit(p) {
  let st;
  try { st = statSync(p); } catch { return; }
  if (!st.isFile() || st.size > MAX_BYTES) return;
  let buf;
  try { buf = readFileSync(p); } catch { return; }
  if (isBinary(buf)) return;

  const rel = relative(root, p);
  const isTracked = tracked(rel);
  let diff = "";
  if (isTracked) {
    diff = (git(["diff", "HEAD", "--", rel]).stdout || "").trim();
    if (!diff) diff = (git(["diff", "--cached", "--", rel]).stdout || "").trim();
    if (!diff) return;
  } else {
    diff = `--- new/untracked: ${rel}\n` + buf.subarray(0, MAX_BYTES).toString("utf8");
  }

  const ev = { ts: new Date().toISOString(), path: rel, tracked: isTracked, size: st.size, diff };
  appendFileSync(evFile, JSON.stringify(ev) + "\n");
}

let watcher;
try {
  watcher = watch(root, { recursive: true });
} catch (e) {
  process.stderr.write("watch failed: " + e.message + "\n");
  process.exit(1);
}

watcher.on("change", (_type, filename) => {
  if (!filename) return;
  const full = join(root, filename);
  if (ignored(full)) return;
  schedule(full);
});

const hb = setInterval(() => writeFileSync(hbFile, new Date().toISOString()), 15000);

function shutdown(sig) {
  clearInterval(hb);
  writeFileSync(join(logDir, "exit"), `${sig} ${new Date().toISOString()}`);
  try { watcher.close(); } catch {}
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (e) => {
  appendFileSync(errFile, `${new Date().toISOString()} ${e.stack}\n`);
});

process.stderr.write(`watching ${root} -> ${evFile} (pid ${process.pid})\n`);
