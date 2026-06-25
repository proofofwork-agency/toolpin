export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function safeJson<T>(factory: () => T): T | { error: string } {
  try {
    return factory();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

export function shortPath(value: string): string {
  const home = process.env.HOME;
  const pathValue = home && value.startsWith(home) ? `~${value.slice(home.length)}` : value;
  const parts = pathValue.split("/");
  return parts.length > 4 ? `.../${parts.slice(-3).join("/")}` : pathValue;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}
