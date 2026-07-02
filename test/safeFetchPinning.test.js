import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { safeFetch } from "../dist/safeFetch.js";

// Flattens an error and its `cause` chain into one string. undici's fetch
// wraps connection failures ("TypeError: fetch failed") around the underlying
// dispatcher error, so the pinning refusal surfaces in the cause chain.
function messageChain(error) {
  const parts = [];
  for (let current = error; current; current = current.cause) {
    parts.push(String(current.message ?? current));
  }
  return parts.join(" | ");
}

test("safeFetch refuses a DNS answer that rebinds to a private address at connect time", async () => {
  let calls = 0;
  const flipping = async () => {
    calls += 1;
    // First resolution (assertSafeUrl preflight) looks public; the answer then
    // flips to the cloud metadata address for the connection itself.
    return calls === 1
      ? [{ address: "203.0.113.7", family: 4 }]
      : [{ address: "169.254.169.254", family: 4 }];
  };

  await assert.rejects(
    safeFetch("https://rebind.invalid/latest/meta-data", { lookup: flipping, timeoutMs: 5000 }),
    (error) => {
      const chain = messageChain(error);
      assert.match(chain, /private or reserved/i);
      assert.match(chain, /connect time/);
      return true;
    },
  );
  assert.ok(calls >= 2, `expected a second, connect-time resolution; saw ${calls} lookup call(s)`);
});

test("safeFetch connects through the pinned connect-time lookup", async () => {
  const server = http.createServer((request, response) => {
    response.end("pinned ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  let lookups = 0;
  const local = async () => {
    lookups += 1;
    return [{ address: "127.0.0.1", family: 4 }];
  };

  try {
    // `.invalid` never resolves in real DNS, so a 200 here proves the socket
    // was built from the injected pinned lookup, not an independent resolution.
    const response = await safeFetch(`http://pinned.invalid:${port}/`, {
      allowHttp: true,
      allowPrivateHosts: true,
      lookup: local,
      timeoutMs: 5000,
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "pinned ok");
    assert.ok(lookups >= 1, "expected the connection to resolve through the injected lookup");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("safeFetch refuses when every rebound address is private, even with mixed answers", async () => {
  let calls = 0;
  const flipping = async () => {
    calls += 1;
    return calls === 1
      ? [{ address: "93.184.216.34", family: 4 }]
      : [
          { address: "10.0.0.8", family: 4 },
          { address: "192.168.1.20", family: 4 },
        ];
  };

  await assert.rejects(
    safeFetch("https://rebind-multi.invalid/", { lookup: flipping, timeoutMs: 5000 }),
    (error) => /private or reserved/i.test(messageChain(error)),
  );
});
