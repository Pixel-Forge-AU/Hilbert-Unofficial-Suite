const DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 }
];

function compactText(value = "", max = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trim()}...` : text;
}

function slugify(value = "", fallback = "website-design") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function normalizeUrl(value = "") {
  const input = String(value || "").trim();
  if (!input) throw new Error("url is required");
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(withProtocol);
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error("only http and https URLs are supported");
  return parsed.href;
}

function uniqueList(values = [], max = 12) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function rgbToHex(color = "") {
  const value = String(color || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value.toUpperCase();
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return "";
  return `#${[match[1], match[2], match[3]].map((part) => {
    return Math.max(0, Math.min(255, Number(part || 0))).toString(16).padStart(2, "0");
  }).join("")}`.toUpperCase();
}

function topEntries(counts = {}, max = 10) {
  return Object.entries(counts || {})
    .filter(([key]) => key && key !== "transparent" && key !== "rgba(0, 0, 0, 0)")
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, max)
    .map(([value, count]) => ({ value, count }));
}

function pickColor(colors = [], index = 0, fallback = "#111827") {
  const entry = colors[index] || colors[0] || {};
  return rgbToHex(entry.value || "") || fallback;
}

function yamlString(value = "") {
  return JSON.stringify(String(value || ""));
}

function buildDesignTokens({ title, url, signals = {}, vision = {} }) {
  const colors = Array.isArray(vision.colors) && vision.colors.length
    ? vision.colors.map((entry) => ({ value: entry.hex || entry.value || entry }))
    : topEntries(signals.colors, 10);
  const fontFamilies = uniqueList([
    ...(Array.isArray(vision.fontFamilies) ? vision.fontFamilies : []),
    ...topEntries(signals.fontFamilies, 8).map((entry) => entry.value)
  ], 8);
  const radii = uniqueList(topEntries(signals.borderRadii, 8).map((entry) => entry.value), 8);
  const shadows = uniqueList(topEntries(signals.shadows, 8).map((entry) => entry.value), 8);
  const primary = pickColor(colors, 0, "#2563EB");
  const secondary = pickColor(colors, 1, "#0F172A");
  const accent = pickColor(colors, 2, "#F59E0B");
  const surface = pickColor(colors, 3, "#FFFFFF");
  const muted = pickColor(colors, 4, "#F3F4F6");
  const text = pickColor(colors, 5, "#111827");
  const bodyFont = fontFamilies[0] || "Inter, system-ui, sans-serif";
  const displayFont = fontFamilies[1] || bodyFont;
  const radius = radii.find((entry) => entry !== "0px") || radii[0] || "8px";
  const shadow = shadows.find((entry) => entry !== "none") || "0 1px 2px rgba(15, 23, 42, 0.08)";

  return {
    title: title || "Website Design System",
    sourceUrl: url,
    colors: { primary, secondary, accent, surface, muted, text },
    typography: {
      display: displayFont,
      body: bodyFont,
      h1: signals.h1 || "48px/1.1",
      h2: signals.h2 || "32px/1.2",
      bodySize: signals.bodySize || "16px/1.5"
    },
    spacing: {
      base: "4px",
      xs: "4px",
      sm: "8px",
      md: "16px",
      lg: "24px",
      xl: "32px",
      xxl: "48px"
    },
    shape: { radius },
    elevation: { card: shadow },
    raw: { fontFamilies, radii, shadows, colors: colors.map((entry) => rgbToHex(entry.value || "") || entry.value).filter(Boolean) }
  };
}

function buildDesignMd({ title, url, signals = {}, vision = {}, capturedAt = new Date().toISOString() }) {
  const tokens = buildDesignTokens({ title, url, signals, vision });
  const summary = compactText(vision.summary || signals.metaDescription || `Design system inferred from ${url}.`, 900);
  const visualStyle = compactText(vision.visualStyle || "Use the source site's visible hierarchy, rhythm, spacing density, and component proportions as the north star.", 900);
  const components = Array.isArray(vision.components) && vision.components.length
    ? vision.components
    : [
        "Header/navigation: preserve logo placement, primary navigation grouping, and prominent action treatment.",
        "Hero/lead section: maintain the source balance between headline, supporting copy, media, and conversion actions.",
        "Buttons: use the primary color for key actions, secondary treatment for quieter actions, and clear hover/focus states.",
        "Cards/sections: match the observed radius, border, shadow, and spacing density."
      ];
  const dos = Array.isArray(vision.dos) && vision.dos.length
    ? vision.dos
    : [
        "Reuse the token values before introducing new colors or type sizes.",
        "Keep section spacing and component density aligned with the captured site.",
        "Preserve visible contrast between body text, muted text, and action colors."
      ];
  const donts = Array.isArray(vision.donts) && vision.donts.length
    ? vision.donts
    : [
        "Do not replace the brand palette with default framework blue.",
        "Do not invent decorative gradients unless they are present in the source.",
        "Do not change the corner radius or shadow language without a deliberate reason."
      ];

  return `---
