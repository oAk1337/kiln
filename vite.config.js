import { defineConfig } from "vite";

// Relative base so the built files work at https://<user>.github.io/kiln/
// and also from a local static server mounted at /kiln/.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
  },
});
