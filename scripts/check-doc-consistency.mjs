import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const files = [
  "README.md",
  "docs/threat-model.md",
  "docs/strategy-and-moat.md",
  "docs/ROADMAP.md",
  "docs/SAAS_ROADMAP.md",
  "docs/how-to/catch-drift-in-ci.md",
  "docs/site/how-to/catch-drift-in-ci.md",
  "docs/site/reference/lockfile-schema.md",
  "docs/site/reference/policy-schema.md",
  "docs/site/reference/cli.md",
  "docs/site/tutorials/install-first-server.md",
  "docs/site/concepts/trust-explained.md",
  "docs/site/concepts/threat-model.md",
  "docs/site/concepts/comparison.md",
];

const forbidden = [
  "Excluded from the integrity payload.",
  "`sha256-...` over timestamp-insensitive entry contents.",
  "The whole-lock digest from `toolpin lock digest` excludes timestamps",
  "It does not perform byte-level OCI image or MCPB bundle verification.",
  "ToolPin never downloads and verifies OCI image or MCPB bundle bytes.",
  "Presence only \u2014 \"x\" passes; bytes are not downloaded and matched.",
  "ToolPin does not re-fetch artifacts and recompute bytes.",
  "No download-and-recompute for OCI or\n  MCPB",
  "no byte recompute yet",
  "non-empty `fileSha256`",
  "from local files or HTTP URLs",
  "from a local file or HTTP URL",
  "from file or HTTP",
  "by file/HTTP",
  "npm, PyPI, NuGet, and\nCargo package targets are checked for declared exact versions and drift only",
  "npm/PyPI/NuGet/Cargo artifact integrity, OCI image byte recomputation",
  "registry attestations",
  "attestation_verified",
  "toolpin lock sign --key private.pem",
  "toolpin lock verify-signature --key public.pem",
];

const requiredByFile = new Map([
  [
    "docs/site/reference/lockfile-schema.md",
    [
      "including entry timestamps such as `resolvedAt`",
      "excludes only top-level file\nmetadata timestamps",
    ],
  ],
  [
    "docs/site/reference/cli.md",
    [
      "OCI verification requires a valid digest\npin and best-effort resolves the registry manifest digest",
      "the bundle is available from a code-allowlisted HTTPS artifact host",
      "trusted npm tarball bytes. PyPI, NuGet, and Cargo targets",
    ],
  ],
  [
    "docs/site/concepts/trust-explained.md",
    [
      "`npm_integrity_verified`",
      "ToolPin read MCPB bytes from a code-allowlisted HTTPS artifact host",
      "Guarantee MCPB byte verification when the bundle is unavailable from a\n  code-allowlisted HTTPS artifact host",
    ],
  ],
  [
    "README.md",
    [
      "toolpin ci --live --verify",
      "Use `--skip-live-verification` only as an explicit downgrade",
      "npm tarball SRI verification",
      "recompute MCPB SHA-256 only for allowlisted HTTPS artifact hosts",
    ],
  ],
  [
    "docs/how-to/catch-drift-in-ci.md",
    [
      "toolpin lock sign --policy .toolpin/policy.json --key private.pem",
      "toolpin lock verify-signature --policy .toolpin/policy.json --key public.pem",
    ],
  ],
  [
    "docs/site/how-to/catch-drift-in-ci.md",
    [
      "toolpin lock sign --policy .toolpin/policy.json --key private.pem",
      "toolpin lock verify-signature --policy .toolpin/policy.json --key public.pem",
    ],
  ],
  [
    "docs/site/reference/cli.md",
    [
      "toolpin lock sign --policy .toolpin/policy.json --key private.pem",
      "toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem",
    ],
  ],
]);

let failed = false;

function fail(message) {
  console.error(message);
  failed = true;
}

for (const file of files) {
  const text = await readFile(new URL(file, root), "utf8");
  for (const phrase of forbidden) {
    if (text.includes(phrase)) {
      fail(`${file}: stale public claim found: ${JSON.stringify(phrase)}`);
    }
  }
  for (const phrase of requiredByFile.get(file) ?? []) {
    if (!text.includes(phrase)) {
      fail(`${file}: expected consistency claim missing: ${JSON.stringify(phrase)}`);
    }
  }
}

const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const versionSource = await readFile(new URL("src/version.ts", root), "utf8");
const versionLiteral = `TOOLPIN_VERSION = "${packageJson.version}"`;
if (!versionSource.includes(versionLiteral)) {
  fail(`src/version.ts: TOOLPIN_VERSION does not match package.json version ${packageJson.version}`);
}

const readme = await readFile(new URL("README.md", root), "utf8");
const actionVersion = `proofofwork-agency/toolpin@v${packageJson.version}`;
if (!readme.includes(actionVersion)) {
  fail(`README.md: expected GitHub Action example to use ${actionVersion}`);
}

if (failed) {
  process.exit(1);
}

console.log("Public docs/schema consistency checks passed.");
