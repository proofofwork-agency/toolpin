# Design partner program (3 repos)

## Who qualifies

- Active repo using MCP servers in a team context (committed `.mcp.json`,
  `.cursor/mcp.json`, or equivalent — findable via GitHub code search).
- Runs CI on PRs today.
- At least 2 maintainers (a solo hobby repo won't exercise the review-gate
  workflow).

## What we ask of them

1. Run `toolpin init ci` (or add the 5-line Action) on one repo.
2. Keep it enabled for 30 days.
3. One 20-minute call or async thread at day 7 and day 30.

## What we measure (the only KPIs that matter)

- Did setup take under 5 minutes end-to-end? Where did it stall?
- Is `toolpin ci` still enabled and green at day 30?
- Did a real drift event fire? Was the failure message enough to fix it
  without reading our docs?
- Would removing it feel like losing a safety net or losing a nuisance?

## Outreach template (issue/DM — personalize the first line)

> Hi — I saw [repo] commits its MCP config for [clients]. We built ToolPin, a
> lockfile + CI gate for MCP servers (pins artifact hashes and the live tool
> surface — names/descriptions/input schemas — and fails CI on drift; the
> control NSA/OWASP recommend for MCP but nothing implements). We're looking
> for 3 design partners before public launch: `toolpin init ci`, 30 days, two
> short check-ins, and we fix whatever you hit within days. Interested?

## Where to find candidates

- GitHub code search: `path:mcp-lock.json`, `path:.mcp.json`,
  `path:.cursor/mcp.json` filtered to repos with recent CI activity.
- MCP community Discord/forum threads complaining about config drift or
  server trust (the mcp-sentiment research doc has the pain-point threads).
