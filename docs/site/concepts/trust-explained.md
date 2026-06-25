---
title: Trust Explained
---

# Trust explained

ToolPin trust is a deterministic review score over registry metadata and the
selected install target. It is designed to sort attention and enforce local
policy thresholds, not to certify that a server is safe to run.

## Signals

ToolPin scores signals such as:

- Repository metadata and namespace shape.
- Pinned package versions.
- OCI identifiers that include a digest pin.
- MCPB packages that declare `fileSha256`.
- HTTPS remote URLs.
- Missing install targets.
- Secret requirements declared by the registry.
- Legacy or risky transports.
- Advisory tool-description scan findings.

Critical issues can make an install fail closed. Warnings are surfaced for
human review and policy decisions.

## Verification boundaries

ToolPin checks registry metadata, declared integrity pins, and lockfile drift.
When `--verify` can reach a live server, it can hash normalized tool names and
descriptions from `tools/list` and store that hash in the lockfile.

ToolPin does not:

- Download OCI images and recompute the image digest.
- Download MCPB bundles and recompute `fileSha256`.
- Prove publisher identity with sigstore or provenance attestations.
- Detect prompt injection reliably.
- Sandbox a server after it starts.

Use the score as an install-time gate, then combine it with code review, branch
protection, runtime isolation, secret management, and client-side tool approval.
