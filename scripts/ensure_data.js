#!/usr/bin/env node
/**
 * scripts/ensure_data.js
 * Cross-platform data availability check for FGO Calculator.
 *
 * Runs before `dev` or `build` (via predev/prebuild hooks).
 * If generated data files are missing (e.g. on fresh clone),
 * automatically executes `python3 scripts/sync_atlas_data.py`.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.dirname(__dirname);
const dataDir = path.join(baseDir, "src", "scripts", "data");

const requiredFiles = [
  path.join(dataDir, "servants.js"),
  path.join(dataDir, "craft_essences.js"),
  path.join(dataDir, "traits.js"),
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));

if (missing.length > 0) {
  console.log("Local game dataset missing. Auto-generating from Atlas Academy API...");
  try {
    execSync("python3 scripts/sync_atlas_data.py", {
      cwd: baseDir,
      stdio: "inherit",
    });
  } catch (error) {
    console.error("Failed to generate game dataset via sync_atlas_data.py:", error.message);
    process.exit(1);
  }
}
