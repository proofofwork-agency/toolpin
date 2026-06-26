# Disclaimer — No Warranty; You Assume All Risk

This document supplements (it does not replace) the
[Apache License, Version 2.0](LICENSE), in particular its warranty disclaimer
(§7) and limitation of liability (§8). Where anything here conflicts with
applicable law that cannot be excluded, the law wins and this document applies
only to the maximum extent permitted.

## You are running third-party code

ToolPin's purpose is to install, configure, and help launch **MCP servers written
by other people** — from npm, PyPI, Docker/OCI registries, `.mcpb` bundles,
remote HTTP services, and directories such as the official MCP registry, Docker
MCP Catalog, Smithery, and Glama.

**That code can read your files, access your network, and use any credentials you
give it.** It may be malicious, vulnerable, or simply buggy. ToolPin does not
sandbox, gate, or monitor what an installed server does once it runs. You — not
ToolPin, not its maintainers — are responsible for deciding what to install,
where it runs, and what it can touch.

## The trust score and "verified" tier are not safety guarantees

- The **trust score** summarizes declared, self-attested publisher metadata. It
  can be gamed and it does not certify that a server is safe.
- The **`verified`** tier means certain automated evidence checks passed
  (for example, an OCI registry manifest digest resolved, an MCPB bundle hash
  matched, or an npm tarball's integrity matched). It does **not** mean the
  server is safe, trustworthy, free of vulnerabilities, or built by a known,
  reputable identity.
- ToolPin does **not** perform full-image byte recomputation, sigstore/cosign
  identity proof, build provenance (SLSA) verification, or prompt-injection
  detection. Advisory scans are advisory, not blockers.

Treat the score and tier as signals that help a human review, never as a green
light. The single most reliable safety control is **you**, plus running
untrusted servers in a container, VM, or other isolated environment with no
access to production credentials.

## No warranty

To the maximum extent permitted by law, ToolPin and all related materials are
provided **"AS IS"** and **"AS AVAILABLE,"** without warranty or condition of any
kind — express, implied, or statutory — including any warranty of
merchantability, fitness for a particular purpose, title, non-infringement,
accuracy, or that the software will be error-free, uninterrupted, secure, or
achieve any particular result.

## Limitation of liability

To the maximum extent permitted by law, in no event will the ToolPin maintainers
or contributors be liable for any indirect, incidental, special, consequential,
exemplary, or punitive damages, or any loss of profits, data, business, or
goodwill, arising out of or related to ToolPin or any server installed through
it, however caused and under any theory of liability (contract, tort, negligence,
strict liability, or otherwise), even if advised of the possibility of such
damages.

To the maximum extent permitted by law, the total aggregate liability of the
maintainers and contributors for all claims arising out of or related to ToolPin
is limited to the greater of (a) the amounts you paid for ToolPin, if any, and
(b) USD $1. Because ToolPin is distributed free of charge, this means liability
is limited to the minimum permitted by applicable law.

## Indemnification

You agree, to the maximum extent permitted by law, to indemnify, defend, and hold
harmless the ToolPin maintainers and contributors from and against any claims,
damages, losses, or expenses (including reasonable legal fees) arising out of
your use or misuse of ToolPin, your installation or execution of any third-party
MCP server, or your violation of these terms or any third-party rights or laws.

## Your responsibilities

- **Review before you run.** Read what a server is and who published it. Do not
  rely on the score or tier alone.
- **Isolate untrusted servers.** Prefer containers, VMs, or restricted accounts.
  Never hand production credentials to a server you have not vetted.
- **Keep `toolpin ci`, policy gates, and `--require-verified` on** in any shared
  repository so drift is caught.
- **Comply with the licenses of every server and dependency** you install;
  ToolPin's Apache-2.0 license does not extend to them.

## Acceptance

By installing, copying, using, distributing, or contributing to ToolPin, you
acknowledge that you have read and understood this disclaimer, the
[license](LICENSE), and the [threat model](docs/threat-model.md), and you accept
all associated risks. If you do not accept these terms, do not use ToolPin.

## This is not legal advice and is not a lawyer

This document is a plain-English risk disclaimer, not legal advice. It does not
waive any rights that applicable law does not allow to be waived (for example,
certain consumer-protection rights, or liability for gross negligence, willful
misconduct, or fraud in some jurisdictions). If you need certainty about your
particular situation or jurisdiction, consult a qualified lawyer.
