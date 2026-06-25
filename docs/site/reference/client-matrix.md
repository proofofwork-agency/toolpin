---
title: Client Matrix
---

# Client matrix

ToolPin writes MCP config in the format each client expects. Some clients have
verified project or global paths; others intentionally fail closed until their
path is documented.

| Client | Project scope | Global scope | Format | Notes |
|---|---:|---:|---|---|
| Claude | Yes | No | JSON `mcpServers` | Global config is managed by the Claude CLI; export JSON and add it with `claude mcp add-json --scope user`. |
| Cursor | Yes | Yes | JSON `mcpServers` | Project `.cursor/mcp.json`; global `~/.cursor/mcp.json`. |
| Generic | Yes | Sidecar | JSON `mcpServers` | For clients that import a generic project `.mcp.json`. |
| VS Code | Yes | Yes | JSON `servers` | Project `.vscode/mcp.json`; user MCP JSON globally. |
| Codex | Yes | Yes | TOML `[mcp_servers.<name>]` | Project must be trusted by Codex before config loads. |
| OpenCode | Yes | Yes | JSON `mcp` | Restart OpenCode after global config changes. |
| Windsurf/Cascade | No | Yes | JSON `mcpServers` | Project path is not documented. |
| Cline | No | Yes | JSON `mcpServers` | Project path is not documented. |
| Continue | No | Yes | YAML `mcpServers` list | Project/profile paths are gated until docs stabilize. |
| Gemini CLI | Yes | Yes | JSON `mcpServers` | Uses `.gemini/settings.json` for project scope. |
| Zed | Export only | Export only | JSON `context_servers` | Settings path is not verified yet. |
| Roo Code | Yes | No | JSON `mcpServers` | Global path is gated until verified. |

Sidecar means ToolPin writes under `~/.config/toolpin/` because the client does
not expose a stable global path that ToolPin can safely target. ToolPin does
not write sidecars for client-specific entries when a real path is known or
when direct writes are unsafe.

`--client all` targets every supported client for the requested scope and skips
or fails closed for clients whose path is not verified.
