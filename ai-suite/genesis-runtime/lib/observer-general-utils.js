// Trimmed rewrite of two generic, Nova-agnostic functions from genesis-core's
// server/observer-general-utils.js. The rest of that file (persona-name rewriting,
// sandbox-path helpers) was left out — it carries Nova-specific assumptions and nothing
// in this repo's own plugins needs it. Kept as a standalone module (rather than folded
// into plugin-system-helpers.js) because it matches the filename several externally
// developed plugins (e.g. those in E:\AI\genesis-plugins) import by relative path.

export function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compactText(value = "", maxLength = 500) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
