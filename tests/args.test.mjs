import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitRawArgumentString } from "../plugins/codex/scripts/lib/args.mjs";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs collects bare positional tokens", () => {
  const { options, positionals } = parseArgs(["foo", "bar", "baz"]);
  assert.deepEqual(options, {});
  assert.deepEqual(positionals, ["foo", "bar", "baz"]);
});

test("parseArgs recognises a boolean flag", () => {
  const { options, positionals } = parseArgs(["--wait"], {
    booleanOptions: ["wait"]
  });
  assert.equal(options.wait, true);
  assert.deepEqual(positionals, []);
});

test("parseArgs recognises an inline-value boolean flag set to false", () => {
  const { options } = parseArgs(["--wait=false"], {
    booleanOptions: ["wait"]
  });
  assert.equal(options.wait, false);
});

test("parseArgs recognises an inline-value boolean flag set to a non-false string", () => {
  const { options } = parseArgs(["--wait=yes"], {
    booleanOptions: ["wait"]
  });
  assert.equal(options.wait, true);
});

test("parseArgs reads a value option from the next token", () => {
  const { options, positionals } = parseArgs(["--base", "main", "extra"], {
    valueOptions: ["base"]
  });
  assert.equal(options.base, "main");
  assert.deepEqual(positionals, ["extra"]);
});

test("parseArgs reads a value option supplied as --key=value", () => {
  const { options } = parseArgs(["--base=main"], {
    valueOptions: ["base"]
  });
  assert.equal(options.base, "main");
});

test("parseArgs throws when a value option is missing its argument", () => {
  assert.throws(
    () => parseArgs(["--base"], { valueOptions: ["base"] }),
    /Missing value for --base/
  );
});

test("parseArgs resolves long-option aliases", () => {
  const { options } = parseArgs(["--bg"], {
    booleanOptions: ["background"],
    aliasMap: { bg: "background" }
  });
  assert.equal(options.background, true);
});

test("parseArgs handles a short boolean flag via aliasMap", () => {
  const { options } = parseArgs(["-w"], {
    booleanOptions: ["wait"],
    aliasMap: { w: "wait" }
  });
  assert.equal(options.wait, true);
});

test("parseArgs handles a short value flag via aliasMap", () => {
  const { options } = parseArgs(["-b", "main"], {
    valueOptions: ["base"],
    aliasMap: { b: "base" }
  });
  assert.equal(options.base, "main");
});

test("parseArgs throws when a short value flag is missing its argument", () => {
  assert.throws(
    () => parseArgs(["-b"], { valueOptions: ["base"], aliasMap: { b: "base" } }),
    /Missing value for -b/
  );
});

test("parseArgs treats everything after -- as positional", () => {
  const { options, positionals } = parseArgs(["--wait", "--", "--not-a-flag", "pos"], {
    booleanOptions: ["wait"]
  });
  assert.equal(options.wait, true);
  assert.deepEqual(positionals, ["--not-a-flag", "pos"]);
});

test("parseArgs treats unknown long flags as positionals", () => {
  const { positionals } = parseArgs(["--unknown-flag"]);
  assert.deepEqual(positionals, ["--unknown-flag"]);
});

test("parseArgs treats a bare - as a positional (stdin convention)", () => {
  const { positionals } = parseArgs(["-"]);
  assert.deepEqual(positionals, ["-"]);
});

test("parseArgs handles multiple flags and positionals together", () => {
  const { options, positionals } = parseArgs(
    ["--scope", "working-tree", "--wait", "src/app.js"],
    { valueOptions: ["scope"], booleanOptions: ["wait"] }
  );
  assert.equal(options.scope, "working-tree");
  assert.equal(options.wait, true);
  assert.deepEqual(positionals, ["src/app.js"]);
});

// ---------------------------------------------------------------------------
// splitRawArgumentString
// ---------------------------------------------------------------------------

test("splitRawArgumentString splits on whitespace", () => {
  assert.deepEqual(splitRawArgumentString("foo bar baz"), ["foo", "bar", "baz"]);
});

test("splitRawArgumentString ignores leading and trailing whitespace", () => {
  assert.deepEqual(splitRawArgumentString("  foo  bar  "), ["foo", "bar"]);
});

test("splitRawArgumentString handles double-quoted tokens with spaces", () => {
  assert.deepEqual(splitRawArgumentString('"hello world" next'), ["hello world", "next"]);
});

test("splitRawArgumentString handles single-quoted tokens with spaces", () => {
  assert.deepEqual(splitRawArgumentString("'hello world' next"), ["hello world", "next"]);
});

test("splitRawArgumentString handles backslash-escaped spaces", () => {
  assert.deepEqual(splitRawArgumentString("hello\\ world next"), ["hello world", "next"]);
});

test("splitRawArgumentString handles trailing backslash as literal backslash", () => {
  assert.deepEqual(splitRawArgumentString("foo\\"), ["foo\\"]);
});

test("splitRawArgumentString returns empty array for empty string", () => {
  assert.deepEqual(splitRawArgumentString(""), []);
});

test("splitRawArgumentString returns empty array for whitespace-only string", () => {
  assert.deepEqual(splitRawArgumentString("   "), []);
});

test("splitRawArgumentString handles adjacent quoted tokens", () => {
  assert.deepEqual(splitRawArgumentString('"a b""c d"'), ["a bc d"]);
});

test("splitRawArgumentString handles backslash-escaped quote inside unquoted token", () => {
  assert.deepEqual(splitRawArgumentString('say\\"hi'), ['say"hi']);
});
