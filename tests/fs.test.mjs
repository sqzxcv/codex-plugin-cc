import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureAbsolutePath,
  createTempDir,
  readJsonFile,
  writeJsonFile,
  safeReadFile,
  isProbablyText
} from "../plugins/codex/scripts/lib/fs.mjs";

import { makeTempDir } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// ensureAbsolutePath
// ---------------------------------------------------------------------------

test("ensureAbsolutePath returns an absolute path unchanged", () => {
  const absolute = "/usr/local/bin/codex";
  assert.equal(ensureAbsolutePath("/any/cwd", absolute), absolute);
});

test("ensureAbsolutePath resolves a relative path against cwd", () => {
  const cwd = makeTempDir();
  const result = ensureAbsolutePath(cwd, "subdir/file.txt");
  assert.equal(result, path.join(cwd, "subdir", "file.txt"));
  assert.equal(path.isAbsolute(result), true);
});

test("ensureAbsolutePath resolves a dot-relative path", () => {
  const cwd = makeTempDir();
  const result = ensureAbsolutePath(cwd, "./file.txt");
  assert.equal(result, path.resolve(cwd, "file.txt"));
});

// ---------------------------------------------------------------------------
// createTempDir
// ---------------------------------------------------------------------------

test("createTempDir creates an existing directory under os.tmpdir()", () => {
  const dir = createTempDir();
  assert.equal(fs.existsSync(dir), true);
  assert.equal(fs.statSync(dir).isDirectory(), true);
  assert.ok(dir.startsWith(os.tmpdir()));
  fs.rmdirSync(dir);
});

test("createTempDir respects a custom prefix", () => {
  const dir = createTempDir("my-prefix-");
  assert.ok(path.basename(dir).startsWith("my-prefix-"));
  fs.rmdirSync(dir);
});

// ---------------------------------------------------------------------------
// readJsonFile / writeJsonFile
// ---------------------------------------------------------------------------

test("writeJsonFile writes valid JSON and readJsonFile round-trips it", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "data.json");
  const payload = { hello: "world", count: 42, nested: { ok: true } };

  writeJsonFile(filePath, payload);
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.endsWith("\n"), "file should end with a newline");

  const parsed = readJsonFile(filePath);
  assert.deepEqual(parsed, payload);
});

test("readJsonFile throws on malformed JSON", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "bad.json");
  fs.writeFileSync(filePath, "{ not valid json }", "utf8");
  assert.throws(() => readJsonFile(filePath));
});

// ---------------------------------------------------------------------------
// safeReadFile
// ---------------------------------------------------------------------------

test("safeReadFile returns the file contents when the file exists", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "hello.txt");
  fs.writeFileSync(filePath, "hello codex\n", "utf8");
  assert.equal(safeReadFile(filePath), "hello codex\n");
});

test("safeReadFile returns empty string when the file does not exist", () => {
  const dir = makeTempDir();
  const missing = path.join(dir, "missing.txt");
  assert.equal(safeReadFile(missing), "");
});

// ---------------------------------------------------------------------------
// isProbablyText
// ---------------------------------------------------------------------------

test("isProbablyText returns true for an ASCII text buffer", () => {
  const buffer = Buffer.from("Hello, world!\n", "utf8");
  assert.equal(isProbablyText(buffer), true);
});

test("isProbablyText returns true for a UTF-8 text buffer without null bytes", () => {
  const buffer = Buffer.from("こんにちは世界\n", "utf8");
  assert.equal(isProbablyText(buffer), true);
});

test("isProbablyText returns false for a buffer containing a null byte", () => {
  const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  assert.equal(isProbablyText(buffer), false);
});

test("isProbablyText returns true for an empty buffer", () => {
  assert.equal(isProbablyText(Buffer.alloc(0)), true);
});

test("isProbablyText only samples the first 4096 bytes", () => {
  // Build a buffer that has a null byte only beyond the 4096-byte sample
  const safe = Buffer.alloc(4096, 0x61); // 'a' x 4096
  const withNull = Buffer.concat([safe, Buffer.from([0x00])]);
  assert.equal(isProbablyText(withNull), true);
});
