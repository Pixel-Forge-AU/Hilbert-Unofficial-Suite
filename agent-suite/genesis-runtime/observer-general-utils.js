// Shim for repo-local plugins under plugins/ that import "../observer-general-utils.js"
// (a relative path one level above the plugin catalog, matching the convention documented
// in README.md's "Running against an external plugin catalog" section). The real
// implementation lives in lib/, shared with the rest of the runtime.
export { compactText, escapeRegex } from "./lib/observer-general-utils.js";
