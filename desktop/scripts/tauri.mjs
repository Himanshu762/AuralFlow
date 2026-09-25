/**
 * Runs the Tauri CLI with the environment the host needs.
 *
 * The adjustments are both for Linux AppImage bundling, where the
 * `linuxdeploy` tool Tauri downloads is too old for a current distribution and
 * fails with nothing but "failed to run linuxdeploy":
 *
 *   APPIMAGE_EXTRACT_AND_RUN  linuxdeploy ships as an AppImage and so needs
 *                             libfuse2 to mount itself. Distributions have
 *                             moved to fuse3. Extracting instead of mounting
 *                             drops the dependency, and costs nothing where
 *                             FUSE is present.
 *   NO_STRIP                  The binutils `strip` bundled with linuxdeploy
 *                             predates the `.relr.dyn` relocation section that
 *                             current system libraries are built with, and
 *                             refuses to read them. Skipping the strip pass
 *                             only leaves the AppImage larger.
 */
import { spawn } from "node:child_process";

const env = { ...process.env };
if (process.platform === "linux") {
    env.APPIMAGE_EXTRACT_AND_RUN = env.APPIMAGE_EXTRACT_AND_RUN ?? "1";
    env.NO_STRIP = env.NO_STRIP ?? "1";
}

const child = spawn("tauri", process.argv.slice(2), {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
});

child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
child.on("error", (err) => {
    console.error(`[auralflow] could not run the Tauri CLI: ${err.message}`);
    process.exit(1);
});
