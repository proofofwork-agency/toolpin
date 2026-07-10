import { readLockfile, verifyAgainstLockfile, type InstallPlan, type LockDiffOptions } from "./plan.js";

export interface FrozenInstallIssue {
  key: string;
  messages: string[];
}

export interface FrozenInstallReport {
  ok: boolean;
  checked: number;
  issues: FrozenInstallIssue[];
}

export async function verifyFrozenInstall(
  lockfilePath: string,
  resolveCurrentPlan: (locked: InstallPlan, key: string) => Promise<InstallPlan>,
  options: LockDiffOptions = {},
): Promise<FrozenInstallReport> {
  const lockfile = await readLockfile(lockfilePath);
  const entries = Object.entries(lockfile.servers);
  const issues: FrozenInstallIssue[] = [];

  for (const [key, locked] of entries) {
    try {
      const current = await resolveCurrentPlan(locked, key);
      const verification = await verifyAgainstLockfile(current, lockfilePath, options);
      if (!verification.ok) {
        issues.push({ key, messages: verification.messages });
      }
    } catch (error) {
      issues.push({ key, messages: [error instanceof Error ? error.message : String(error)] });
    }
  }

  if (entries.length === 0) {
    issues.push({ key: lockfilePath, messages: ["lockfile has no server entries"] });
  }

  return {
    ok: issues.length === 0,
    checked: entries.length,
    issues,
  };
}
