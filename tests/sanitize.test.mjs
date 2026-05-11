import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeFilenamesForPrompt } from "../plugins/codex/scripts/lib/prompt-sanitize.mjs";

test("sanitizeFilenamesForPrompt returns a JSON string for a plain filename", () => {
  // Given: ['plain-file.ts']
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  '"plain-file.ts"' と一致する
  const input = ["plain-file.ts"];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out, '"plain-file.ts"');
});

test("sanitizeFilenamesForPrompt escapes C0 control chars and ANSI escape bytes", () => {
  // Given: ['evil\x07\x1b[31mred.ts']
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  '"evil\\u0007\\u001b[31mred.ts"' と一致する
  const input = ["evil\x07\x1b[31mred.ts"];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out, '"evil\\u0007\\u001b[31mred.ts"');
});

test("sanitizeFilenamesForPrompt escapes bidi override characters", () => {
  // Given: ['evil‮reversed.ts']
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  '"evil\\u202ereversed.ts"' と一致する
  const input = ["evil‮reversed.ts"];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out, '"evil\\u202ereversed.ts"');
});

test("sanitizeFilenamesForPrompt escapes zero-width and BOM characters", () => {
  // Given: ['evil​zws‍zwj﻿bom.ts']
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  '"evil\\u200bzws\\u200dzwj\\ufeffbom.ts"' と一致する
  const input = ["evil​zws‍zwj﻿bom.ts"];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out, '"evil\\u200bzws\\u200dzwj\\ufeffbom.ts"');
});

test("sanitizeFilenamesForPrompt truncates long filenames and preserves JSON parsing", () => {
  // Given: ['x'.repeat(600)]
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  JSON.parse 可能で復号後の string length が 513 で末尾が … になる
  const input = ["x".repeat(600)];

  const out = sanitizeFilenamesForPrompt(input);
  const decoded = JSON.parse(out);

  assert.equal(decoded.length, 513);
  assert.equal(decoded.endsWith("…"), true);
});

test("sanitizeFilenamesForPrompt returns an empty string for non-array inputs", () => {
  // Given: null / 'not-array' / undefined
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  '' と一致する
  assert.equal(sanitizeFilenamesForPrompt(null), "");
  assert.equal(sanitizeFilenamesForPrompt("not-array"), "");
  assert.equal(sanitizeFilenamesForPrompt(undefined), "");
});
