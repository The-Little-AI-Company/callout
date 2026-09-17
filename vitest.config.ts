import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./engine", import.meta.url)),
      "@content": fileURLToPath(new URL("./content", import.meta.url)),
    },
  },
  test: { include: ["test/**/*.test.ts"], setupFiles: ["test/env.ts"], environment: "node", testTimeout: 60000 },
});
