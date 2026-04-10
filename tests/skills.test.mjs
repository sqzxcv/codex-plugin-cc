import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { listAvailableSkills, validateSkill } from "../plugins/codex/scripts/lib/skills.mjs";

/**
 * Create a minimal SKILL.md file in a directory.
 */
function writeSkillMd(dir, { name = "test-skill", description = "A test skill" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\nSkill content here.\n`
  );
}

test("listAvailableSkills returns empty array when directory does not exist", () => {
  const tmp = makeTempDir();
  const result = listAvailableSkills(path.join(tmp, "nonexistent"));
  assert.deepEqual(result, []);
});

test("listAvailableSkills returns empty array for empty skills directory", () => {
  const tmp = makeTempDir();
  fs.mkdirSync(path.join(tmp, "skills"));
  const result = listAvailableSkills(tmp);
  assert.deepEqual(result, []);
});

test("listAvailableSkills returns entries for valid skill directories", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  writeSkillMd(path.join(skillsDir, "alpha"), { description: "Alpha skill" });
  writeSkillMd(path.join(skillsDir, "beta"), { description: "Beta skill" });

  const result = listAvailableSkills(tmp);

  assert.equal(result.length, 2);
  assert.equal(result[0].name, "alpha");
  assert.equal(result[0].description, "Alpha skill");
  assert.equal(result[1].name, "beta");
  assert.equal(result[1].description, "Beta skill");
});

test("listAvailableSkills skips directories without SKILL.md", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  writeSkillMd(path.join(skillsDir, "valid-skill"), { description: "Valid" });
  fs.mkdirSync(path.join(skillsDir, "no-skill-file"));

  const result = listAvailableSkills(tmp);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "valid-skill");
});

test("listAvailableSkills returns empty description when SKILL.md has no frontmatter", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  const skillDir = path.join(skillsDir, "bare");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "Just some content without frontmatter.\n");

  const result = listAvailableSkills(tmp);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "bare");
  assert.equal(result[0].description, "");
});

test("listAvailableSkills follows symlinks", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  const realDir = path.join(tmp, "real-skill");
  writeSkillMd(realDir, { description: "Linked skill" });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.symlinkSync(realDir, path.join(skillsDir, "linked"));

  const result = listAvailableSkills(tmp);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "linked");
  assert.equal(result[0].description, "Linked skill");
});

test("listAvailableSkills deduplicates user skill over .system skill", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  const systemDir = path.join(skillsDir, ".system");

  writeSkillMd(path.join(systemDir, "shared"), { description: "System version" });
  writeSkillMd(path.join(skillsDir, "shared"), { description: "User version" });

  const result = listAvailableSkills(tmp);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "shared");
  assert.equal(result[0].description, "User version");
});

test("listAvailableSkills returns .system skills when no user override", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  writeSkillMd(path.join(skillsDir, ".system", "sys-skill"), { description: "System only" });

  const result = listAvailableSkills(tmp);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "sys-skill");
  assert.equal(result[0].description, "System only");
});

test("listAvailableSkills sorts results by name", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  writeSkillMd(path.join(skillsDir, "zulu"), { description: "Z" });
  writeSkillMd(path.join(skillsDir, "alpha"), { description: "A" });
  writeSkillMd(path.join(skillsDir, "mango"), { description: "M" });

  const result = listAvailableSkills(tmp);

  assert.deepEqual(
    result.map((s) => s.name),
    ["alpha", "mango", "zulu"]
  );
});

test("validateSkill returns skill info when skill exists", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  writeSkillMd(path.join(skillsDir, "my-skill"), { description: "My skill" });

  const result = validateSkill(tmp, "my-skill");

  assert.equal(result.entry.name, "my-skill");
  assert.equal(result.entry.description, "My skill");
  assert.ok(result.filePath);
  assert.match(result.filePath, /my-skill\/SKILL\.md$/);
});

test("validateSkill throws with available skills when skill not found", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  writeSkillMd(path.join(skillsDir, "exists"), { description: "Available" });

  assert.throws(
    () => validateSkill(tmp, "missing"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Skill "missing" not found/);
      assert.match(err.message, /exists/);
      return true;
    }
  );
});

test("validateSkill throws with '(none)' when no skills are available", () => {
  const tmp = makeTempDir();
  fs.mkdirSync(path.join(tmp, "skills"));

  assert.throws(
    () => validateSkill(tmp, "anything"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Skill "anything" not found/);
      assert.match(err.message, /\(none\)/);
      return true;
    }
  );
});

test("listAvailableSkills skips broken symlinks gracefully", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.symlinkSync("/nonexistent/path/broken-skill", path.join(skillsDir, "broken"));

  const result = listAvailableSkills(tmp);
  assert.deepEqual(result, []);
});

test("listAvailableSkills skips non-directory entries", () => {
  const tmp = makeTempDir();
  const skillsDir = path.join(tmp, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(path.join(skillsDir, "not-a-dir.txt"), "text file");
  writeSkillMd(path.join(skillsDir, "real-skill"), { description: "Real" });

  const result = listAvailableSkills(tmp);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "real-skill");
});

test("validateSkill rejects path traversal in skill name", () => {
  const tmp = makeTempDir();
  fs.mkdirSync(path.join(tmp, "skills"), { recursive: true });

  // ".." as standalone name
  assert.throws(
    () => validateSkill(tmp, ".."),
    /Invalid skill name/
  );

  // "." as standalone name
  assert.throws(
    () => validateSkill(tmp, "."),
    /Invalid skill name/
  );

  // ".." as a segment
  assert.throws(
    () => validateSkill(tmp, "../etc"),
    /Invalid skill name/
  );

  // Separator characters
  assert.throws(
    () => validateSkill(tmp, "sub/dir"),
    /Invalid skill name/
  );

  assert.throws(
    () => validateSkill(tmp, "sub\\dir"),
    /Invalid skill name/
  );

  // "foo..bar" should NOT be rejected (not a path traversal)
  // It should fail with "not found" instead of "Invalid skill name"
  assert.throws(
    () => validateSkill(tmp, "foo..bar"),
    /not found/
  );
});