design_md_version: "0.1.0"
name: ${yamlString(tokens.title)}
source:
  type: "website"
  url: ${yamlString(url)}
  captured_at: ${yamlString(capturedAt)}
tokens:
  colors:
    primary: ${yamlString(tokens.colors.primary)}
    secondary: ${yamlString(tokens.colors.secondary)}
    accent: ${yamlString(tokens.colors.accent)}
    surface: ${yamlString(tokens.colors.surface)}
    muted: ${yamlString(tokens.colors.muted)}
    text: ${yamlString(tokens.colors.text)}
  typography:
    display:
      fontFamily: ${yamlString(tokens.typography.display)}
      fontSize: "48px"
      fontWeight: "700"
      lineHeight: "1.1"
    heading:
      fontFamily: ${yamlString(tokens.typography.display)}
      fontSize: "32px"
      fontWeight: "700"
      lineHeight: "1.2"
    body:
      fontFamily: ${yamlString(tokens.typography.body)}
      fontSize: "16px"
      fontWeight: "400"
      lineHeight: "1.5"
  spacing:
    base: ${yamlString(tokens.spacing.base)}
    xs: ${yamlString(tokens.spacing.xs)}
    sm: ${yamlString(tokens.spacing.sm)}
    md: ${yamlString(tokens.spacing.md)}
    lg: ${yamlString(tokens.spacing.lg)}
    xl: ${yamlString(tokens.spacing.xl)}
    xxl: ${yamlString(tokens.spacing.xxl)}
  radii:
    default: ${yamlString(tokens.shape.radius)}
  elevation:
    card: ${yamlString(tokens.elevation.card)}
components:
  button:
    background: "{tokens.colors.primary}"
    color: "{tokens.colors.surface}"
    borderRadius: "{tokens.radii.default}"
    padding: "{tokens.spacing.sm} {tokens.spacing.md}"
  card:
    background: "{tokens.colors.surface}"
    borderRadius: "{tokens.radii.default}"
    boxShadow: "{tokens.elevation.card}"
    padding: "{tokens.spacing.lg}"
---

# ${tokens.title}

## Overview

${summary}

Creative direction: ${visualStyle}

Source URL: ${url}

## Colors

- Primary: \`${tokens.colors.primary}\`
- Secondary: \`${tokens.colors.secondary}\`
- Accent: \`${tokens.colors.accent}\`
- Surface: \`${tokens.colors.surface}\`
- Muted: \`${tokens.colors.muted}\`
- Text: \`${tokens.colors.text}\`

Observed palette candidates: ${tokens.raw.colors.length ? tokens.raw.colors.map((entry) => `\`${entry}\``).join(", ") : "not enough color data captured"}.

## Typography

- Display: ${tokens.typography.display}
- Body: ${tokens.typography.body}
- Observed h1 scale: ${tokens.typography.h1}
- Observed h2 scale: ${tokens.typography.h2}
- Body rhythm: ${tokens.typography.bodySize}

