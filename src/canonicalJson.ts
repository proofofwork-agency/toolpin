export interface CanonicalJsonOptions {
  pruneEmptyObjects?: boolean;
}

export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  return JSON.stringify(sortJson(value, options));
}

function sortJson(value: unknown, options: CanonicalJsonOptions): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry, options));
  if (!isRecord(value)) return value;

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortJson(child, options)] as const)
    .filter(([, child]) => !options.pruneEmptyObjects || !isRecord(child) || Object.keys(child).length > 0);

  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
