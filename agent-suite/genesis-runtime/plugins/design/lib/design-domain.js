/**
 * Design domain — structured prompting for design system generation,
 * multi-variant exploration, and HTML output from design specs.
 */

const TYPOGRAPHY_PRESETS = {
  modern: { heading: "Inter, sans-serif", body: "Inter, sans-serif", mono: "JetBrains Mono, monospace" },
  editorial: { heading: "Playfair Display, Georgia, serif", body: "Source Serif Pro, Georgia, serif", mono: "Fira Code, monospace" },
  terminal: { heading: "DM Sans, sans-serif", body: "DM Sans, sans-serif", mono: "JetBrains Mono, Menlo, monospace" },
  humanist: { heading: "Satoshi, Nunito, sans-serif", body: "Satoshi, Nunito, sans-serif", mono: "Cascadia Code, monospace" },
  minimal: { heading: "system-ui, sans-serif", body: "system-ui, sans-serif", mono: "ui-monospace, monospace" }
};

const COLOR_STRATEGIES = {
  amber_terminal: {
    primary: "#F59E0B", primaryFg: "#000000",
    surface: "#1C1917", surfaceFg: "#E7E5E4",
    background: "#0C0A09", foreground: "#F5F5F4",
    accent: "#F59E0B", accentFg: "#000000",
    border: "#292524", muted: "#57534E"
  },
  ocean: {
    primary: "#3B82F6", primaryFg: "#FFFFFF",
    surface: "#1E293B", surfaceFg: "#E2E8F0",
    background: "#0F172A", foreground: "#F1F5F9",
    accent: "#38BDF8", accentFg: "#0F172A",
    border: "#1E293B", muted: "#64748B"
  },
  forest: {
    primary: "#10B981", primaryFg: "#FFFFFF",
    surface: "#1C2820", surfaceFg: "#D1FAE5",
    background: "#0D1A12", foreground: "#ECFDF5",
    accent: "#34D399", accentFg: "#064E3B",
    border: "#1F2E25", muted: "#4ADE80"
  },
  slate_light: {
    primary: "#6366F1", primaryFg: "#FFFFFF",
    surface: "#F8FAFC", surfaceFg: "#1E293B",
    background: "#FFFFFF", foreground: "#0F172A",
    accent: "#8B5CF6", accentFg: "#FFFFFF",
    border: "#E2E8F0", muted: "#94A3B8"
  },
  rose: {
    primary: "#F43F5E", primaryFg: "#FFFFFF",
    surface: "#1C0D10", surfaceFg: "#FFE4E6",
    background: "#0D0608", foreground: "#FFF1F2",
    accent: "#FB7185", accentFg: "#4C0519",
    border: "#3F1118", muted: "#9F1239"
  }
};

