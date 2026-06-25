import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const canonicalUrl = new URL("registry/v0/servers", root);
const websiteUrl = new URL("website/static/registry/v0/servers", root);

const canonical = await readJson(canonicalUrl);
const website = await readJson(websiteUrl);

const errors = [];

if (stableJson(canonical) !== stableJson(website)) {
  errors.push("registry/v0/servers and website/static/registry/v0/servers must stay identical.");
}

validateRegistry(canonical, "registry/v0/servers", errors);

if (errors.length) {
  for (const error of errors) console.error(`curated registry check: ${error}`);
  process.exit(1);
}

console.log(`Curated registry OK: ${canonical.servers.length} server entr${canonical.servers.length === 1 ? "y" : "ies"}.`);

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
  if (metadata.count !== undefined && metadata.count !== value.servers.length) {
    output.push(`${label} metadata.count must equal servers.length.`);
  }
  if (metadata.total !== undefined && metadata.total !== value.servers.length) {
    output.push(`${label} metadata.total must equal servers.length.`);
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
