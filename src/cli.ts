#!/usr/bin/env node
import { ingest, info, registry, scan, search, test, verify, versions } from "./commands/discovery.js";
import { adoptInstalled, exportConfig, install, listInstalled, plan, remove, testInstalled, updateInstalled } from "./commands/install.js";
import { audit, ci, ciHelp, doctor, doctorHelp, lock, outdated, policy, secrets } from "./commands/governance.js";
import { interactiveHelp, printTuiHelp, runInteractive, runTui } from "./commands/ui.js";
import { upgrade, upgradeHelp } from "./commands/upgrade.js";
import { CLIENT_USAGE, configureCliOutput, isHelp, normalizeArgs, validateColorFlag, validateFlags } from "./commands/shared.js";
import { TOOLPIN_VERSION } from "./version.js";

const args = normalizeArgs(process.argv.slice(2));
configureCliOutput(args);

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const command = args[0] ?? "help";
  const rest = args.slice(1);
  validateColorFlag(args);
  if (command !== "help" && command !== "--help" && command !== "-h") {
    validateFlags(command, rest);
    if (isHelp(rest)) {
      commandHelp(command);
      return;
    }
  }

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      console.log(`toolpin ${TOOLPIN_VERSION}`);
      return;
    case "upgrade":
      await upgrade(rest);
      return;
    case "ingest":
      await ingest(rest);
      return;
    case "search":
      await search(rest);
      return;
    case "interactive":
    case "i":
      await runInteractive(rest);
      return;
    case "info":
      await info(rest);
      return;
    case "audit":
      await audit(rest);
      return;
    case "scan":
      await scan(rest);
      return;
    case "verify":
      await verify(rest);
      return;
    case "versions":
      await versions(rest);
      return;
    case "registry":
      await registry(rest);
      return;
    case "sources":
      await registry(["list", ...rest]);
      return;
    case "outdated":
      await outdated(rest);
      return;
    case "list":
    case "ls":
    case "installed":
      await listInstalled(rest);
      return;
    case "plan":
      await plan(rest);
      return;
    case "install":
      await install(rest);
      return;
    case "adopt":
      await adoptInstalled(rest);
      return;
    case "update":
      await updateInstalled(rest);
      return;
    case "policy":
      await policy(rest);
      return;
    case "secrets":
      await secrets(rest);
      return;
    case "remove":
      await remove(rest, "remove");
      return;
    case "uninstall":
      await remove(rest, "uninstall");
      return;
    case "ci":
      await ci(rest);
      return;
    case "doctor":
      await doctor(rest);
      return;
    case "test":
      await test(rest);
      return;
    case "test-installed":
      await testInstalled(rest);
      return;
    case "lock":
      await lock(rest);
      return;
    case "export-config":
      await exportConfig(rest);
      return;
    case "tui":
      await runTui(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      help();
      return;
    default:
      throw new Error(`Unknown command: ${command}. Run \`toolpin help\`.`);
  }
}