const SPACING_SCALES = {
  compact: { xs: "4px", sm: "8px", md: "12px", lg: "20px", xl: "32px", "2xl": "48px" },
  default: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px", "2xl": "64px" },
  relaxed: { xs: "8px", sm: "16px", md: "24px", lg: "40px", xl: "64px", "2xl": "96px" }
};

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createDesignDomain({ data } = {}) {

  function pickColorStrategy(name = "") {
    const key = name.toLowerCase().replace(/[\s_-]+/g, "_");
    return COLOR_STRATEGIES[key] ?? COLOR_STRATEGIES.amber_terminal;
  }

  function pickTypography(name = "") {
    const key = name.toLowerCase().replace(/[\s_-]+/g, "_");
    return TYPOGRAPHY_PRESETS[key] ?? TYPOGRAPHY_PRESETS.terminal;
  }

  function pickSpacing(density = "default") {
    return SPACING_SCALES[density] ?? SPACING_SCALES.default;
  }

  function buildCssVariables(colors = {}, typography = {}, spacing = {}) {
    return [
      ":root {",
      `  /* Colors */`,
      `  --color-bg: ${colors.background};`,
      `  --color-fg: ${colors.foreground};`,
      `  --color-surface: ${colors.surface};`,
      `  --color-surface-fg: ${colors.surfaceFg};`,
      `  --color-primary: ${colors.primary};`,
      `  --color-primary-fg: ${colors.primaryFg};`,
      `  --color-accent: ${colors.accent};`,
      `  --color-accent-fg: ${colors.accentFg};`,
      `  --color-border: ${colors.border};`,
      `  --color-muted: ${colors.muted};`,
      `  /* Typography */`,
      `  --font-heading: ${typography.heading};`,
      `  --font-body: ${typography.body};`,
      `  --font-mono: ${typography.mono};`,
      `  /* Spacing */`,
      Object.entries(spacing).map(([k, v]) => `  --space-${k}: ${v};`).join("\n"),
      `  /* Radius */`,
      `  --radius-sm: 4px;`,
      `  --radius-md: 8px;`,
      `  --radius-lg: 16px;`,
      `  --radius-full: 9999px;`,
      `  /* Shadows */`,
      `  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);`,
      `  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);`,
      `  --shadow-lg: 0 16px 40px rgba(0,0,0,0.5);`,
      "}"
    ].join("\n");
  }

  function buildDesignSystem({ brief = "", colorStrategy = "amber_terminal", typography = "terminal", spacing = "default", name = "Design System" } = {}) {
    const colors = pickColorStrategy(colorStrategy);
    const fonts = pickTypography(typography);
    const spacingScale = pickSpacing(spacing);
    const cssVars = buildCssVariables(colors, fonts, spacingScale);

    return {
      name,
      brief,
      tokens: { colors, typography: fonts, spacing: spacingScale },
      cssVariables: cssVars,
      components: buildComponentSpecs(colors, fonts),
      guidelines: buildDesignGuidelines(brief, colors)
    };
  }

  function buildComponentSpecs(colors = {}, fonts = {}) {
    return {
      button: {
        primary: `background: var(--color-primary); color: var(--color-primary-fg); font-family: var(--font-body); padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); border: none; cursor: pointer; font-weight: 600;`,
        ghost: `background: transparent; color: var(--color-primary); border: 1px solid var(--color-primary); padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); cursor: pointer;`,
        destructive: `background: #EF4444; color: white; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); border: none; cursor: pointer;`
      },
      card: `background: var(--color-surface); color: var(--color-surface-fg); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-lg); box-shadow: var(--shadow-md);`,
      input: `background: var(--color-surface); color: var(--color-surface-fg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-md); font-family: var(--font-body); width: 100%; outline: none;`,
      badge: `display: inline-flex; align-items: center; background: var(--color-accent); color: var(--color-accent-fg); border-radius: var(--radius-full); padding: 2px var(--space-sm); font-size: 0.75rem; font-weight: 600;`,
      heading: {
        h1: `font-family: var(--font-heading); font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 800; line-height: 1.1; color: var(--color-fg);`,
        h2: `font-family: var(--font-heading); font-size: clamp(1.5rem, 4vw, 2.5rem); font-weight: 700; line-height: 1.2; color: var(--color-fg);`,
        h3: `font-family: var(--font-heading); font-size: clamp(1.25rem, 3vw, 1.75rem); font-weight: 600; line-height: 1.3; color: var(--color-fg);`
      }
    };
  }

  function buildDesignGuidelines(brief = "", colors = {}) {
    return {
      colorUsage: [
        `Use --color-primary (${colors.primary}) for CTAs, active states, and brand moments.`,
        `Use --color-surface (${colors.surface}) for cards and elevated containers.`,
        `Use --color-border (${colors.border}) for dividers and input outlines.`,
        `Use --color-muted (${colors.muted}) for secondary text and placeholders.`
      ],
      typographyRules: [
        "Use --font-heading for all h1-h3 elements.",
        "Use --font-body for body copy, labels, and buttons.",
        "Use --font-mono for code blocks, terminal output, and data values.",
        "Minimum readable body font size: 16px.",
        "Heading scale: h1=clamp(2rem,5vw,3.5rem), h2=clamp(1.5rem,4vw,2.5rem), h3=1.5rem."
      ],
      spacingRules: [
        "Use the spacing scale consistently — avoid arbitrary pixel values.",
        "Card internal padding: --space-lg.",
        "Section vertical gap: --space-xl.",
        "Inline element gap: --space-sm."
      ],
      gridSystem: {
        columns: 12,
        gutter: "var(--space-lg)",
        maxWidth: "1280px",
        breakpoints: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" }
      }
    };
  }

  function buildVariants(brief = "", count = 3) {
    const strategies = shuffle(Object.keys(COLOR_STRATEGIES));
    const typographies = shuffle(Object.keys(TYPOGRAPHY_PRESETS));
    const spacings = shuffle(Object.keys(SPACING_SCALES));

    const variants = [];
    for (let i = 0; i < Math.min(count, strategies.length); i++) {
      const colorKey = strategies[i % strategies.length];
      const fontKey = typographies[i % typographies.length];
      const spacingKey = spacings[i % spacings.length];
      variants.push({
        variantId: i + 1,
        name: `Variant ${i + 1} — ${colorKey} / ${fontKey}`,
        differentiators: [
          `Color strategy: ${colorKey}`,
          `Typography: ${fontKey}`,
          `Spacing density: ${spacingKey}`
        ],
        system: buildDesignSystem({
          brief,
          colorStrategy: colorKey,
          typography: fontKey,
          spacing: spacingKey,
          name: `${brief.slice(0, 40)} — Variant ${i + 1}`
        })
      });
    }
    return variants;
  }

  function buildHtmlFromSpec(spec = {}) {
    const tokens = spec.tokens ?? {};
    const colors = tokens.colors ?? COLOR_STRATEGIES.amber_terminal;
    const fonts = tokens.typography ?? TYPOGRAPHY_PRESETS.terminal;
    const spacing = tokens.spacing ?? SPACING_SCALES.default;
    const cssVars = buildCssVariables(colors, fonts, spacing);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${String(spec.name || "Design Preview")}</title>
  <style>
${cssVars}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-body);
  line-height: 1.6;
  font-size: 16px;
}

