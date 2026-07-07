# Show HN draft

> Post only after: verdict collapse shipped, `toolpin init ci` shipped, README
> hero flow updated, npm + Action tagged. Keep the HN tone: concrete, honest
> about limits, no marketing language.

**Title:** Show HN: ToolPin – a lockfile and CI drift gate for MCP servers

**Body:**

MCP servers are code you wire into your agent with hand-edited JSON, and then
they change underneath you. postmark-mcp shipped a BCC backdoor in a patch
release. mcp-remote had a 9.6 RCE (CVE-2025-6514). And the quieter failure
mode: a server you approved on day 1 changes its tool descriptions or input
schemas on day 7, and your agent follows the new instructions — no PR, no
diff, nothing to review. NSA and OWASP both now tell you to pin MCP servers
and hash their tool surfaces; neither names a tool that does it.

ToolPin is that tool. It resolves a server from the official MCP registry (or
Docker's catalog), verifies what it can about the artifact (npm SRI, OCI
digest, MCPB hash), probes the live tool surface and hashes it — names,
descriptions, input schemas — writes correct config for your client (Claude
Code, Cursor, VS Code, Codex, and 8 others), and records all of it in a
committed `mcp-lock.json`. `toolpin ci` (or the GitHub Action) then fails your
build if anything drifts: artifact, registry metadata, tool surface, or the
config file itself.

What it deliberately is not: a scanner (it pins; scanners find bugs), a
runtime gateway (nothing sits between your agent and the server), or a
registry (it reads the official one). Verification is evidence-based and
honest about gaps — publisher-declared claims are labeled as claims, and the
verdict is three words: verified, needs-review, or blocked. `--explain` shows
the full evidence if you want it.

The lockfile format is a vendor-neutral draft spec (RFC 8785 canonicalization,
test vectors, JSON Schemas) — the goal is that other tools can read and
enforce the same file: [spec link]

Apache-2.0, TypeScript, 5 runtime deps, ~350 tests. I'd especially value
feedback on the spec's neutral core vs extensions split, and what would make
you actually commit a lockfile for your MCP servers.

https://github.com/proofofwork-agency/toolpin