function commandHelp(command: string): void {
  switch (command) {
    case "upgrade":
      upgradeHelp();
      return;
    case "version":
    case "--version":
    case "-v":
      console.log("Usage: toolpin version\n       toolpin --version\n       toolpin -v");
      return;
    case "ingest":
      console.log("Usage: toolpin ingest [--source toolpin|official|docker|all|custom-id] [--limit 100] [--pages 10]");
      return;
    case "search":
      console.log("Usage: toolpin search <query> [--source toolpin|official|docker|all|custom-id] [--limit 10] [--live] [--json]");
      return;
    case "info":
      console.log("Usage: toolpin info <server-name> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--json] [--live] [--explain]");
      return;
    case "interactive":
    case "i":
      interactiveHelp();
      return;
    case "ci":
      ciHelp();
      return;
    case "registry":
    case "sources":
      console.log("Usage: toolpin registry list [--json]\n       toolpin registry enable <source-id>\n       toolpin registry disable <source-id>");
      return;
    case "audit":
      console.log("Usage: toolpin audit [--file mcp-lock.json] [--scope all|project|global] [--client all] [--policy .toolpin/policy.json] [--verify] [--allow-execute] [--require-verified] [--json]\n       toolpin audit server <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--explain]");
      return;
    case "scan":
      console.log("Usage: toolpin scan <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--allow-execute] [--json] [--sarif] [--timeout 15000]\nDescription scan only; use `toolpin verify` for artifact evidence verification and `toolpin audit` for local install audit.");
      return;
    case "verify":
      console.log("Usage: toolpin verify <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000] [--skip-live-verification] [--allow-execute] [--require-verified] [--explain]");
      return;
    case "versions":
      console.log("Usage: toolpin versions <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--limit 10] [--json]");
      return;
    case "outdated":
      console.log("Usage: toolpin outdated [--file mcp-lock.json] [--source toolpin|official|docker|all|custom-id] [--live] [--json]");
      return;
    case "doctor":
      doctorHelp();
      return;
    case "list":
    case "ls":
    case "installed":
      console.log(`Usage: toolpin list [--scope all|project|global] [--client ${CLIENT_USAGE}] [--json]`);
      return;
    case "remove":
    case "uninstall":
      console.log(`Usage: toolpin ${command} <server-name> [--client ${CLIENT_USAGE}] [--scope project|global] [--file mcp-lock.json]`);
      return;
    case "plan":
      console.log(`Usage: toolpin plan <server-name> --client ${CLIENT_USAGE} [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live]`);
      return;
    case "install":
      console.log(`Usage: toolpin install <server-name> --client ${CLIENT_USAGE} [--version <server-version>] [--scope project|global] [--source toolpin|official|docker|all|custom-id] [--live] [--update-lock] [--verify] [--require-verified] [--policy .toolpin/policy.json] [--no-policy] [--explain]`);
      return;
    case "adopt":
      console.log(`Usage: toolpin adopt <installed-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--source toolpin|official|docker|all|custom-id] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]`);
      return;
    case "update":
      console.log(`Usage: toolpin update <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]
       toolpin update --all [--scope all|project|global] [--client ${CLIENT_USAGE}] [--source toolpin|official|docker|all|custom-id] [--live] [--file mcp-lock.json] [--dry-run] [--json]`);
      return;
    case "test":
      console.log("Usage: toolpin test <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--timeout 15000] [--json]");
      return;
    case "test-installed":
      console.log(`Usage: toolpin test-installed <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--timeout 15000] [--json]`);
      return;
    case "export-config":
      console.log(`Usage: toolpin export-config <server-name> --client ${CLIENT_USAGE} [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live]`);
      return;
    case "lock":
      console.log(`Usage: toolpin lock <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--file mcp-lock.json] [--verify [--allow-execute] [--skip-live-verification | --skip-live-verify] [--timeout 15000]]
       toolpin lock digest [--file mcp-lock.json] [--json]
       toolpin lock key-fingerprint --public-key public.pem [--json]
       toolpin lock sign --policy .toolpin/policy.json --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]
       toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]`);
      return;
    case "policy":
      console.log(`Usage: toolpin policy digest [--policy .toolpin/policy.json] [--json]
       toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);
      return;
    case "secrets":
      console.log("Usage: toolpin secrets audit [--file mcp-lock.json] [--scope all|project|global] [--json]");
      return;
    case "tui":
      printTuiHelp();
      return;
    default:
      help();
  }
}

function help(): void {
  console.log(`ToolPin ${TOOLPIN_VERSION}
  Trusted install, lockfile, and governance for MCP servers.

Quick start
  toolpin tui
  toolpin interactive github
  tpn i github
  tpn upgrade
  toolpin --version
  tpn -v
  toolpin ingest
  toolpin search github
  toolpin install <server> --client claude --update-lock

Discovery
  toolpin ingest [--source toolpin|official|docker|all|custom-id] [--limit 100] [--pages 10]
  toolpin registry list [--json]
  toolpin registry enable <source-id>
  toolpin registry disable <source-id>
  toolpin sources [--json]
  toolpin search <query> [--source toolpin|official|docker|all|custom-id] [--limit 10] [--live] [--json]
  toolpin interactive [query] [--source toolpin|official|docker|all|custom-id] [--live] [--limit 10] [--client ${CLIENT_USAGE}] [--scope project|global] [--version <server-version>] [--verify] [--require-verified] [--timeout 15000] [--policy .toolpin/policy.json] [--no-policy] [--no-input] [--explain] [--color auto|always|never]
  toolpin i [query] [same options]
  toolpin info <server> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--json] [--live] [--explain]
  toolpin scan <server> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000]  # description scan
  toolpin verify <server> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000] [--skip-live-verification] [--allow-execute] [--require-verified] [--explain]
  toolpin versions <server> [--source toolpin|official|docker|all|custom-id] [--live] [--limit 10] [--json]
  toolpin test <server> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--timeout 15000] [--json]
  toolpin test-installed <server> --client|-c <client> --scope|-s project|global [--timeout 15000] [--json]

