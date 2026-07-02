import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeUrl, safeFetch } from "../dist/safeFetch.js";
import { canonicalizeOciRef, trustedOciAuthHosts, trustedOciRegistry } from "../dist/verificationTrust.js";

const digest = `sha256:${"a".repeat(64)}`;

test("canonicalizeOciRef applies Docker Hub defaults", () => {
  assert.deepEqual(canonicalizeOciRef(`nginx@${digest}`), {
    host: "docker.io",
    repository: "library/nginx",
    digest,
  });
  assert.deepEqual(canonicalizeOciRef(`library/nginx@${digest}`), {
    host: "docker.io",
    repository: "library/nginx",
    digest,
  });
  assert.deepEqual(canonicalizeOciRef(`docker.io/library/nginx@${digest}`), {
    host: "docker.io",
    repository: "library/nginx",
    digest,
  });
  assert.deepEqual(canonicalizeOciRef(`registry-1.docker.io/library/nginx@${digest}`), {
    host: "docker.io",
    repository: "library/nginx",
    digest,
  });
});

test("trustedOciRegistry is code-owned", () => {
  assert.equal(trustedOciRegistry("ghcr.io"), true);
  assert.equal(trustedOciRegistry("evil.attacker.com"), false);
  assert.ok(trustedOciAuthHosts("docker.io").has("auth.docker.io"));
});

test("safeFetch blocks non-HTTPS and private hosts before fetching", async () => {
  await assert.rejects(() => safeFetch("http://example.com"), /non-HTTPS/);
  await assert.rejects(() => assertSafeUrl(new URL("https://127.0.0.1")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://localhost")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://169.254.169.254")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://[::1]")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://[fe80::1]")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://[fd00::1]")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://[::ffff:7f00:1]")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://[::ffff:a9fe:a9fe]")), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("https://[::7f00:1]")), /private or reserved/);
});

test("assertSafeUrl honors explicit http/private opt-ins for self-hosted registries", async () => {
  // Default posture: reject http and private hosts.
  await assert.rejects(() => assertSafeUrl(new URL("http://registry.internal/v0")), /non-HTTPS/);
  await assert.rejects(() => assertSafeUrl(new URL("https://10.0.0.5/v0")), /private or reserved/);

  // Opt-in relaxes exactly and only what was requested.
  await assert.doesNotReject(() => assertSafeUrl(new URL("https://10.0.0.5/v0"), { allowPrivateHosts: true }));
  await assert.doesNotReject(() => assertSafeUrl(new URL("http://10.0.0.5/v0"), { allowHttp: true, allowPrivateHosts: true }));
  // allowHttp alone still blocks a private host; allowPrivateHosts alone still blocks http.
  await assert.rejects(() => assertSafeUrl(new URL("http://10.0.0.5/v0"), { allowHttp: true }), /private or reserved/);
  await assert.rejects(() => assertSafeUrl(new URL("http://93.184.216.34/v0"), { allowPrivateHosts: true }), /non-HTTPS/);
});

test("safeFetch passes through only after the safety gate, honoring opt-ins", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  };
  // Blocked before fetch: fake fetch must never be called.
  await assert.rejects(() => safeFetch("https://169.254.169.254/meta", { fetch: fakeFetch }), /private or reserved/);
  assert.equal(calls.length, 0, "safeFetch must not reach the network for a blocked host");

  // Allowed with opt-in.
  const res = await safeFetch("http://10.1.2.3/registry", { fetch: fakeFetch, allowHttp: true, allowPrivateHosts: true });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["http://10.1.2.3/registry"]);
});
