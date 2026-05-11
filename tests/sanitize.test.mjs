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

test("sanitizeFilenamesForPrompt escapes BMP invisible format characters", () => {
  // Given: filename containing U+00AD SOFT HYPHEN + U+061C ARABIC LETTER MARK + U+2060 WORD JOINER + U+FE0F variation selector
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  each invisible char becomes a \uXXXX escape and raw chars are absent from the output
  const input = [
    "a\u00adb\u061cc\u2060d\ufe0fe.ts"
  ];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out.includes("\u00ad"), false);
  assert.equal(out.includes("\u061c"), false);
  assert.equal(out.includes("\u2060"), false);
  assert.equal(out.includes("\ufe0f"), false);
  assert.equal(out.includes("\\u00ad"), true);
  assert.equal(out.includes("\\u061c"), true);
  assert.equal(out.includes("\\u2060"), true);
  assert.equal(out.includes("\\ufe0f"), true);
});

test("sanitizeFilenamesForPrompt escapes supplementary plane tag characters", () => {
  // Given: filename with U+E0001 LANGUAGE TAG (supplementary plane, requires code point iteration)
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  raw U+E0001 is absent and \u{e0001} extended escape literal is present
  const input = [String.fromCodePoint(0xe0001) + "hidden.ts"];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out.includes(String.fromCodePoint(0xe0001)), false);
  assert.equal(out.includes("\\u{e0001}"), true);
});

test("sanitizeFilenamesForPrompt escapes supplementary plane variation selectors", () => {
  // Given: filename with U+E0100 VARIATION SELECTOR-17
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  raw U+E0100 is absent and \u{e0100} extended escape literal is present
  const input = ["glyph" + String.fromCodePoint(0xe0100) + ".ts"];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out.includes(String.fromCodePoint(0xe0100)), false);
  assert.equal(out.includes("\\u{e0100}"), true);
});

test("sanitizeFilenamesForPrompt escapes lone surrogate halves", () => {
  // Given: filename with a lone high surrogate (U+D800) that would normally split a pair
  // When:  sanitizeFilenamesForPrompt(input)
  // Then:  raw surrogate code unit is absent and \ud800 escape literal is present
  const input = ["x\ud800y.ts"];

  const out = sanitizeFilenamesForPrompt(input);

  assert.equal(out.includes("\ud800"), false);
  assert.equal(out.includes("\\ud800"), true);
});
