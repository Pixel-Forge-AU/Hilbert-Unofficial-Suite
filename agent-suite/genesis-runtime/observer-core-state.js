// Shim for repo-local plugins under plugins/ that import "../../../observer-core-state.js"
// (a relative path above the plugin catalog, matching the convention documented in
// README.md's "Running against an external plugin catalog" section). The real
// implementation lives in lib/, shared with the rest of the runtime.
export { normalizeProjectsConfigForBootstrap } from "./lib/observer-core-state.js";
