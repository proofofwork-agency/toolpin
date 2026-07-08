# Design: Input-Schema Tool-Surface Pinning

Status: approved design, ready to implement (transform/standard-v1).
Implements the rug-pull defense hardening from the transformation plan; the
spec-side contract is `docs/spec/mcp-lockfile-v1.md` §5.

## Why

Today ToolPin pins the live tool surface as `toolDescriptionHash` over
`{name, description}` pairs. A server can keep names and descriptions stable
while changing a tool's **input schema** — e.g. adding a `notes` parameter the
model will happily fill with conversation content, or widening a `path` enum.
NSA/OWASP guidance prescribes hashing tool definitions; APM-style file pinning
cannot see this surface at all. Covering `inputSchema` closes the gap and is
ToolPin's sharpest differentiator.

## What changes

### 1. Capture (`src/capabilities.ts`, `src/tester.ts`)

- The live `tools/list` probe already receives each tool's `inputSchema`;
  capture it alongside name/description.
- New lockfile field on `capabilityManifest`: `toolSurfaceHash`:

```json
{
  "algorithm": "sha256",
  "coverage": ["name", "description", "inputSchema"],
  "value": "<hex, same encoding as existing tool hashes>",
  "toolCount": 12,
  "generatedAt": "…"
}
```

- Hash input: tools sorted by `name` (UTF-16 code-unit order); each record is
  an object with exactly the coverage fields (omit a field the server did not
  return rather than writing null); serialize with the **existing
  `src/canonicalJson.ts`** (NOT the spec's RFC 8785 — lockfile v2 stays
  internally consistent; the v2→spec-v1 mapping is documented in the spec's
  profile section). No pruning: schema internals are meaning-bearing bytes.
- `generatedAt` is normalized out of drift comparison exactly like
  `toolDescriptionHash.generatedAt` (`plan.ts` normalize helpers).

### 2. Persistence and compatibility (`src/plan.ts`)

- `toolSurfaceHash` is an **additive optional field**. lockfileVersion stays 2;
  the parser accepts entries without it (all existing locks stay valid).
- Entry integrity and whole-lock digest cover it when present (it flows through
  `integrityPayload` like the existing capability fields — verify with a
  regression test that adding the field changes the digest).

### 3. Drift rules (`src/plan.ts` compare + `ci`)

Ordered by precedence:

1. Both sides have `toolSurfaceHash` with equal `coverage` → compare `value`;
   mismatch = drift ("tool input schemas changed").
2. Locked coverage ⊃ current coverage (a re-probe produced narrower coverage,
   or an update tries to drop `inputSchema`) → **drift, fail closed**
   ("tool surface coverage downgraded"). Coverage may only widen via
   `--update-lock`.
3. Locked has only legacy `toolDescriptionHash` → compare legacy hashes as
   today (no forced migration), but `toolpin ci` prints one advisory line:
   "surface pin covers name+description only; re-lock with --update-lock to
   pin input schemas."
4. Neither side has a surface pin → current behavior (no surface check).

### 4. Verdict interaction (`src/verdict.ts`)

- Legacy-only pin (case 3) is a `needs-review` **reason** in passive contexts
  ("input schemas not pinned"), never a `blocked`.
- Surface drift in `ci`/`verify`/`install` contexts is fatal → `blocked`.

### 5. Tests

- Unit: hash stability (tool order permutation → same value; schema mutation →
  different value; field omitted vs null distinct); coverage-downgrade drift;
  legacy fallback comparison; digest regression (field covered by integrity).
- Fixture: extend the drift E2E fixture (test/mcpDrift.test.js pattern) with a
  probe whose inputSchema changes between lock and ci.

## Non-goals

- No output-schema/behavioral pinning (a later coverage value).
- No lockfileVersion bump, no changes to existing `toolDescriptionHash`
  producers/consumers beyond the advisory line.
- No spec-v1 writer — that lands with the migration plan.
