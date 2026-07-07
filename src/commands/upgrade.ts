import { spawn } from "node:child_process";
import { TOOLPIN_VERSION } from "../version.js";
import { OK_COLOR, WARN_COLOR } from "../terminalStyle.js";
import { hasFlag, printBullet, printField, printHeader, stringFlag } from "./shared.js";

const TOOLPIN_NPM_PACKAGE = "@proofofwork-agency/toolpin";
type UpgradePackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface UpgradeCommand {
  packageManager: UpgradePackageManager;
  executable: string;
  args: string[];
  display: string;
}


export async function upgrade(rest: string[]): Promise<void> {
  const dryRun = hasFlag(rest, "--dry-run");
  const json = hasFlag(rest, "--json");
  const target = stringFlag(rest, "--target", "latest");
  const packageManager = upgradePackageManager(rest);
  const command = upgradeCommand(packageManager, target);
  const result = {
    package: TOOLPIN_NPM_PACKAGE,
    currentVersion: TOOLPIN_VERSION,
    target,
    packageManager,
    command: [command.executable, ...command.args],
    dryRun,
  };

  if (json) {
    if (!dryRun) throw new Error("toolpin upgrade --json requires --dry-run because package-manager output is streamed directly.");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHeader("ToolPin Upgrade");
  printField("current", TOOLPIN_VERSION);
  printField("target", target);
  printField("command", command.display);

  if (dryRun) {
    printField("status", "dry run; no changes made", WARN_COLOR);
    return;
  }

  await runUpgradeCommand(command);
  printField("status", "upgrade command completed", OK_COLOR);
  printBullet("Run `tpn -v` or `toolpin --version` in a new shell to verify the active binary.");
}

export function upgradeHelp(): void {
  console.log("Usage: toolpin upgrade [--target latest|<version>] [--package-manager npm|pnpm|yarn|bun] [--dry-run] [--json]\n       tpn upgrade [--target latest]");
}

function upgradePackageManager(values: string[]): UpgradePackageManager {
  const requested = stringFlag(values, "--package-manager", detectPackageManager());
  if (requested === "npm" || requested === "pnpm" || requested === "yarn" || requested === "bun") return requested;
  throw new Error("--package-manager must be npm, pnpm, yarn, or bun");
}

function detectPackageManager(): UpgradePackageManager {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  return "npm";
}

function upgradeCommand(packageManager: UpgradePackageManager, target: string): UpgradeCommand {
  if (!target || target.startsWith("-")) throw new Error("--target requires a package version or dist-tag.");
  const spec = `${TOOLPIN_NPM_PACKAGE}@${target}`;
  const executable = packageManagerExecutable(packageManager);
  const args = packageManager === "npm"
    ? ["install", "-g", spec]
    : packageManager === "pnpm"
      ? ["add", "-g", spec]
      : packageManager === "yarn"
        ? ["global", "add", spec]
        : ["add", "-g", spec];
  return {
    packageManager,
    executable,
    args,
    display: [executable, ...args].join(" "),
  };
}

function packageManagerExecutable(packageManager: UpgradePackageManager): string {
  return process.platform === "win32" ? `${packageManager}.cmd` : packageManager;
}

async function runUpgradeCommand(command: UpgradeCommand): Promise<void> {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`Upgrade command failed with exit code ${exitCode ?? "unknown"}: ${command.display}`);
  }
}

