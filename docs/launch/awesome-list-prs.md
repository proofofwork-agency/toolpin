# Awesome-list PR drafts

> One PR per list, after npm + Action are tagged. Follow each list's
> contribution format exactly; these are the entry lines.

## Targets (verify category placement at PR time)

1. `punkpeye/awesome-mcp-servers` — utilities/tooling section.
2. `Puliczek/awesome-mcp-security` — supply-chain/tooling section.
3. `appcypher/awesome-mcp-servers` — utilities/tooling section.
4. `wong2/awesome-mcp-servers` — utilities/tooling section.
5. `modelcontextprotocol` community resources page, if contributions open.

Open these only after release/tag and explicit human launch approval. Use the
contribution format for each repository; do not batch or automate PRs.

## Entry line (tooling lists)

```
- [ToolPin](https://github.com/proofofwork-agency/toolpin) - Lockfile and CI
  drift gate for MCP servers: pins artifacts (npm SRI/OCI digest/MCPB hash)
  and live tool surfaces (names, descriptions, input schemas), writes client
  config for 12 clients, fails CI on drift. Apache-2.0.
```

## Entry line (security lists)

```
- [ToolPin](https://github.com/proofofwork-agency/toolpin) - Implements the
  NSA/OWASP-prescribed MCP control: pin server versions and hash tool
  surfaces, alert on drift. Committed mcp-lock.json + GitHub Action gate;
  vendor-neutral lockfile spec with test vectors. Apache-2.0.
```
