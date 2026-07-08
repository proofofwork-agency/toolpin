import { isRecord } from "./util.js";

export interface CanonicalJsonOptions {
  pruneEmptyObjects?: boolean;
}

export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  return JSON.stringify(sortJson(value, options));
}

function sortJson(value: unknown, options: CanonicalJsonOptions): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry, options));
  if (!isRecord(value)) return value;

  const normalizedEntries = Object.entries(value).map(([key, child]) => [normalizeKey(key), child] as const);
  ensureUniqueKeys(normalizedEntries.map(([key]) => key));

  const entries = normalizedEntries
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([key, child]) => [key, sortJson(child, options)] as const)
    .filter(([, child]) => !options.pruneEmptyObjects || !isRecord(child) || Object.keys(child).length > 0);

  return Object.fromEntries(entries);
}

function normalizeKey(key: string): string {
  return key.normalize("NFC");
}

function compareKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function ensureUniqueKeys(keys: string[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(`Canonical JSON object has duplicate key after NFC normalization: ${key}`);
    }
    seen.add(key);
  }
}
