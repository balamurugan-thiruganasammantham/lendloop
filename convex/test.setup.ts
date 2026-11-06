/// <reference types="vite/client" />
// Module map for convex-test (tests live outside this directory).
export const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.d.ts", "!./test.setup.ts"]);