Use display type for brand or page-level statements. Use body type for dense interface copy, descriptions, labels, and secondary content.

## Layout

- Base spacing unit: \`${tokens.spacing.base}\`
- Standard section spacing: \`${tokens.spacing.xl}\` to \`${tokens.spacing.xxl}\`
- Component spacing: \`${tokens.spacing.sm}\` to \`${tokens.spacing.lg}\`
- Preserve the captured page rhythm across desktop, tablet, and mobile.

## Elevation And Depth

- Card elevation: \`${tokens.elevation.card}\`
- Use shadows only where the source site uses elevation, layering, or affordance.
- Keep flat surfaces flat when the captured site relies on borders, whitespace, or color blocking.

## Shapes

- Default radius: \`${tokens.shape.radius}\`
- Match the source radius consistently across buttons, cards, inputs, badges, and media containers.

## Components

${components.map((entry) => `- ${compactText(entry, 220)}`).join("\n")}

## Do's And Don'ts

Do:
${dos.map((entry) => `- ${compactText(entry, 180)}`).join("\n")}

Don't:
${donts.map((entry) => `- ${compactText(entry, 180)}`).join("\n")}
`;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    try {
      return await import("playwright-core");
    } catch {
      return null;
    }
  }
}

function normalizeViewports(input = []) {
  if (!Array.isArray(input) || !input.length) return DEFAULT_VIEWPORTS;
  return input.slice(0, 4).map((entry, index) => ({
    name: slugify(entry?.name || `viewport-${index + 1}`, `viewport-${index + 1}`),
    width: Math.max(320, Math.min(2400, Number(entry?.width || 1280))),
    height: Math.max(480, Math.min(1800, Number(entry?.height || 900)))
  }));
}

