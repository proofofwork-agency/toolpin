# ToolPin adoption candidate list (draft)

Status: local draft only. Do not open issues, pull requests, or outreach
messages from this list until after a tagged ToolPin release and explicit human
launch approval.

Research date: 2026-07-09. Evidence was collected with `gh repo view` and
GitHub contents checks for MCP config, lockfiles, CI workflows, and contribution
files. Re-check every row before contacting a maintainer.

## Policy

- Promotion is opt-in only. Do not send unsolicited automated PRs to
  third-party repositories.
- Awesome-list PRs wait until the npm package and GitHub Action tag are
  released.
- Design-partner outreach must be personalized and should ask maintainers if
  they want help adopting ToolPin.
- Auto-add ToolPin only in organization-owned repos or repos where maintainers
  explicitly approve a PR.
- For repos with `mcp-lock.json`, recommend adding the ToolPin workflow.
- For repos with only `.mcp.json` or client config, do not synthesize a
  lockfile blindly. Ask maintainers to run the lock/adopt flow locally.

## Reviewable candidates

| Repo | Type | MCP evidence | CI evidence | Recent activity | Contact / contribution evidence | Recommended action |
|---|---|---|---|---|---|---|
| `punkpeye/awesome-mcp-servers` | Awesome/listing PR | Not applicable; listing target. | `.github/workflows/` present. | Pushed 2026-07-04; updated 2026-07-09; ~90.5k stars. | `CONTRIBUTING.md` present. | After release approval, prepare one listing PR in the repo's exact contribution format. |
| `Puliczek/awesome-mcp-security` | Awesome/listing PR | Not applicable; listing target. | No workflow found in contents check. | Pushed 2026-03-03; updated 2026-07-09; ~720 stars. | `CONTRIBUTING.md` present. | After release approval, prepare a security-tooling listing PR if contribution rules allow it. |
| `appcypher/awesome-mcp-servers` | Awesome/listing PR | Not applicable; listing target. | No workflow found in contents check. | Pushed 2026-05-06; updated 2026-07-09; ~5.7k stars. | `CONTRIBUTING.md` present. | After release approval, verify category placement and open one listing PR. |
| `wong2/awesome-mcp-servers` | Awesome/listing PR | Not applicable; listing target. | `.github/workflows/` present. | Pushed 2026-07-03; updated 2026-07-09; ~4.2k stars. | `.github/pull_request_template.md` present. | After release approval, prepare a concise listing PR following the template. |
| `Automattic/wp-calypso` | Design partner | `.mcp.json` and `.vscode/mcp.json` present; no `mcp-lock.json` found. | `.github/workflows/` present. | Pushed 2026-07-09; updated 2026-07-09; ~12.6k stars. | `.github/PULL_REQUEST_TEMPLATE.md` and `SECURITY.md` present. | Personalized outreach only. Ask whether they want to run `toolpin adopt`/`toolpin init ci`; do not open an adoption PR without approval. |
| `Khan/wonder-blocks` | Design partner | `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` present; no `mcp-lock.json` found. | `.github/workflows/` present. | Pushed 2026-07-08; updated 2026-07-08; ~162 stars. | No contribution file found in checked paths. | Personalized outreach only; ask for maintainer-approved adoption flow. |
| `Doist/todoist-mcp` | Design partner | `.mcp.json` and `.cursor/mcp.json` present; no `mcp-lock.json` found. | `.github/workflows/` present. | Pushed 2026-07-08; updated 2026-07-08; ~524 stars. | `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md` present. | Strong design-partner seed. Ask maintainers whether they want help locking their own MCP server repo. |
| `confluentinc/mcp-confluent` | Design partner | `.mcp.json` and `.vscode/mcp.json` present; no `mcp-lock.json` found. | No workflow found in contents check. | Pushed 2026-07-08; updated 2026-07-08; ~164 stars. | `CONTRIBUTING.md`, `.github/pull_request_template.md`, and `SECURITY.md` present. | Outreach should start with whether they want CI protection; adoption may require adding CI first. |

## PR body notes for issue #7

- Include `Closes #7`.
- State that ToolPin's own runtime moves to Node.js 24 LTS.
- State that target projects do not need to move their app/test runtime to
  Node 24 when using the Action, because the Action sets up its own Node
  runtime. Recommend a separate ToolPin job or a final CI step for projects
  still testing on Node 18, 20, or 22.
- State that repository promotion/adoption is opt-in only and no third-party
  PRs should be automated from this candidate list.
