#!/usr/bin/env node
/**
 * Build whatever the native shell needs, and only when it is stale.
 *
 * AuralFlow is one application: the shell serves the audio engine in-process
 * and starts the backend itself. That only works if the engine and the UI have
 * been built, so this runs those builds on demand rather than asking the user
 * to remember them.
 */

import { execSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const TARGETS = {
  engine: {
    label: "audio engine",
    dir: join(root, "monochrome_app"),
    output: join(root, "monochrome_app", "dist", "index.html"),
    // Rebuild when our additions or any engine source is newer than the build.
    watch: [
      join(root, "monochrome_app", "js"),
      join(root, "monochrome_app", "index.html"),
      join(root, "engine"),
    ],
    command: "npm run build",
    // The engine is a plain copy of an upstream tree with no git metadata, so
    // re-vendoring it wipes our additions. Graft them back on before building
    // rather than trusting that whoever re-vendored remembered.
    before: () => {
      execSync(`node ${JSON.stringify(join(root, "engine", "apply.mjs"))}`, {
        stdio: "inherit",
      });
    },
  },
  ui: {
    label: "interface",
    dir: join(root, "frontend"),
    output: join(root, "frontend", "out", "index.html"),
    watch: [
      join(root, "frontend", "app"),
      join(root, "frontend", "components"),
      join(root, "frontend", "hooks"),
      join(root, "frontend", "lib"),
      join(root, "frontend", "stores"),
    ],
    command: "npm run build",
  },
};

/** Newest mtime under a path, or 0 when it does not exist. */
function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    newest = Math.max(newest, newestMtime(join(path, entry.name)));
  }
  return newest;
}

function ensureDeps(target) {
  if (existsSync(join(target.dir, "node_modules"))) return;
  console.log(`[auralflow] installing ${target.label} dependencies…`);
  execSync("npm install --no-audit --no-fund", { cwd: target.dir, stdio: "inherit" });
}

function build(name) {
  const target = TARGETS[name];
  if (!target) {
    console.error(`[auralflow] unknown target "${name}"`);
    process.exit(1);
  }

  if (!existsSync(target.dir)) {
    console.error(`[auralflow] ${target.label} sources are missing at ${target.dir}`);
    process.exit(1);
  }

  /* Run before the staleness check, not after: a tree missing our additions
     can still look newer than nothing, and would then be built wrong. */
  target.before?.();

  const built = newestMtime(target.output);
  const newestSource = Math.max(...target.watch.map(newestMtime));

  if (built > 0 && built >= newestSource) {
    console.log(`[auralflow] ${target.label} is up to date`);
    return;
  }

  ensureDeps(target);
  console.log(`[auralflow] building ${target.label}…`);
  execSync(target.command, { cwd: target.dir, stdio: "inherit" });
}

build(process.argv[2]);