async function captureWebsite({ url, viewports = DEFAULT_VIEWPORTS, fullPage = true, timeoutMs = 30000 }) {
  const pw = await loadPlaywright();
  if (!pw) {
    throw new Error("Playwright is not installed. Run: cd nova-observer && npm install playwright && npx playwright install chromium");
  }

  const browser = await pw.chromium.launch({ headless: true });
  const screenshots = [];
  let signals = {};
  let finalUrl = url;

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        userAgent: "Mozilla/5.0 (compatible; NovaStitchDesign/1.0)"
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
      finalUrl = page.url();
      if (!signals.title) {
        signals = await page.evaluate(() => {
          const counts = (values) => values.reduce((acc, value) => {
            const key = String(value || "").trim();
            if (key) acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {});
          const sampled = Array.from(document.querySelectorAll("body *")).slice(0, 700);
          const styles = sampled.map((el) => {
            const cs = window.getComputedStyle(el);
            return {
              color: cs.color,
              backgroundColor: cs.backgroundColor,
              fontFamily: cs.fontFamily,
              borderRadius: cs.borderRadius,
              boxShadow: cs.boxShadow
            };
          });
          const metric = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return "";
            const cs = window.getComputedStyle(el);
            return `${cs.fontSize}/${cs.lineHeight}`;
          };
          return {
            title: document.title || "",
            metaDescription: document.querySelector("meta[name='description']")?.content || "",
            h1: metric("h1"),
            h2: metric("h2"),
            bodySize: metric("body") || "16px/normal",
            colors: counts(styles.flatMap((entry) => [entry.color, entry.backgroundColor])),
            fontFamilies: counts(styles.map((entry) => entry.fontFamily)),
            borderRadii: counts(styles.map((entry) => entry.borderRadius)),
            shadows: counts(styles.map((entry) => entry.boxShadow)),
            componentCounts: {
              buttons: document.querySelectorAll("button, a[href].btn, a[href][class*='button'], input[type='submit']").length,
              links: document.querySelectorAll("a[href]").length,
              cards: document.querySelectorAll("[class*='card'], article, section").length,
              inputs: document.querySelectorAll("input, textarea, select").length,
              images: document.querySelectorAll("img, picture, video").length
            },
            visibleHeadings: Array.from(document.querySelectorAll("h1,h2,h3")).map((el) => el.innerText.trim()).filter(Boolean).slice(0, 16)
          };
        });
      }
      const buffer = await page.screenshot({ fullPage });
      screenshots.push({
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        type: "image/png",
        contentBase64: buffer.toString("base64")
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return { finalUrl, signals, screenshots };
}

function resolveOutputDir({ runtimeContext, url, outputDir = "" }) {
  const path = runtimeContext?.path;
  const root = String(runtimeContext?.OBSERVER_OUTPUT_ROOT || "").trim();
  if (!path || !root) return "";
  const slug = slugify(outputDir || url);
  const candidate = outputDir && (path.isAbsolute(outputDir) || /^[a-zA-Z]:[\\/]/.test(outputDir))
    ? path.resolve(outputDir)
    : path.join(root, "stitch-design", slug);
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("outputDir must stay inside OBSERVER_OUTPUT_ROOT");
  }
  return candidate;
}

async function writeArtifacts({ runtimeContext, outputDir, designMd, screenshots = [] }) {
  const path = runtimeContext?.path;
  const fs = runtimeContext?.fs;
  if (!path || !fs || !outputDir) return { outputDir: "", designPath: "", screenshotPaths: [] };
  await fs.mkdir(outputDir, { recursive: true });
  const designPath = path.join(outputDir, "DESIGN.md");
  await fs.writeFile(designPath, designMd, "utf8");
  const screenshotDir = path.join(outputDir, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPaths = [];
  for (const shot of screenshots) {
    const screenshotPath = path.join(screenshotDir, `${slugify(shot.name, "viewport")}.png`);
    await fs.writeFile(screenshotPath, Buffer.from(String(shot.contentBase64 || ""), "base64"));
    screenshotPaths.push(screenshotPath);
  }
  const root = String(runtimeContext?.OBSERVER_OUTPUT_ROOT || "").trim();
  const containerRoot = String(runtimeContext?.OBSERVER_CONTAINER_OUTPUT_ROOT || "").trim();
  const relative = root && containerRoot ? path.relative(path.resolve(root), outputDir).replace(/\\/g, "/") : "";
  const containerOutputDir = relative && !relative.startsWith("..")
    ? `${containerRoot.replace(/\/+$/, "")}/${relative}`
    : "";
  return {
    outputDir,
    designPath,
    screenshotPaths,
    containerOutputDir,
    containerDesignPath: containerOutputDir ? `${containerOutputDir}/DESIGN.md` : ""
  };
}

function resolveVisionBrainId(runtimeContext = {}, requested = "") {
  const explicit = String(requested || "").trim();
  if (explicit) return explicit;
  const config = runtimeContext.getObserverConfig?.() || {};
  const routed = Array.isArray(config?.routing?.specialistMap?.vision)
    ? String(config.routing.specialistMap.vision[0] || "").trim()
    : "";
  if (routed) return routed;
  const custom = Array.isArray(config?.brains?.custom) ? config.brains.custom : [];
  return String(custom.find((brain) => String(brain?.specialty || "").trim() === "vision")?.id || "vision_worker").trim();
}

async function queueVisionRefinement({ runtimeContext, url, title, designMd, screenshots, outputDir, containerOutputDir, visionBrainId }) {
  if (typeof runtimeContext?.createQueuedTask !== "function") {
    return null;
  }
  const requestedBrainId = resolveVisionBrainId(runtimeContext, visionBrainId);
  const message = [
    `Use AI vision to inspect the attached website screenshots from ${url}.`,
    "Refine the draft Google Stitch DESIGN.md below so it accurately captures visual style, palette, typography, spacing, shape, elevation, component language, and do/don't rules.",
    containerOutputDir ? `Write the final file to this mounted output folder path: ${containerOutputDir}/DESIGN.md` : "Include the complete final DESIGN.md in your response.",
    outputDir ? `Host output folder for the user: ${outputDir}` : "",
    "Keep the YAML front matter plus Markdown rationale structure. Preserve concrete token values where they match the screenshots and correct any wrong guesses.",
    "",
    "Draft DESIGN.md:",
    "```md",
    designMd,
    "```"
  ].join("\n");

  return await runtimeContext.createQueuedTask({
    message,
    sessionId: "Main",
    requestedBrainId,
    forceToolUse: true,
    requireWorkerPreflight: false,
    attachments: screenshots.map((shot) => ({
      name: `${slugify(title || "website")}-${shot.name}.png`,
      type: "image/png",
      contentBase64: shot.contentBase64
    })),
    notes: "Stitch DESIGN.md vision refinement queued by stitch-design plugin.",
    taskMeta: {
      internalJobType: "stitch_design_vision_refinement",
      lockRequestedBrain: true,
      specialty: "vision",
      sourceUrl: url,
      outputDir,
      containerOutputDir
    }
  });
}

export function createStitchDesignDomain({ runtimeContext = {} } = {}) {
  async function generateFromWebsite(args = {}) {
    const url = normalizeUrl(args.url);
    const viewports = normalizeViewports(args.viewports);
    const capture = await captureWebsite({
      url,
      viewports,
      fullPage: args.fullPage !== false,
      timeoutMs: Math.max(5000, Math.min(60000, Number(args.timeoutMs || 30000)))
    });
    const title = String(args.name || capture.signals.title || new URL(capture.finalUrl).hostname || "Website Design System").trim();
    const designMd = buildDesignMd({
      title,
      url: capture.finalUrl,
      signals: capture.signals,
      vision: args.visionNotes && typeof args.visionNotes === "object" ? args.visionNotes : {}
    });
    const outputDir = args.writeFile === false
      ? ""
      : resolveOutputDir({ runtimeContext, url: capture.finalUrl, outputDir: String(args.outputDir || "").trim() });
    const artifacts = outputDir
      ? await writeArtifacts({ runtimeContext, outputDir, designMd, screenshots: capture.screenshots })
      : { outputDir: "", designPath: "", screenshotPaths: [], containerOutputDir: "", containerDesignPath: "" };
    const visionTask = args.queueVision === false
      ? null
      : await queueVisionRefinement({
          runtimeContext,
          url: capture.finalUrl,
          title,
          designMd,
          screenshots: capture.screenshots,
          outputDir: artifacts.outputDir,
          containerOutputDir: artifacts.containerOutputDir,
          visionBrainId: args.visionBrainId
        });

    return {
      ok: true,
      url: capture.finalUrl,
      title,
      designMd,
      designPath: artifacts.designPath,
      outputDir: artifacts.outputDir,
      containerOutputDir: artifacts.containerOutputDir,
      containerDesignPath: artifacts.containerDesignPath,
      screenshotPaths: artifacts.screenshotPaths,
      screenshotCount: capture.screenshots.length,
      visionTaskId: visionTask?.id || null,
      visionQueued: Boolean(visionTask?.id),
      signals: {
        title: capture.signals.title,
        metaDescription: capture.signals.metaDescription,
        visibleHeadings: capture.signals.visibleHeadings,
        componentCounts: capture.signals.componentCounts,
        colors: topEntries(capture.signals.colors, 8),
        fontFamilies: topEntries(capture.signals.fontFamilies, 5),
        borderRadii: topEntries(capture.signals.borderRadii, 5)
      }
    };
  }

  function buildTemplate(args = {}) {
    const url = String(args.url || "https://example.com").trim();
    const title = String(args.name || "Website Design System").trim();
    return {
      ok: true,
      designMd: buildDesignMd({ title, url, signals: {}, vision: args.visionNotes || {} })
    };
  }

  return {
    generateFromWebsite,
    buildTemplate
  };
}
