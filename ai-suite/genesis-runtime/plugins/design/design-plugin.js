/**
 * Plugin Name: Design
 * Plugin Slug: design
 * Description: Design system generation, multi-variant exploration (shotgun), and HTML output
 *              from design specs. Inspired by gstack's design pipeline. Provides workers with
 *              structured tools for creating design tokens, variants, and production HTML.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import { createDesignDomain } from "./lib/design-domain.js";

export function createDesignPlugin(options = {}) {
  const {
    pluginId = "design",
    pluginName = "Design",
    description = "Design system generation, variant exploration, and HTML output."
  } = options;

  let domain = null;

  function getDomain(api) {
    if (!domain) {
      domain = createDesignDomain({ data: api?.data ?? null });
    }
    return domain;
  }

  const TOOL_DEFINITIONS = [
    {
      name: "design_system_generate",
      description: "Generate a complete design system (color tokens, typography, spacing, component specs, CSS variables) from a brief. Returns structured tokens and CSS custom properties ready to use.",
      scopes: ["worker"],
      parameters: {
        brief: "string — what the design is for (e.g. 'SaaS dashboard for developers')",
        name: "string — project/system name",
        colorStrategy: "string: amber_terminal|ocean|forest|slate_light|rose",
        typography: "string: terminal|modern|editorial|humanist|minimal",
        spacing: "string: compact|default|relaxed"
      }
    },
    {
      name: "design_variants",
      description: "Generate multiple design variants (shotgun approach) that differ in color strategy, typography, and spacing density. Returns 2-5 variants for comparison. Use to explore options before committing.",
      scopes: ["worker"],
      parameters: {
        brief: "string — what the design is for",
        count: "number — number of variants to generate (2-5, default 3)"
      }
    },
    {
      name: "design_to_html",
      description: "Convert a design system spec (from design_system_generate) into a production-ready HTML/CSS preview file. Pass the full system object returned by design_system_generate.",
      scopes: ["worker"],
      parameters: {
        system: "object — the design system returned by design_system_generate",
        outputPath: "string — optional path to write the HTML file to"
      }
    },
    {
      name: "design_list_options",
      description: "List all available color strategies, typography presets, and spacing scales that can be used with design_system_generate.",
      scopes: ["worker"],
      parameters: {}
    },
    {
      name: "design_save_preference",
      description: "Record that a specific design variant was chosen/preferred. Used to build aesthetic taste over time.",
      scopes: ["worker"],
      parameters: {
        variantName: "string — name or color strategy of the chosen variant",
        reason: "string — why this variant was preferred"
      }
    },
    {
      name: "design_get_preferences",
      description: "Get the stored aesthetic preferences and which design styles have been chosen most often.",
      scopes: ["worker"],
      parameters: {}
    }
  ];

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: false,
        uiPanels: false,
        data: true,
        tools: TOOL_DEFINITIONS.map((t) => t.name),
        capabilities: ["design.system"],
        hooks: ["intake:tool-call"],
        runtimeContext: ["fs", "path"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) {
          api.registerTool(tool);
        }
      }

      if (typeof api.provideCapability === "function") {
        api.provideCapability("design.system", () => getDomain(api), { priority: 10 });
      }

      if (typeof api.addHook !== "function") return;

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

        const d = getDomain(api);

        try {
          let result;

          if (name === "design_system_generate") {
            result = d.buildDesignSystem({
              brief: String(args.brief || "").trim(),
              name: String(args.name || "Design System").trim(),
              colorStrategy: String(args.colorStrategy || "amber_terminal"),
              typography: String(args.typography || "terminal"),
              spacing: String(args.spacing || "default")
            });

          } else if (name === "design_variants") {
            const count = Math.max(2, Math.min(5, Number(args.count || 3)));
            result = {
              variants: d.buildVariants(String(args.brief || "").trim(), count),
              instruction: `${count} variants generated. Review differentiators and select the one that best fits the brief. Call design_save_preference to record your choice.`
            };

          } else if (name === "design_to_html") {
            const system = args.system && typeof args.system === "object" ? args.system : {};
            const html = d.buildHtmlFromSpec(system);
            const outputPath = String(args.outputPath || "").trim();
            let written = false;
            if (outputPath) {
              const ctx = api?.getRuntimeContext?.() ?? {};
              const fsModule = ctx.fs;
              const pathModule = ctx.path;
              if (fsModule && pathModule) {
                await fsModule.mkdir(pathModule.dirname(outputPath), { recursive: true });
                await fsModule.writeFile(outputPath, html, "utf8");
                written = true;
              }
            }
            result = { html, outputPath: outputPath || null, charCount: html.length, written };

          } else if (name === "design_list_options") {
            result = {
              colorStrategies: Object.keys(d.COLOR_STRATEGIES),
              typographyPresets: Object.keys(d.TYPOGRAPHY_PRESETS),
              spacingScales: Object.keys(d.SPACING_SCALES)
            };

          } else if (name === "design_save_preference") {
            await d.savePreference({
              colorStrategy: String(args.variantName || "").trim(),
              reason: String(args.reason || "").trim()
            });
            result = { saved: true };

          } else if (name === "design_get_preferences") {
            result = await d.loadPreferences();
          }

          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { error: true, message: String(error?.message || error || "design error") }
          };
        }
      });
    }
  };
}
