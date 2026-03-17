import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Use bootstrap (TypeScript) sources for tests instead of self-hosted .no files
      "@language": path.resolve(__dirname, "bootstrap/language"),
      "@lexer": path.resolve(__dirname, "bootstrap/compiler/lexer"),
      "@parser": path.resolve(__dirname, "bootstrap/compiler/parser"),
      "@compiler": path.resolve(__dirname, "bootstrap/compiler"),
      "@ast": path.resolve(__dirname, "bootstrap/compiler/ast"),
      "@cli": path.resolve(__dirname, "bootstrap/cli"),
      "@src": path.resolve(__dirname, "bootstrap"),
    },
  },
});
