import { solidStart } from "@solidjs/start/config";
import { nitro } from "nitro/vite";
import UnoCSS from "unocss/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";

/**
 * SolidStart 2 is Vite-native. The scaffold scripts used `vinxi`, which cannot
 * load `@solidjs/start@2`. See apps/web/README.md.
 */
export default defineConfig({
  plugins: [
    // Extract utilities from source JSX before Solid compiles templates.
    UnoCSS({ mode: "per-module" }),
    solidStart({
      // Hide the SolidStart dev toolbar so it is not mistaken for live agent status.
      devOverlay: false
    }),
    nitro()
  ],
  server: {
    port: 3000,
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        "/__uno.css",
        "/__uno.css?inline",
        "/@unocss"
      ]
    }
  }
});
