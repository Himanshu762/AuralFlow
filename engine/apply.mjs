#!/usr/bin/env node
/**
 * Graft AuralFlow's additions onto the vendored audio engine.
 *
 * `monochrome_app/` is a plain copy of an upstream project, with no git
 * metadata of its own. Re-cloning it — which is how you pick up a fix, or move
 * to a newer backend generation — overwrites the whole tree and silently drops
 * anything we added to it. That has now happened twice.
 *
 * So nothing of ours lives in that tree as its source of truth. This file owns
 * the bridge and the handful of edits the engine needs, and copies them in.
 * Run it after any re-vendor; the build runs it automatically.
 *
 * Every step is idempotent, so running it repeatedly is safe.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const engineJs = join(root, "monochrome_app", "js");

let failed = false;

/**
 * Stop early, with instructions, when the engine has not been vendored.
 *
 * `monochrome_app/` is a separate upstream project and is not committed here,
 * so a fresh clone does not have it. Without this the first thing a new
 * checkout sees is an ENOENT stack trace from a file copy, which says nothing
 * about what to do.
 */
function requireVendoredEngine() {
    if (existsSync(engineJs)) return true;

    const { repo, commit } = JSON.parse(readFileSync(join(here, "vendor.json"), "utf8"));
    console.error(
        [
            "",
            "[engine] The audio engine is not vendored yet.",
            "",
            "  monochrome_app/ is a separate upstream project, kept out of this",
            "  repository. Fetch the commit this build expects:",
            "",
            `    git clone ${repo} monochrome_app`,
            `    git -C monochrome_app checkout ${commit}`,
            "    node engine/apply.mjs",
            "",
            "  See engine/README.md for what this is and how to move it forward.",
            "",
        ].join("\n")
    );
    return false;
}

function fail(message) {
    console.error(`[engine] ${message}`);
    failed = true;
}

function ok(message) {
    console.log(`[engine] ${message}`);
}

/* ------------------------------------------------------------------ */
/* 1. The bridge itself                                                */
/* ------------------------------------------------------------------ */

function installBridge() {
    const source = join(here, "auralflow-bridge.js");
    const target = join(engineJs, "auralflow-bridge.js");

    if (!existsSync(source)) return fail("auralflow-bridge.js is missing from engine/");

    const incoming = readFileSync(source, "utf8");
    if (existsSync(target) && readFileSync(target, "utf8") === incoming) {
        return ok("bridge already in place");
    }
    copyFileSync(source, target);
    ok("bridge copied into the engine");
}

/* ------------------------------------------------------------------ */
/* 2. Edits to engine source                                           */
/* ------------------------------------------------------------------ */

/**
 * Each patch finds an anchor in the engine's own code and inserts ours before
 * it. Anchors are matched exactly: if upstream rewrites the surrounding code
 * the patch fails loudly rather than applying somewhere wrong.
 */
const PATCHES = [
    {
        file: "app.js",
        marker: "auralflow-bridge",
        describe: "load the bridge at startup",
        apply(source) {
            const anchor = source.match(/^import .*from '\.\/lyrics\.js';$/m);
            if (!anchor) return null;
            return source.replace(anchor[0], `${anchor[0]}\nimport './auralflow-bridge.js';`);
        },
    },
    {
        file: "audio-context.js",
        marker: "applyTransientGains",
        describe: "add a non-persisting gain path for the adaptive EQ",
        apply(source) {
            const anchor = "    /**\n     * Set gain for a specific band\n     */\n    setBandGain(bandIndex, gainDb) {";
            if (!source.includes(anchor)) return null;
            return source.replace(anchor, `${readFileSync(join(here, "patches", "applyTransientGains.js"), "utf8")}\n${anchor}`);
        },
    },
];

function applyPatches() {
    for (const patch of PATCHES) {
        const path = join(engineJs, patch.file);
        if (!existsSync(path)) {
            fail(`${patch.file} is missing — is monochrome_app/ vendored?`);
            continue;
        }

        const source = readFileSync(path, "utf8");
        if (source.includes(patch.marker)) {
            ok(`${patch.file}: already patched (${patch.describe})`);
            continue;
        }

        const patched = patch.apply(source);
        if (patched === null) {
            fail(
                `${patch.file}: could not find the anchor to ${patch.describe}. ` +
                    `Upstream has changed — update engine/apply.mjs.`
            );
            continue;
        }

        writeFileSync(path, patched);
        ok(`${patch.file}: patched to ${patch.describe}`);
    }
}

/* ------------------------------------------------------------------ */
/* 3. Sanity: is this engine one that can actually play anything?      */
/* ------------------------------------------------------------------ */

/**
 * Warn about a stale vendor.
 *
 * Builds from before the project moved to its current backend point at hosts
 * that no longer exist. Everything still compiles and search still works
 * through a public metadata API, so the only symptom is that nothing plays —
 * which is a miserable thing to debug. Say so at build time instead.
 */
function checkGeneration() {
    const api = join(engineJs, "storage.js");
    if (!existsSync(api)) return;

    const source = readFileSync(api, "utf8");
    const dead = ["lol.samidy.workers.dev", "auth.samidy.com", "api.samidy.com"];
    const found = dead.filter((host) => source.includes(host));

    if (found.length > 0) {
        console.warn(
            `[engine] WARNING: this engine still references ${found.join(", ")}, ` +
                `which are offline. Playback will not work. Re-vendor from ` +
                `${JSON.parse(readFileSync(join(here, "vendor.json"), "utf8")).repo}.`
        );
    }
}

if (!requireVendoredEngine()) {
    process.exit(1);
}

installBridge();
applyPatches();
checkGeneration();

if (failed) {
    console.error("[engine] the engine is not correctly patched — the app will not work as expected");
    process.exit(1);
}
