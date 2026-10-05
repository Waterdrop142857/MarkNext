import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig(async environment => mergeConfig(await viteConfig(environment), {
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: { settings: { enableJavaScriptEvaluation: false } },
    },
    css: { include: [/katex/, /github-markdown-css/, /prismjs\/themes/, /src\/muya\/assets\/styles\/export/] },
    setupFiles: ["tests/setup.ts"],
    maxWorkers: 4,
    forbidOnly: true,
    passWithNoTests: false,
    dangerouslyIgnoreUnhandledErrors: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    reporters: ["default", "junit"],
    outputFile: { junit: "test-results/vitest.xml" },
  },
}));
