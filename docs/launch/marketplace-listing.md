# GitHub Marketplace listing copy

> Prereqs: `branding:` block in action.yml (lane 4), tagged release.

**Name:** ToolPin CI — MCP lockfile drift gate

**Categories:** Security, Continuous integration

**Short description (125 chars max):**
Fail the build when a locked MCP server drifts — artifact, registry metadata,
tool surface, or client config.

**Long description:**

Your repo's MCP servers are dependencies that can change behavior without a
version bump: tool descriptions and input schemas are read live by the agent
on every connection. ToolPin CI enforces a committed `mcp-lock.json`:

- **Artifact integrity** — npm SRI, OCI digest, MCPB hash evidence.
- **Tool-surface pinning** — names, descriptions, and input schemas hashed at
  lock time; the build fails when they change (rug-pull defense).
- **Config drift** — the generated client config still matches what was
  reviewed (`doctor`).
- **Policy** — allowlists, minimum verification requirements, signature checks
  (ed25519, optional).
- **SARIF output** for the GitHub Security tab.

Setup:

```yaml
- uses: proofofwork-agency/toolpin@v0.4
  with:
    strict: true
```

Or scaffold everything (workflow + starter policy) locally:

```
npx @proofofwork-agency/toolpin init ci
```

Read-only by design: CI never mutates your lockfile. Fails closed on
ambiguity. Apache-2.0.
