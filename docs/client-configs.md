# Client Config Research

Last verified: 2026-06-25.

This file is the gate for adding new clients to `src/config.ts`, `src/install.ts`,
`src/cli.ts`, and `src/tui.tsx`. A client should not be added to `PROJECT_CLIENTS`
until its path, root key, transport shape, and secret interpolation semantics are
verified here from primary documentation.

## Current supported clients

| Client | Current MPM status | Notes |
|--------|--------------------|-------|
| Claude / Cursor / generic | Implemented as `mcpServers` JSON | Generic project `.mcp.json` behavior. |
| VS Code | Implemented as `servers` JSON | Project `.vscode/mcp.json`, global user MCP JSON. |
| Codex | Implemented as TOML | Project `.codex/config.toml`, global `~/.codex/config.toml`, `[mcp_servers.<name>]`. |
| OpenCode | Implemented as `mcp` JSON | Project `opencode.json`, global `~/.config/opencode/opencode.json`. |

## Next-wave candidates

### Windsurf / Cascade

Status: **ready to implement**.

Source: https://docs.devin.ai/desktop/cascade/mcp

Evidence:
- Config file: `~/.codeium/windsurf/mcp_config.json`.
- Root key: `mcpServers`.
- Local stdio shape: `{ "command": "...", "args": [...], "env": {...} }`.
- Remote HTTP shape: `{ "serverUrl": ".../mcp", "headers": {...} }`; docs also mention `url`.
- Transports: `stdio`, Streamable HTTP, and SSE; OAuth is supported for each transport.
- Interpolation: `${env:VAR_NAME}` and `${file:/path/to/file}` are supported in
  `command`, `args`, `env`, `serverUrl`, `url`, and `headers`.

MPM mapping:
- Local packages can map directly to `mcpServers.<name>.command/args/env`.
- Remote servers should prefer `serverUrl` for Streamable HTTP because that is the
  documented remote example, with headers under `headers`.
- Placeholder strategy should use `${env:VAR_NAME}` for secrets, not `<VAR_NAME>`.

Open implementation questions:
- Project-level config was not documented in the primary source. Treat Windsurf as
  global-only until a project-scoped path is verified.
- Need a manual smoke test in Windsurf/Cascade after write support lands.

### Cline

Status: **ready to implement**.

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

MPM mapping:
- Local packages can map directly to `mcpServers.<name>.command/args/env`.
- Remote servers should use `type: "streamableHttp"` and `url`.
- Default generated entries should set `disabled: false` and `autoApprove: []`.

Open implementation questions:
- Primary docs do not name a project-level config path for the extension. Treat Cline
  as global-only until project config is verified.
- No official env interpolation syntax is documented on this page; emit explicit
  placeholders until secret brokering exists.

### Continue

Status: **ready to implement carefully**.

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

MPM mapping:
- Use the existing `yaml` dependency rather than ad hoc text manipulation.
- Preserve the rest of `config.yaml`; add/update an entry in the `mcpServers` array
  by matching `name`.
- If creating a new file, include at minimum:
  `name: MPM Config`, `version: 1.0.0`, `schema: v1`, and `mcpServers: []`.
- Secret placeholders should use `${{ secrets.VAR_NAME }}`.

Open implementation questions:
- Continue documentation mentions global local config clearly. Workspace/profile
  directories have changed over time and should not be targeted until primary docs
  explicitly document current project-scoped behavior.
- Continue's repository/docs status should be checked before shipping code because
  the docs currently say the repository is read-only and recommend Continue CLI for
  JetBrains.

### Gemini CLI

Status: **ready to implement**.

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

MPM mapping:
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

Status: **ready to implement with path caveat**.

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

MPM mapping:
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

Status: **ready to implement**.

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

MPM mapping:
- Project scope should write `.roo/mcp.json`.
- Global scope should write the Roo-opened `mcp_settings.json`; the primary docs name
  the file but do not expose a platform path, so global write should be gated until
  path discovery is implemented or verified.
- Default generated entries should include `disabled: false`.
- Secret placeholders in args should use `${env:VAR_NAME}` where Roo expects runtime
  substitution; env object values may remain direct placeholders until the secret
  broker exists.

Open implementation questions:
- Verify the platform-specific global `mcp_settings.json` path before adding global
  write support.

## Implementation order

1. Add schema metadata in a data table rather than expanding switch statements.
2. Add client config serializers for object-map clients first:
   Windsurf, Cline, Gemini CLI, Zed, Roo project scope.
3. Add Continue after YAML merge/update tests are in place.
4. Add global path discovery for clients whose docs expose UI-opened files but not
   stable platform paths.
5. Add one test per client for local, remote, env placeholder, merge, remove, and doctor.

## Do not implement yet

- Global Roo Code writes until the global `mcp_settings.json` path is verified.
- Global Zed writes until the settings file path is verified from primary Zed docs or
  a local `zed: open settings file` check.
- Workspace Continue profiles under `.continue/configs`, `.continue/agents`, or
  `.continue/mcpServers` until current primary docs stabilize and document the behavior.
