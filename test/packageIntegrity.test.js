import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyNpmPackageIntegrity } from "../dist/packageIntegrity.js";

const lookup = async () => [{ address: "93.184.216.34" }];

test("verifyNpmPackageIntegrity passes when tarball bytes match sha512 SRI", async () => {
  const tarball = Buffer.from("npm package bytes");
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  const result = await verifyNpmPackageIntegrity({ identifier: "@example/server", version: "1.0.0" }, {
    lookup,
    fetch: fetchMap({
      "https://registry.npmjs.org/%40example%2Fserver": packument({
        integrity,
        tarball: "https://registry.npmjs.org/@example/server/-/server-1.0.0.tgz",
      }),
      "https://registry.npmjs.org/@example/server/-/server-1.0.0.tgz": new Response(tarball),
    }),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.expected, integrity);
  assert.equal(result.trustedAnchor, true);
  assert.equal(result.trustAnchor, "registry.npmjs.org");
});

test("verifyNpmPackageIntegrity fails on SRI mismatch", async () => {
  const result = await verifyNpmPackageIntegrity({ identifier: "example-server", version: "1.0.0" }, {
    lookup,
    fetch: fetchMap({
      "https://registry.npmjs.org/example-server": packument({ integrity: `sha512-${Buffer.from("expected").toString("base64")}` }),
      "https://registry.npmjs.org/example-server/-/example-server-1.0.0.tgz": new Response("different"),
    }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.issueCode, "npm_integrity_mismatch");
  assert.match(result.actual, /^sha512-/);
});

test("verifyNpmPackageIntegrity fails when exact version is missing", async () => {
  const result = await verifyNpmPackageIntegrity({ identifier: "example-server", version: "2.0.0" }, {
    lookup,
    fetch: fetchMap({
      "https://registry.npmjs.org/example-server": jsonResponse({ versions: {} }),
    }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.issueCode, "npm_version_missing");
});

test("verifyNpmPackageIntegrity fails when dist.integrity is missing", async () => {
  const result = await verifyNpmPackageIntegrity({ identifier: "example-server", version: "1.0.0" }, {
    lookup,
    fetch: fetchMap({
      "https://registry.npmjs.org/example-server": jsonResponse({
        versions: {
          "1.0.0": {
            dist: { tarball: "https://registry.npmjs.org/example-server/-/example-server-1.0.0.tgz" },
          },
        },
      }),
    }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.issueCode, "npm_integrity_missing");
});

test("verifyNpmPackageIntegrity rejects untrusted tarball hosts", async () => {
  const result = await verifyNpmPackageIntegrity({ identifier: "example-server", version: "1.0.0" }, {
    lookup,
    fetch: fetchMap({
      "https://registry.npmjs.org/example-server": packument({
        integrity: `sha512-${Buffer.from("expected").toString("base64")}`,
        tarball: "https://downloads.example.test/example-server.tgz",
      }),
    }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.issueCode, "npm_tarball_untrusted");
  assert.equal(result.trustedAnchor, false);
});

function packument({ integrity, tarball = "https://registry.npmjs.org/example-server/-/example-server-1.0.0.tgz" }) {
  return jsonResponse({
    versions: {
      "1.0.0": {
        dist: { integrity, tarball },
      },
    },
  });
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function fetchMap(responses) {
  return async (url) => {
    const key = String(url);
    const response = responses[key];
    if (!response) throw new Error(`Unexpected fetch ${key}`);
    return response.clone();
  };
}
