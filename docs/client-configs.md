# Client Config Research

Last verified: 2026-06-25.

This file is the gate for adding new clients to `src/config.ts`, `src/install.ts`,
`src/cli.ts`, and `src/tui.tsx`. A client should not be added to `PROJECT_CLIENTS`
until its path, root key, transport shape, and secret interpolation semantics are
verified here from primary documentation.

## Current supported clients

All 12 clients below are implemented in `src/config.ts` (`exportClientConfig`,
`clientConfigRootKey`, `placeholderFor`) and wired into `src/install.ts`
(`resolveConfigTarget`). `PROJECT_CLIENTS` and `GLOBAL_CLIENTS` in `src/config.ts`
define which clients `--client all` fans out to per scope. A client whose project or
global path is not verified fails closed (`resolveConfigTarget` throws) instead of
writing a guess; `--client all` skips the unsupported scope for those clients.

`PROJECT_CLIENTS = [claude, cursor, vscode, codex, opencode, gemini, roo]`.
`GLOBAL_CLIENTS = [cursor, vscode, codex, opencode, windsurf, cline, continue, gemini]`.
Consequences: `claude` and `roo` are project-only, `windsurf`/`cline`/`continue` are
global-only, `zed` is export-only (both scopes fail closed), and `generic` is
explicit-only (works in both scopes when passed directly but is in neither
`--client all` list; its global scope writes a ToolPin sidecar).

| Client | Root key | Project path | Global path | Scope behavior |
|--------|----------|--------------|-------------|----------------|
| claude | `mcpServers` | `.mcp.json` | fail closed | Project only. Global owned by the Claude CLI; use `claude mcp add-json --scope user`. |
| cursor | `mcpServers` | `.cursor/mcp.json` | `~/.cursor/mcp.json` | Project + global. |
| vscode | `servers` | `.vscode/mcp.json` | Platform user settings path | Project + global. Linux `~/.config/Code/User/mcp.json`; macOS `~/Library/Application Support/Code/User/mcp.json`; Windows `%APPDATA%\Code\User\mcp.json`. |
| codex | `mcp_servers` | `.codex/config.toml` | `~/.codex/config.toml` | Project + global. TOML `[mcp_servers.<name>]` tables; project must be trusted by Codex. |
| opencode | `mcp` | `opencode.json` | `~/.config/opencode/opencode.json` | Project + global. Adds `$schema: https://opencode.ai/config.json` when creating a new config; preserves an existing top-level `$schema`. |
| windsurf | `mcpServers` | fail closed | `~/.codeium/windsurf/mcp_config.json` | Global only. Project path not documented. |
| cline | `mcpServers` | fail closed | `~/.cline/mcp.json` | Global only. Project path not documented. |
| continue | `mcpServers` (YAML list) | fail closed | `~/.continue/config.yaml` | Global only. YAML; top-level `name`/`version`/`schema` required; `mcpServers` is a list keyed by `name`. |
| gemini | `mcpServers` | `.gemini/settings.json` | `~/.gemini/settings.json` | Project + global. |
| zed | `context_servers` | fail closed | fail closed | Export only. Settings path unverified; both scopes throw. |
| roo | `mcpServers` | `.roo/mcp.json` | fail closed | Project only. Global `mcp_settings.json` path unverified. |
| generic | `mcpServers` | `.mcp.json` | `~/.config/toolpin/<client>-mcp.json` | Project + global sidecar (explicit `--client generic` only). |

## Transport and placeholder shapes

`selectLaunchTarget` prefers a `streamable-http` remote, then the first remote,
then the best package (OCI > MCPB > first). All clients support local stdio via a
package command and remote HTTP/SSE via a remote url; the inner object and secret
placeholder differ per client (`src/config.ts` `to*` helpers and `placeholderFor`).

| Client | Local (stdio) inner shape | Remote inner shape | Secret placeholder |
|--------|---------------------------|--------------------|--------------------|
| claude / cursor / generic / vscode | `{ command, args, env }` | `{ type, url, headers }` | `<NAME>` |
| codex | `{ command, args, env }` | `{ url, http_headers }` | `<NAME>` |
| opencode | `{ type:"local", command:[cmd,...args], enabled:true, environment }` | `{ type:"remote", url, enabled:true, headers }` | `<NAME>` |
| windsurf | `{ command, args, env }` | `{ serverUrl, headers }` | `${env:NAME}` |
| cline | `{ command, args, env, disabled:false, autoApprove:[] }` | `{ type:"streamableHttp"\|<type>, url, headers, disabled:false, autoApprove:[] }` | `<NAME>` |
| continue | `{ name, command, args, env }` | `{ name, type, url, requestOptions:{headers} }` | `${{ secrets.NAME }}` |
| gemini | `{ command, args, env }` | streamable-http `{ httpUrl, headers }`; otherwise `{ url, headers }` | `${NAME}` |
| zed | `{ command, args, env }` | `{ url, headers }` | `<NAME>` |
| roo | `{ command, args, env, disabled:false }` | `{ type, url, headers, disabled:false }` | `<NAME>` |

