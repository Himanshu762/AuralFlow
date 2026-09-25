import type { NextConfig } from "next";

/**
 * Tauri loads the built app from the filesystem, not from a Node server,
 * so the frontend is emitted as a fully static bundle.
 */
const nextConfig: NextConfig = {
  output: "export",
  /* No image optimizer exists in the Tauri webview — serve sources as-is. */
  images: { unoptimized: true },
  /* Directory-style URLs resolve correctly over the tauri:// protocol. */
  trailingSlash: true,
  /* The dev badge floats over the player bar, which owns the bottom edge. */
  devIndicators: false,
};

export default nextConfig;
