import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} SkillEntry
 * @property {string} name - Directory name used as skill identifier.
 * @property {string} description - Value from SKILL.md frontmatter `description` field.
 */

/**
 * Parse the YAML frontmatter from a SKILL.md file and extract `description`.
 * Returns an empty string for description if the field is missing.
 *
 * @param {string} content - Raw file content.
 * @returns {{ description: string } | null}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }
  const body = match[1];
  const descMatch = body.match(/^description:\s*"?(.+?)"?\s*$/m);
  const description = descMatch ? descMatch[1].trim() : "";
  return { description };
}

/**
 * Resolve the filesystem path to a skill's SKILL.md.
 * Checks user skills first, then falls back to .system skills.
 * Returns null if the SKILL.md does not exist.
 *
 * @param {string} codexHome - Absolute path to the Codex home directory.
 * @param {string} name - Skill name.
 * @returns {string | null}
 */
function resolveSkillPath(codexHome, name) {
  const candidates = [
    path.join(codexHome, "skills", name, "SKILL.md"),
    path.join(codexHome, "skills", ".system", name, "SKILL.md")
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Scan a single directory for a SKILL.md file and return a skill entry.
 *
 * @param {string} dirPath - Absolute path to the skill directory.
 * @param {string} dirName - Directory name (used as skill name).
 * @returns {SkillEntry | null}
 */
function readSkillEntry(dirPath, dirName) {
  const skillFilePath = path.join(dirPath, "SKILL.md");
  let content;
  try {
    content = fs.readFileSync(skillFilePath, "utf8");
  } catch {
    return null;
  }

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return { name: dirName, description: "" };
  }

  return { name: dirName, description: frontmatter.description };
}

/**
 * List all available Codex skills from the given Codex home directory.
 * Scans `~/.codex/skills/` including the `.system` subdirectory.
 * When the same skill name appears in both `.system` and user space,
 * the user-space version wins (scanned last, overwrites earlier entry).
 *
 * @param {string} codexHome - Absolute path to the Codex home directory (e.g. ~/.codex).
 * @returns {SkillEntry[]}
 */
export function listAvailableSkills(codexHome) {
  const skillsDir = path.join(codexHome, "skills");

  // Verify skills directory exists
  try {
    fs.accessSync(skillsDir, fs.constants.R_OK);
  } catch {
    return [];
  }

  /** @type {Map<string, SkillEntry>} */
  const skillMap = new Map();

  // Collect subdirectory groups to scan: .system first, then user skills
  const groups = [path.join(skillsDir, ".system"), skillsDir];

  for (const groupDir of groups) {
    let groupEntries;
    try {
      groupEntries = fs.readdirSync(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of groupEntries) {
      if (entry.name === ".system") {
        continue;
      }
      const entryPath = path.join(groupDir, entry.name);
      // Follow symlinks with statSync; use Dirent for plain directories
      let isDir;
      if (entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(entryPath).isDirectory();
        } catch {
          continue;
        }
      } else {
        isDir = entry.isDirectory();
      }
      if (!isDir) {
        continue;
      }
      const skill = readSkillEntry(entryPath, entry.name);
      if (skill) {
        skillMap.set(skill.name, skill);
      }
    }
  }

  return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve and validate a skill, returning its entry and file path.
 * Throws with available skill names if the skill is not found.
 *
 * @param {string} codexHome - Absolute path to the Codex home directory.
 * @param {string} name - Skill name to validate.
 * @returns {{ entry: SkillEntry, filePath: string | null }}
 * @throws {Error}
 */
/**
 * Verify that a skill name does not contain path traversal sequences.
 * Symlinks within the skills directory are allowed — the user controls
 * their own ~/.codex/skills/ directory.
 *
 * @param {string} name - Skill name to validate
 * @throws {Error}
 */
function validateSkillName(name) {
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error(`Invalid skill name: "${name}"`);
  }
}

export function validateSkill(codexHome, name) {
  validateSkillName(name);

  // Fast path: check user-space and .system directories directly
  const candidates = [
    path.join(codexHome, "skills", name),
    path.join(codexHome, "skills", ".system", name)
  ];
  for (const dirPath of candidates) {
    const entry = readSkillEntry(dirPath, name);
    if (entry) {
      const filePath = path.join(dirPath, "SKILL.md");
      return { entry, filePath };
    }
  }

  // Fallback: full scan (catches edge cases)
  const skills = listAvailableSkills(codexHome);
  const found = skills.find((s) => s.name === name);
  if (found) {
    return { entry: found, filePath: resolveSkillPath(codexHome, name) };
  }
  const available = skills.map((s) => `  - ${s.name}${s.description ? ` — ${s.description}` : ""}`).join("\n");
  throw new Error(
    `Skill "${name}" not found. Available skills:\n${available || "  (none)"}`
  );
}
