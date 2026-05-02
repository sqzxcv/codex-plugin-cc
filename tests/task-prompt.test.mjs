import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { readTaskPrompt } from "../plugins/codex/scripts/lib/task-prompt.mjs";
import { makeTempDir } from "./helpers.mjs";

test("happy path — relative prompt-file inside cwd is read and returned", () => {
  const cwd = makeTempDir();
  fs.writeFileSync(path.join(cwd, "prompt.txt"), "hello from file");
  const result = readTaskPrompt(cwd, { "prompt-file": "prompt.txt" }, []);
  assert.equal(result, "hello from file");
});

test("happy path — absolute path inside cwd is accepted", () => {
  const cwd = makeTempDir();
  const filePath = path.join(cwd, "prompt.txt");
  fs.writeFileSync(filePath, "absolute path content");
  const result = readTaskPrompt(cwd, { "prompt-file": filePath }, []);
  assert.equal(result, "absolute path content");
});

test("rejection — relative path escaping cwd throws", () => {
  const inside = makeTempDir();
  const outside = makeTempDir();
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const outsideBase = path.basename(outside);
  assert.throws(
    () => readTaskPrompt(inside, { "prompt-file": `../${outsideBase}/secret.txt` }, []),
    /must be (a path )?inside/i
  );
});

test("rejection — absolute path outside cwd throws", () => {
  const inside = makeTempDir();
  const outside = makeTempDir();
  const secretPath = path.join(outside, "secret.txt");
  fs.writeFileSync(secretPath, "secret");
  assert.throws(
    () => readTaskPrompt(inside, { "prompt-file": secretPath }, []),
    /must be (a path )?inside/i
  );
});

test("rejection — symlink inside cwd pointing outside cwd throws", {
  skip: process.platform === "win32"
}, () => {
  const inside = makeTempDir();
  const outside = makeTempDir();
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(inside, "link.txt"));
  assert.throws(
    () => readTaskPrompt(inside, { "prompt-file": "link.txt" }, []),
    /must be (a path )?inside/i
  );
});

test("fallback — no prompt-file uses positional args joined with space", () => {
  const cwd = makeTempDir();
  const result = readTaskPrompt(cwd, {}, ["hello", "world"]);
  assert.equal(result, "hello world");
});

test("fallback — no prompt-file and no positionals returns empty string when stdin is a TTY", {
  skip: !process.stdin.isTTY
}, () => {
  const cwd = makeTempDir();
  const result = readTaskPrompt(cwd, {}, []);
  assert.equal(result, "");
});
