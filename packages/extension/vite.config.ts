/// <reference types="node" />

import { copyFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig, type Plugin } from "vite";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const iconFiles = [
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
  "icon-128.png",
] as const;

function copyManifestPlugin(): Plugin {
  return {
    name: "copy-extension-static-assets",
    async closeBundle() {
      const manifestSource = resolve(packageRoot, "manifest.json");
      const manifestDestination = resolve(packageRoot, "dist", "manifest.json");
      const iconsSource = resolve(packageRoot, "icons");
      const iconsDestination = resolve(packageRoot, "dist", "icons");

      await mkdir(dirname(manifestDestination), { recursive: true });
      await mkdir(iconsDestination, { recursive: true });
      await copyFile(manifestSource, manifestDestination);

      await Promise.all(
        iconFiles.map((iconFile) =>
          copyFile(
            resolve(iconsSource, iconFile),
            resolve(iconsDestination, iconFile),
          ),
        ),
      );
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [copyManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "chrome114",
    rollupOptions: {
      input: {
        background: resolve(packageRoot, "src/background.ts"),
        content: resolve(packageRoot, "src/content.ts"),
        popup: resolve(packageRoot, "popup.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
