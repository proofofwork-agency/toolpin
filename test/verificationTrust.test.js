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