.container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 var(--space-lg);
}

.section {
  padding: var(--space-xl) 0;
}

h1 { ${(spec.components?.heading?.h1 ?? "font-size: 3rem;")} }
h2 { ${(spec.components?.heading?.h2 ?? "font-size: 2rem;")} }
h3 { ${(spec.components?.heading?.h3 ?? "font-size: 1.5rem;")} }

.btn-primary { ${spec.components?.button?.primary ?? ""} display: inline-flex; align-items: center; }
.btn-ghost { ${spec.components?.button?.ghost ?? ""} display: inline-flex; align-items: center; }

.card { ${spec.components?.card ?? ""} }
.input { ${spec.components?.input ?? ""} }
.badge { ${spec.components?.badge ?? ""} }

/* Grid */
.grid { display: grid; gap: var(--space-lg); }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 768px) {
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
}
  </style>
</head>
<body>
  <div class="container">
    <div class="section">
      <h1>${String(spec.name || "Design System Preview")}</h1>
      <p style="color: var(--color-muted); margin-top: var(--space-sm);">${String(spec.brief || "")}</p>
    </div>

    <div class="section">
      <h2>Components</h2>
      <div style="display: flex; gap: var(--space-md); flex-wrap: wrap; margin-top: var(--space-md);">
        <button class="btn-primary">Primary Button</button>
        <button class="btn-ghost">Ghost Button</button>
      </div>
    </div>

    <div class="section grid grid-3">
      <div class="card">
        <h3>Card Title</h3>
        <p style="color: var(--color-muted); margin-top: var(--space-sm);">Card body text using surface background and border tokens.</p>
      </div>
      <div class="card">
        <h3>Input Fields</h3>
        <input class="input" style="margin-top: var(--space-sm);" placeholder="Text input" />
      </div>
      <div class="card">
        <h3>Badges</h3>
        <div style="margin-top: var(--space-sm); display: flex; gap: var(--space-sm);">
          <span class="badge">Active</span>
          <span class="badge" style="background: var(--color-muted);">Draft</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  async function loadPreferences() {
    if (!data) return {};
    return await data.readJson("aesthetic-preferences", {});
  }

  async function savePreference(variant = {}) {
    if (!data) return;
    await data.updateJson("aesthetic-preferences", (current = {}) => {
      const chosen = String(variant.colorStrategy || variant.name || "").trim();
      const counts = current.counts && typeof current.counts === "object" ? current.counts : {};
      counts[chosen] = (counts[chosen] ?? 0) + 1;
      const recent = Array.isArray(current.recent) ? current.recent.slice(-10) : [];
      const entry = { chosen, at: Date.now() };
      const reason = String(variant.reason || "").trim();
      if (reason) entry.reason = reason;
      recent.push(entry);
      return { counts, recent, lastChosenAt: Date.now() };
    }, {});
  }

  return {
    buildDesignSystem,
    buildVariants,
    buildHtmlFromSpec,
    loadPreferences,
    savePreference,
    COLOR_STRATEGIES,
    TYPOGRAPHY_PRESETS,
    SPACING_SCALES
  };
}
