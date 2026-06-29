export type ColorMode = "auto" | "always" | "never";

export interface TerminalStyleOptions {
  color?: ColorMode;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  machineReadable?: boolean;
}

export interface TerminalStyle {
  color: boolean;
  ok(value: string): string;
  warn(value: string): string;
  error(value: string): string;
  cyan(value: string): string;
  muted(value: string): string;
  colorize(value: string, color?: string): string;
}

export const OK_COLOR = "\x1b[32m";
export const WARN_COLOR = "\x1b[33m";
export const ERR_COLOR = "\x1b[31m";
export const CYAN_COLOR = "\x1b[36m";
export const MUTED_COLOR = "\x1b[90m";

export function terminalStyle(options: TerminalStyleOptions = {}): TerminalStyle {
  const enabled = shouldUseColor(options);
  const colorize = (value: string, color?: string): string => {
    if (!enabled || !color) return value;
    return `${color}${value}\x1b[0m`;
  };
  return {
    color: enabled,
    ok: (value) => colorize(value, OK_COLOR),
    warn: (value) => colorize(value, WARN_COLOR),
    error: (value) => colorize(value, ERR_COLOR),
    cyan: (value) => colorize(value, CYAN_COLOR),
    muted: (value) => colorize(value, MUTED_COLOR),
    colorize,
  };
}

export function parseColorMode(value: string | undefined, fallback: ColorMode = "auto"): ColorMode {
  if (!value) return fallback;
  if (value === "auto" || value === "always" || value === "never") return value;
  throw new Error("--color must be auto, always, or never");
}

function shouldUseColor(options: TerminalStyleOptions): boolean {
  const color = options.color ?? "auto";
  if (color === "never") return false;
  if (color === "always") return true;
  if (options.machineReadable) return false;

  const env = options.env ?? process.env;
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  return options.isTTY ?? Boolean(process.stdout.isTTY);
}
