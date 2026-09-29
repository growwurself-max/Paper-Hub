import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tanstackStart(),
    react(),
    tailwindcss(),
    nitro({
      preset: "vercel",
      renderer: {
        handler:
          "./node_modules/nitro/dist/runtime/internal/vite/ssr-renderer.mjs",
      },
    }),
  ],

  environments: {
    ssr: {
      build: {
        rollupOptions: {
          input: "./src/server.ts",
        },
      },
    },
  },

  server: {
    port: 5174,
    strictPort: true,
  },

  preview: {
    port: 4174,
    strictPort: true,
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});