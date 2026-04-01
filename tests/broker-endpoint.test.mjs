import test from "node:test";
import assert from "node:assert/strict";

import { createBrokerEndpoint, parseBrokerEndpoint } from "../plugins/codex/scripts/lib/broker-endpoint.mjs";

test("createBrokerEndpoint uses Unix sockets on non-Windows platforms", () => {
  const endpoint = createBrokerEndpoint("/tmp/cxc-12345", "darwin");
  assert.equal(endpoint, "unix:/tmp/cxc-12345/broker.sock");
  assert.deepEqual(parseBrokerEndpoint(endpoint), {
    kind: "unix",
    path: "/tmp/cxc-12345/broker.sock"
  });
});

test("createBrokerEndpoint uses named pipes on Windows", () => {
  const endpoint = createBrokerEndpoint("C:\\\\Temp\\\\cxc-12345", "win32");
  assert.equal(endpoint, "pipe:\\\\.\\pipe\\cxc-12345-codex-app-server");
  assert.deepEqual(parseBrokerEndpoint(endpoint), {
    kind: "pipe",
    path: "\\\\.\\pipe\\cxc-12345-codex-app-server"
  });
});

// ---------------------------------------------------------------------------
// parseBrokerEndpoint — error cases
// ---------------------------------------------------------------------------

test("parseBrokerEndpoint throws for an empty string", () => {
  assert.throws(() => parseBrokerEndpoint(""), /Missing broker endpoint/);
});

test("parseBrokerEndpoint throws for a null/undefined value", () => {
  assert.throws(() => parseBrokerEndpoint(null), /Missing broker endpoint/);
  assert.throws(() => parseBrokerEndpoint(undefined), /Missing broker endpoint/);
});

test("parseBrokerEndpoint throws for an unsupported scheme", () => {
  assert.throws(
    () => parseBrokerEndpoint("tcp://localhost:1234"),
    /Unsupported broker endpoint/
  );
});

test("parseBrokerEndpoint throws when a pipe: endpoint has no path", () => {
  assert.throws(
    () => parseBrokerEndpoint("pipe:"),
    /Broker pipe endpoint is missing its path/
  );
});

test("parseBrokerEndpoint throws when a unix: endpoint has no path", () => {
  assert.throws(
    () => parseBrokerEndpoint("unix:"),
    /Broker Unix socket endpoint is missing its path/
  );
});

// ---------------------------------------------------------------------------
// createBrokerEndpoint — Linux platform
// ---------------------------------------------------------------------------

test("createBrokerEndpoint uses Unix socket on Linux", () => {
  const endpoint = createBrokerEndpoint("/tmp/cxc-linux", "linux");
  assert.equal(endpoint, "unix:/tmp/cxc-linux/broker.sock");
  assert.deepEqual(parseBrokerEndpoint(endpoint), {
    kind: "unix",
    path: "/tmp/cxc-linux/broker.sock"
  });
});