`vscode` wraps the inner object under `servers`; `codex` under `mcp_servers`;
`opencode` under `mcp` (plus `$schema`); `zed` under `context_servers`; the others
under `mcpServers` (continue's `mcpServers` is a YAML list). Empty/undefined fields
are pruned before write.

## Per-client research notes

The matrix above is the current source of truth; the notes below capture the
primary-source evidence and open questions behind each client's implementation.

### Windsurf / Cascade

Status: **implemented for global writes; project path still gated**.

Source: https://docs.devin.ai/desktop/cascade/mcp

Evidence:
- Config file: `~/.codeium/windsurf/mcp_config.json`.
- Root key: `mcpServers`.
- Local stdio shape: `{ "command": "...", "args": [...], "env": {...} }`.
- Remote HTTP shape: `{ "serverUrl": ".../mcp", "headers": {...} }`; docs also mention `url`.
- Transports: `stdio`, Streamable HTTP, and SSE; OAuth is supported for each transport.
- Interpolation: `${env:VAR_NAME}` and `${file:/path/to/file}` are supported in
  `command`, `args`, `env`, `serverUrl`, `url`, and `headers`.

ToolPin mapping:
- Local packages can map directly to `mcpServers.<name>.command/args/env`.
- Remote servers should prefer `serverUrl` for Streamable HTTP because that is the
  documented remote example, with headers under `headers`.
- Placeholder strategy should use `${env:VAR_NAME}` for secrets, not `<VAR_NAME>`.

Open implementation questions:
- Project-level config was not documented in the primary source. Treat Windsurf as
  global-only until a project-scoped path is verified.
- Need a manual smoke test in Windsurf/Cascade after write support lands.

### Cline

Status: **implemented for global writes; project path still gated**.

Source: https://docs.cline.bot/mcp/mcp-overview

Evidence:
- CLI config file: `~/.cline/mcp.json`.
- IDE extension opens its MCP settings JSON from the MCP Servers Configure tab.
- Root key: `mcpServers`.
- Local stdio shape: `command`, `args`, `env`, plus Cline-specific `disabled` and
  `autoApprove`.
- Remote shape: `type: "streamableHttp"`, `url`, `headers`, `disabled`, `autoApprove`.
- Docs say omitting `type` defaults to legacy SSE; use explicit `streamableHttp`
  for modern remote servers.

ToolPin mapping:
- Local packages can map directly to `mcpServers.<name>.command/args/env`.
- Remote servers should use `type: "streamableHttp"` and `url`.
- Default generated entries should set `disabled: false` and `autoApprove: []`.

Open implementation questions:
- Primary docs do not name a project-level config path for the extension. Treat Cline
  as global-only until project config is verified.
- No official env interpolation syntax is documented on this page; emit explicit
  placeholders until secret brokering exists.

### Continue

Status: **implemented for global writes; project/profile paths still gated**.

Sources:
- https://docs.continue.dev/guides/understanding-configs
- https://docs.continue.dev/reference
- https://docs.continue.dev/customize/deep-dives/mcp-examples

Evidence:
- Local user config file: `~/.continue/config.yaml` on macOS/Linux,
  `%USERPROFILE%\.continue\config.yaml` on Windows.
- Root key: `mcpServers`, but it is a YAML list, not an object map.
- Config requires `name`, `version`, and `schema` top-level fields.
- Local stdio shape: list item with `name`, `command`, optional `args`, `env`, `cwd`,
  `connectionTimeout`.
- Remote examples use `type: sse` or `type: streamable-http`, `url`, and sometimes
  `apiKey`.
- Examples use secret references like `${{ secrets.GITHUB_TOKEN }}`.

ToolPin mapping:
- Use the existing `yaml` dependency rather than ad hoc text manipulation.
- Preserve the rest of `config.yaml`; add/update an entry in the `mcpServers` array
  by matching `name`.
- If creating a new file, include at minimum:
  `name: ToolPin Config`, `version: 1.0.0`, `schema: v1`, and `mcpServers: []`.
- Secret placeholders should use `${{ secrets.VAR_NAME }}`.

Open implementation questions:
- Continue documentation mentions global local config clearly. Workspace/profile
  directories have changed over time and should not be targeted until primary docs
  explicitly document current project-scoped behavior.

### Gemini CLI

Status: **implemented for project and global writes**.

Source: https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html

Evidence:
- Config file: `settings.json`.
- `gemini mcp add --scope` writes to user config `~/.gemini/settings.json` or project
  config `.gemini/settings.json`.
- Root key: `mcpServers`.
- Local stdio shape: `command`, `args`, `env`, `cwd`, `timeout`, `trust`.
- Remote shape: `url` for SSE, `httpUrl` for streamable HTTP, `headers`.
- Env interpolation supports `$VAR_NAME` and `${VAR_NAME}`.
- CLI transport names are `stdio`, `sse`, and `http`.

ToolPin mapping:
- Project scope should write `.gemini/settings.json`; global scope should write
  `~/.gemini/settings.json`.
- Local packages map to `mcpServers.<name>.command/args/env`.
- Remote streamable HTTP should map to `httpUrl`; SSE maps to `url`.
- Secret placeholders should use `$VAR_NAME` or `${VAR_NAME}`. Prefer `${VAR_NAME}`
  for clarity and consistency.

Open implementation questions:
- Confirm whether `httpUrl` is still the correct key after any future Gemini CLI
  remote-transport changes before implementation.

### Zed

Status: **config export implemented; install path still gated**.

Source: https://zed.dev/docs/ai/mcp

Evidence:
- Zed writes custom server configuration into its settings file, opened with
  `zed: open settings file`.
- Root key: `context_servers`, not `mcpServers`.
- Local stdio shape: `{ "command": "...", "args": [...], "env": {} }`.
- Remote shape: `{ "url": "https://example.com/mcp", "headers": {...} }`.
- If a remote server lacks an `Authorization` header, Zed prompts for standard MCP
  OAuth.
- Zed reloads tool lists on `notifications/tools/list_changed`.
- Agent tool approval is controlled by `agent.tool_permissions.default`.

ToolPin mapping:
- Local packages map to `context_servers.<name>.command/args/env`.
- Remote servers map to `context_servers.<name>.url/headers`.
- This should be a global settings write unless a project-specific Zed settings path
  is verified.

Open implementation questions:
- The MCP page names "settings file" but not the platform path. Do not hard-code
  `~/.config/zed/settings.json` from memory; verify the path from Zed settings docs
  or by asking Zed to open it before implementing global writes.
- No official env interpolation syntax is documented on the MCP page.

### Roo Code

Status: **implemented for project writes; global path still gated**.

Source: https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/

Evidence:
- Global configuration: `mcp_settings.json`.
- Project configuration: `.roo/mcp.json` in the project root.
- Project configuration takes precedence over global config for duplicate server names.
- Root key: `mcpServers`.
- Local stdio shape: `command`, `args`, `cwd`, `env`, `alwaysAllow`, `disabled`,
  `timeout`, `watchPaths`, `disabledTools`.
- Stdio args can reference system environment variables with `${env:VARIABLE_NAME}`.
- Remote Streamable HTTP shape: `type: "streamable-http"`, `url`, `headers`,
  `alwaysAllow`, `disabled`, `timeout`, `disabledTools`.
- SSE is supported as legacy transport.

ToolPin mapping:
- Project scope should write `.roo/mcp.json`.
- Global scope should write the Roo-opened `mcp_settings.json`; the primary docs name
  the file but do not expose a platform path, so global write should be gated until
  path discovery is implemented or verified.
- Default generated entries should include `disabled: false`.
- Secret placeholders currently emit `<VAR_NAME>` (ToolPin's generic default) for both
  `args` and `env` values; Roo's docs document `${env:VAR_NAME}` runtime substitution
  for args, which ToolPin does not yet specialize.

Open implementation questions:
- Verify the platform-specific global `mcp_settings.json` path before adding global
  write support.

## Implementation order

1. Verify the remaining unverified paths so their fail-closed writes can land: Roo
   Code global `mcp_settings.json` and Zed project/global settings file.
2. Add one test per client for local, remote, env placeholder, merge, remove, and doctor.

## Do not implement yet

- Global Roo Code writes until the global `mcp_settings.json` path is verified.
- Global Zed writes until the settings file path is verified from primary Zed docs or
  a local `zed: open settings file` check.
- Workspace Continue profiles under `.continue/configs`, `.continue/agents`, or
  `.continue/mcpServers` until current primary docs stabilize and document the behavior.
