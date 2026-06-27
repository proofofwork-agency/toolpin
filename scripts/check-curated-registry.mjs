import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const canonicalUrl = new URL("registry/v0/servers", root);
const websiteUrl = new URL("website/static/registry/v0/servers", root);

const canonical = await readJson(canonicalUrl);
const website = await readJson(websiteUrl);

const errors = [];
const CLIENT_SUPPORT_META = "dev.toolpin/clientSupport";
const CLIENT_SUPPORT_STATUSES = new Set(["toolpin-installable", "external-setup", "unsupported"]);

if (stableJson(canonical) !== stableJson(website)) {
  errors.push("registry/v0/servers and website/static/registry/v0/servers must stay identical.");
}

validateRegistry(canonical, "registry/v0/servers", errors);
await validateGithubEnforcement(canonical, "registry/v0/servers", errors);

if (errors.length) {
  for (const error of errors) console.error(`curated registry check: ${error}`);
  process.exit(1);
}

console.log(`${canonical.metadata?.status === "scaffold" ? "Registry scaffold" : "Curated registry"} OK: ${canonical.servers.length} server entr${canonical.servers.length === 1 ? "y" : "ies"}.`);

async function readJson(url) {
  const raw = await readFile(url, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateRegistry(value, label, output) {
  if (!isRecord(value)) {
    output.push(`${label} must be a JSON object.`);
    return;
  }
  if (!Array.isArray(value.servers)) {
    output.push(`${label} must include a servers array.`);
    return;
  }

  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const isScaffold = metadata.status === "scaffold";
  if (metadata.count !== undefined && metadata.count !== value.servers.length) {
    output.push(`${label} metadata.count must equal servers.length.`);
  }
  if (metadata.total !== undefined && metadata.total !== value.servers.length) {
    output.push(`${label} metadata.total must equal servers.length.`);
  }
  if (value.servers.length === 0 && !isScaffold) {
    output.push(`${label} must not be empty unless metadata.status is "scaffold".`);
  }
  if (isScaffold && value.servers.length !== 0) {
    output.push(`${label} metadata.status scaffold is only valid while servers is empty.`);
  }

  const keys = new Set();
  for (const [index, entry] of value.servers.entries()) {
    validateEntry(entry, `${label} servers[${index}]`, output);
    const server = isRecord(entry) ? entry.server : undefined;
    if (isRecord(server)) {
      const key = `${server.name}@${server.version}`;
      if (keys.has(key)) output.push(`${label} contains duplicate server version ${key}.`);
      keys.add(key);
    }
  }
}

function validateEntry(entry, label, output) {
  if (!isRecord(entry)) {
    output.push(`${label} must be an object.`);
    return;
  }
  if (!isRecord(entry.server)) {
    output.push(`${label}.server must be an object.`);
    return;
  }

  const server = entry.server;
  for (const field of ["name", "version"]) {
    if (typeof server[field] !== "string" || server[field].length === 0) {
      output.push(`${label}.server.${field} is required.`);
    }
  }
  if (typeof server.title !== "string" || server.title.length === 0) {
    output.push(`${label}.server.title is required for curated entries.`);
  }
  if (typeof server.description !== "string" || server.description.length === 0) {
    output.push(`${label}.server.description is required for curated entries.`);
  }
  if (!isRecord(server.repository) || typeof server.repository.url !== "string" || server.repository.url.length === 0) {
    output.push(`${label}.server.repository.url is required for curated entries.`);
  }

  const packages = Array.isArray(server.packages) ? server.packages : [];
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  if (packages.length === 0 && remotes.length === 0) {
    output.push(`${label} must include at least one package or remote install target.`);
  }
  for (const [packageIndex, pkg] of packages.entries()) {
    if (!isRecord(pkg)) {
      output.push(`${label}.server.packages[${packageIndex}] must be an object.`);
      continue;
    }
    if (typeof pkg.registryType !== "string" || !pkg.registryType) {
      output.push(`${label}.server.packages[${packageIndex}].registryType is required.`);
    }
    if (typeof pkg.identifier !== "string" || !pkg.identifier) {
      output.push(`${label}.server.packages[${packageIndex}].identifier is required.`);
    }
    if (!isRecord(pkg.transport) || typeof pkg.transport.type !== "string" || !pkg.transport.type) {
      output.push(`${label}.server.packages[${packageIndex}].transport.type is required.`);
    }
  }
  for (const [remoteIndex, remote] of remotes.entries()) {
    if (!isRecord(remote)) {
      output.push(`${label}.server.remotes[${remoteIndex}] must be an object.`);
      continue;
    }
    if (typeof remote.type !== "string" || !remote.type) {
      output.push(`${label}.server.remotes[${remoteIndex}].type is required.`);
    }
    if (typeof remote.url !== "string" || !remote.url.startsWith("https://")) {
      output.push(`${label}.server.remotes[${remoteIndex}].url must be HTTPS.`);
    }
  }

  const curation = readCuration(entry);
  if (!curation) {
    output.push(`${label} must include _meta[\"dev.toolpin/curation\"].`);
    return;
  }
  if (curation.status !== "reviewed") {
    output.push(`${label} curation.status must be reviewed.`);
  }
  for (const field of ["reviewedAt", "reviewedBy", "reason"]) {
    if (typeof curation[field] !== "string" || curation[field].length === 0) {
      output.push(`${label} curation.${field} is required.`);
    }
  }
  if (!Array.isArray(curation.riskNotes)) {
    output.push(`${label} curation.riskNotes must be an array.`);
  }
  if (!Array.isArray(curation.testedClients)) {
    output.push(`${label} curation.testedClients must be an array.`);
  }
  if (!["metadata-only", "digest-pinned", "byte-verified", "provenance-attested"].includes(curation.evidenceTier)) {
    output.push(`${label} curation.evidenceTier must be metadata-only, digest-pinned, byte-verified, or provenance-attested.`);
  }
  validateToolPinEnforcement(curation.toolpinEnforcement, label, output);
  validateClientSupport(entry, label, output);
}

function validateClientSupport(entry, label, output) {
  const support = entry?._meta?.[CLIENT_SUPPORT_META] ?? entry?.server?._meta?.[CLIENT_SUPPORT_META];
  if (!isRecord(support)) {
    output.push(`${label} must include _meta["${CLIENT_SUPPORT_META}"].`);
    return;
  }
  if (!CLIENT_SUPPORT_STATUSES.has(support.default)) {
    output.push(`${label} clientSupport.default must be toolpin-installable, external-setup, or unsupported.`);
  }
  if (!isRecord(support.clients)) {
    output.push(`${label} clientSupport.clients must be an object.`);
    return;
  }
  const server = entry.server;
  for (const [client, config] of Object.entries(support.clients)) {
    const clientLabel = `${label} clientSupport.clients.${client}`;
    validateClientSupportEntry(config, clientLabel, server, output);
  }
  if (support.default === "toolpin-installable" && !hasInstallTarget(server)) {
    output.push(`${label} clientSupport.default toolpin-installable requires package or remote install metadata.`);
  }
}

function validateClientSupportEntry(config, label, server, output) {
  if (!isRecord(config)) {
    output.push(`${label} must be an object.`);
    return;
  }
  if (!CLIENT_SUPPORT_STATUSES.has(config.status)) {
    output.push(`${label}.status must be toolpin-installable, external-setup, or unsupported.`);
    return;
  }
  if (config.installMode !== undefined && (typeof config.installMode !== "string" || !config.installMode)) {
    output.push(`${label}.installMode must be a non-empty string when present.`);
  }
  for (const field of ["requirements", "setupCommands"]) {
    if (config[field] !== undefined && (!Array.isArray(config[field]) || config[field].some((item) => typeof item !== "string" || !item))) {
      output.push(`${label}.${field} must be an array of non-empty strings when present.`);
    }
  }
  if (config.notes !== undefined && (typeof config.notes !== "string" || !config.notes)) {
    output.push(`${label}.notes must be a non-empty string when present.`);
  }
  if (config.status === "toolpin-installable") {
    if (!hasInstallTarget(server)) {
      output.push(`${label} is toolpin-installable but the server has no package or remote install metadata.`);
    }
    if (!config.installMode) {
      output.push(`${label}.installMode is required when status is toolpin-installable.`);
    }
  }
  if (config.status === "external-setup") {
    if (!Array.isArray(config.requirements) || config.requirements.length === 0) {
      output.push(`${label}.requirements is required when status is external-setup.`);
    }
    if (!Array.isArray(config.setupCommands) || config.setupCommands.length === 0) {
      output.push(`${label}.setupCommands is required when status is external-setup.`);
    }
    if (typeof config.notes !== "string" || !config.notes) {
      output.push(`${label}.notes is required when status is external-setup.`);
    }
  }
}

function hasInstallTarget(server) {
  return (Array.isArray(server?.packages) && server.packages.length > 0)
    || (Array.isArray(server?.remotes) && server.remotes.length > 0);
}

function validateToolPinEnforcement(enforcement, label, output) {
  if (!isRecord(enforcement)) {
    output.push(`${label} curation.toolpinEnforcement is required for curated entries.`);
    return;
  }
  if (!["enforced", "not-verified"].includes(enforcement.status)) {
    output.push(`${label} curation.toolpinEnforcement.status must be enforced or not-verified.`);
    return;
  }
  if (enforcement.status === "not-verified") {
    if (typeof enforcement.notes !== "string" || enforcement.notes.length === 0) {
      output.push(`${label} curation.toolpinEnforcement.notes is required when status is not-verified.`);
    }
    return;
  }
  for (const field of ["workflow", "requiredCheck", "protectedBranch"]) {
    if (typeof enforcement[field] !== "string" || enforcement[field].length === 0) {
      output.push(`${label} curation.toolpinEnforcement.${field} is required.`);
    }
  }
  if (enforcement.file !== undefined && (typeof enforcement.file !== "string" || enforcement.file.length === 0)) {
    output.push(`${label} curation.toolpinEnforcement.file must be a non-empty string when present.`);
  }
  if (enforcement.notes !== undefined && typeof enforcement.notes !== "string") {
    output.push(`${label} curation.toolpinEnforcement.notes must be a string when present.`);
  }
}

async function validateGithubEnforcement(registry, label, output) {
  if (!Array.isArray(registry.servers) || registry.servers.length === 0) return;
  const token = process.env.GITHUB_TOKEN;
  const claims = registry.servers
    .map((entry, index) => ({ entry, index, curation: readCuration(entry) }))
    .filter((item) => item.curation?.toolpinEnforcement?.status === "enforced");
  if (!claims.length) return;

  if (!token) {
    const message = `${label} has enforced toolpinEnforcement claims but GITHUB_TOKEN is not available for GitHub API validation.`;
    if (process.env.CI) output.push(message);
    else console.warn(`curated registry check: warning: ${message}`);
    return;
  }

  for (const claim of claims) {
    const server = claim.entry.server;
    const repo = githubRepo(server?.repository?.url);
    const enforcement = claim.curation.toolpinEnforcement;
    const entryLabel = `${label} servers[${claim.index}]`;
    if (!repo) {
      output.push(`${entryLabel} curation.toolpinEnforcement requires a GitHub repository URL for API validation.`);
      continue;
    }

    const branch = await githubJson(`https://api.github.com/repos/${repo.owner}/${repo.name}/branches/${encodeURIComponent(enforcement.protectedBranch)}`, token);
    if (!branch.ok) {
      output.push(`${entryLabel} protected branch ${enforcement.protectedBranch} could not be verified: ${branch.status} ${branch.statusText}.`);
      continue;
    }
    if (branch.body?.protected !== true) {
      output.push(`${entryLabel} protected branch ${enforcement.protectedBranch} is not protected according to GitHub.`);
    }

    const protection = await githubJson(`https://api.github.com/repos/${repo.owner}/${repo.name}/branches/${encodeURIComponent(enforcement.protectedBranch)}/protection`, token);
    if (!protection.ok) {
      output.push(`${entryLabel} branch protection details could not be verified: ${protection.status} ${protection.statusText}.`);
      continue;
    }
    const checks = requiredChecks(protection.body);
    if (!checks.includes(enforcement.requiredCheck)) {
      output.push(`${entryLabel} required check ${enforcement.requiredCheck} is not required on ${enforcement.protectedBranch}.`);
    }

    const workflowPath = String(enforcement.workflow).replace(/^\.github\/workflows\//, "");
    const workflow = await githubJson(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/.github/workflows/${encodeURIComponent(workflowPath)}?ref=${encodeURIComponent(enforcement.protectedBranch)}`, token);
    if (!workflow.ok) {
      output.push(`${entryLabel} workflow ${enforcement.workflow} could not be verified on ${enforcement.protectedBranch}: ${workflow.status} ${workflow.statusText}.`);
    }
  }
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { ok: response.ok, status: response.status, statusText: response.statusText, body };
}

function requiredChecks(protection) {
  const statusChecks = isRecord(protection?.required_status_checks) ? protection.required_status_checks : {};
  const contexts = Array.isArray(statusChecks.contexts) ? statusChecks.contexts.filter((item) => typeof item === "string") : [];
  const checks = Array.isArray(statusChecks.checks)
    ? statusChecks.checks.map((item) => isRecord(item) && typeof item.context === "string" ? item.context : undefined).filter(Boolean)
    : [];
  return [...new Set([...contexts, ...checks])];
}

function githubRepo(url) {
  if (typeof url !== "string") return undefined;
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
  return match ? { owner: match[1], name: match[2] } : undefined;
}

function readCuration(entry) {
  const entryMeta = isRecord(entry._meta) ? entry._meta : {};
  const serverMeta = isRecord(entry.server?._meta) ? entry.server._meta : {};
  const curation = entryMeta["dev.toolpin/curation"] ?? serverMeta["dev.toolpin/curation"];
  return isRecord(curation) ? curation : undefined;
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
