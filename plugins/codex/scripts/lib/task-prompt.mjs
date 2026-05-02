import fs from "node:fs";
import path from "node:path";

import { readStdinIfPiped } from "./fs.mjs";

export function readTaskPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return readPromptFile(cwd, options["prompt-file"]);
  }
  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

function readPromptFile(cwd, promptFileOption) {
  const realCwd = fs.realpathSync(cwd);
  const resolved = path.resolve(realCwd, promptFileOption);

  // Resolve symlinks. If the file does not yet exist, fall back to resolving
  // the parent directory and recombining — this preserves the existing
  // behavior where readFileSync would throw a clear ENOENT.
  let realResolved;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      const parent = path.dirname(resolved);
      const realParent = fs.realpathSync(parent);
      realResolved = path.join(realParent, path.basename(resolved));
    } else {
      throw error;
    }
  }

  const rel = path.relative(realCwd, realResolved);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error(
      `--prompt-file must be a path inside ${realCwd} (got ${realResolved})`
    );
  }

  return fs.readFileSync(realResolved, "utf8");
}
