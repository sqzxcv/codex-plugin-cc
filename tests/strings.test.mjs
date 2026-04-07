import test from "node:test";
import assert from "node:assert/strict";

import { stripAnsi } from "../plugins/codex/scripts/lib/strings.mjs";

test("stripAnsi removes bracketed paste mode sequences", () => {
  assert.equal(stripAnsi('\x1b[?2004h{"id":1}'), '{"id":1}');
  assert.equal(stripAnsi('{"id":1}\x1b[?2004l'), '{"id":1}');
});

test("stripAnsi removes SGR color codes", () => {
  assert.equal(stripAnsi('\x1b[0m{"id":1}\x1b[1;31m'), '{"id":1}');
});

test("stripAnsi removes OSC sequences (BEL terminated)", () => {
  assert.equal(stripAnsi('\x1b]0;title\x07{"id":1}'), '{"id":1}');
});

test("stripAnsi removes OSC sequences (ST terminated)", () => {
  assert.equal(stripAnsi('\x1b]0;title\x1b\\{"id":1}'), '{"id":1}');
});

test("stripAnsi passes through clean JSON unchanged", () => {
  const json = '{"jsonrpc":"2.0","id":1,"method":"initialize"}';
  assert.equal(stripAnsi(json), json);
});

test("stripAnsi handles empty string", () => {
  assert.equal(stripAnsi(""), "");
});

test("stripAnsi handles multiple escape sequences in one line", () => {
  assert.equal(
    stripAnsi('\x1b[?2004h\x1b[0m{"id":1}\x1b[?2004l'),
    '{"id":1}'
  );
});
