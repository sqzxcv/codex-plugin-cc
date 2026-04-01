import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { interpolateTemplate, loadPromptTemplate } from "../plugins/codex/scripts/lib/prompts.mjs";
import { makeTempDir } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// interpolateTemplate
// ---------------------------------------------------------------------------

test("interpolateTemplate replaces a single variable", () => {
  const result = interpolateTemplate("Hello, {{NAME}}!", { NAME: "Codex" });
  assert.equal(result, "Hello, Codex!");
});

test("interpolateTemplate replaces multiple distinct variables", () => {
  const result = interpolateTemplate("{{GREETING}}, {{NAME}}!", {
    GREETING: "Hi",
    NAME: "World"
  });
  assert.equal(result, "Hi, World!");
});

test("interpolateTemplate replaces the same variable appearing multiple times", () => {
  const result = interpolateTemplate("{{X}} and {{X}}", { X: "codex" });
  assert.equal(result, "codex and codex");
});

test("interpolateTemplate leaves an unrecognised placeholder as empty string", () => {
  const result = interpolateTemplate("prefix {{MISSING}} suffix", {});
  assert.equal(result, "prefix  suffix");
});

test("interpolateTemplate does not replace lowercase placeholders (only ALL_CAPS)", () => {
  const result = interpolateTemplate("{{lower}} {{UPPER}}", { lower: "no", UPPER: "yes" });
  assert.equal(result, "{{lower}} yes");
});

test("interpolateTemplate handles an empty template", () => {
  assert.equal(interpolateTemplate("", { X: "value" }), "");
});

test("interpolateTemplate handles a template with no placeholders", () => {
  const template = "No placeholders here.";
  assert.equal(interpolateTemplate(template, { X: "value" }), template);
});

test("interpolateTemplate handles a variable whose value contains braces", () => {
  const result = interpolateTemplate("{{BLOCK}}", { BLOCK: "{{inner}}" });
  assert.equal(result, "{{inner}}");
});

// ---------------------------------------------------------------------------
// loadPromptTemplate
// ---------------------------------------------------------------------------

test("loadPromptTemplate loads a prompt file by name", () => {
  const dir = makeTempDir();
  const promptsDir = path.join(dir, "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.writeFileSync(path.join(promptsDir, "my-prompt.md"), "# My Prompt\n\n{{CONTEXT}}\n", "utf8");

  const content = loadPromptTemplate(dir, "my-prompt");
  assert.equal(content, "# My Prompt\n\n{{CONTEXT}}\n");
});

test("loadPromptTemplate throws when the prompt file does not exist", () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  assert.throws(() => loadPromptTemplate(dir, "nonexistent"));
});
