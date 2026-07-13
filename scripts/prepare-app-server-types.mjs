#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "plugins", "codex", ".generated", "app-server-types");

fs.mkdirSync(outputDir, { recursive: true });
