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
  path.join(dataDir, "bond_growth.js"),
  path.join(dataDir, "event_shop.js"),
];

const servantInfoDir = path.join(baseDir, "public", "servant_info");
const skillIconsDir = path.join(baseDir, "public", "skill_icons");
const buffIconsDir = path.join(baseDir, "public", "buff_icons");

const missing = requiredFiles.filter((file) => !fs.existsSync(file));
const hasServantInfo =
  fs.existsSync(servantInfoDir) && fs.readdirSync(servantInfoDir).some((name) => name.endsWith(".json"));
const hasSkillIcons =
  fs.existsSync(skillIconsDir) && fs.readdirSync(skillIconsDir).some((name) => name.endsWith(".webp"));
const hasBuffIcons =
  fs.existsSync(buffIconsDir) && fs.readdirSync(buffIconsDir).some((name) => name.endsWith(".webp"));

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
} else if (!hasServantInfo || !hasSkillIcons || !hasBuffIcons) {
  console.log("Local servant info JSON or icons missing. Auto-generating via sync_atlas_data.py --servant-info-only...");
  try {
    execSync("python3 scripts/sync_atlas_data.py --servant-info-only", {
      cwd: baseDir,
      stdio: "inherit",
    });
  } catch (error) {
    console.error("Failed to generate servant info JSON:", error.message);
    process.exit(1);
  }
}