Install and config
  toolpin list|installed [--scope|-s all|project|global] [--client|-c <client|all>] [--json]
  toolpin plan <server> --client|-c <client> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live]
  toolpin install <server> --client|-c <client|all> [--version <server-version>] [--scope|-s project|global] [--source toolpin|official|docker|all|custom-id] [--global|-g] [--update-lock] [--verify] [--require-verified] [--policy .toolpin/policy.json] [--no-policy] [--explain]
  toolpin adopt <installed> --client|-c <client> --scope|-s project|global [--source toolpin|official|docker|all|custom-id] [--live] [--dry-run] [--json]
  toolpin update <server> --client|-c <client> --scope|-s project|global [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--dry-run] [--json]
  toolpin update --all [--scope|-s all|project|global] [--client|-c <client|all>] [--source toolpin|official|docker|all|custom-id] [--live] [--dry-run] [--json]
  toolpin remove <server> [--client|-c <client|all>] [--scope|-s project|global] [--global|-g]
  toolpin uninstall <server> [--client|-c <client|all>] [--scope|-s project|global] [--global|-g]
  toolpin export-config <server> --client|-c <client|all> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live]

Lock and governance
  toolpin audit [--file mcp-lock.json] [--scope|-s all|project|global] [--client|-c <client|all>] [--verify] [--allow-execute] [--require-verified] [--json]
  toolpin audit server <server> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--explain]
  toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source toolpin|official|docker|all|id] [--live] [--verify [--require-verified] [--allow-execute] [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--sarif]
  toolpin outdated [--file mcp-lock.json] [--source toolpin|official|docker|all|custom-id] [--live] [--json]
  toolpin doctor [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]
  toolpin secrets audit [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]
  toolpin policy digest [--policy .toolpin/policy.json] [--json]
  toolpin policy check <server> --client|-c <client|all> [--version <server-version>] [--scope|-s project|global] [--source toolpin|official|docker|all|custom-id] [--policy .toolpin/policy.json] [--json] [--live]
  toolpin lock <server> --client|-c <client|all> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--scope project|global] [--file mcp-lock.json]
  toolpin lock digest [--file mcp-lock.json] [--json]
  toolpin lock key-fingerprint --public-key public.pem [--json]
  toolpin lock sign --policy .toolpin/policy.json --key private.pem [--signature mcp-lock.sig] [--json]
  toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--signature mcp-lock.sig] [--json]

Maintenance
  toolpin upgrade [--target latest|<version>] [--package-manager npm|pnpm|yarn|bun] [--dry-run]
  tpn upgrade
  tpn -v

Trust output
  verdict is verified, needs-review, or blocked
  use --explain to show internal tier, profile score, evidence, and cap details

Common options
  --source toolpin|official|docker|all|id
                                    choose registry source; all means enabled sources
  --live                            fetch instead of cache
  --json                            machine-readable output where supported
  --sarif                           SARIF 2.1.0 output where supported
  --allow-hosted-directory-targets  opt in to hosted Smithery directory targets
  toolpin --version, -v             print ToolPin version
  --version <server-version>        select a known server version for server commands
  --scope, -s project|global        project folder vs current-user config
  --global, -g                      npm-style shortcut for --scope global
  --project, -p                     shortcut for --scope project
  --client, -c <client|all>         target client config
  --target latest|<version>         package target for toolpin upgrade

Clients
  ${CLIENT_USAGE.replaceAll("|", ", ")}
`);
}
