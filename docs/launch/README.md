# Launch Kit (DRAFTS — do not publish until the human says go)

Everything in this directory is a local draft. Nothing here is published,
posted, or PR'd anywhere until explicitly approved.

## Channel sequence (evidence-based, from the 2026-07 research pass)

1. **GitHub Marketplace listing** for the Action — Dependabot's growth
   inflection was Marketplace; the Action is the product's distribution vehicle.
   Prereq: `branding:` block in action.yml (lane 4), tagged release, npm publish.
2. **Incident-anchored content** — the zizmor lesson: enterprises adopt CI
   security gates after incidents. Anchor posts on postmark-mcp, CVE-2025-6514,
   and the NSA/OWASP guidance that prescribes exactly this control.
3. **Awesome-list PRs** (`awesome-mcp-servers`, `awesome-mcp-security`) — low
   cost, durable discovery.
4. **Show HN** — after the 30-second README flow is real (init ci lands).
5. **Design partners** — 3 repos using MCP in CI; measure whether they keep
   `toolpin ci` green after week 1.

## Success metrics (from the transformation plan)

- External repos committing `mcp-lock.json`.
- Repos running the Action in CI.
- `toolpin init ci` completion rate; time-to-protected < 5 minutes.
- Kill/park criterion: no external CI adoption within 2 quarters of public
  launch → reassess.

## Files

- `show-hn.md` — Show HN post draft.
- `awesome-list-prs.md` — target lists + entry lines.
- `marketplace-listing.md` — GitHub Marketplace copy.
- `design-partners.md` — shortlist criteria + outreach template.
