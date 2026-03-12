import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@language": path.resolve(__dirname, "src/language"),
      "@lexer": path.resolve(__dirname, "src/compiler/lexer"),
      "@parser": path.resolve(__dirname, "src/compiler/parser"),
      "@compiler": path.resolve(__dirname, "src/compiler"),
      "@ast": path.resolve(__dirname, "src/compiler/ast"),
      "@cli": path.resolve(__dirname, "cli"),
      "@src": path.resolve(__dirname, "src"),
    },
  },
});
