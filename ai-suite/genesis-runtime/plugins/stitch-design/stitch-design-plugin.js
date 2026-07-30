/**
 * Plugin Name: Stitch Design
 * Plugin Slug: stitch-design
 * Description: Generate Google Stitch compatible DESIGN.md files from live websites using screenshots, DOM design signals, and optional Observer vision-worker refinement.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import { createStitchDesignDomain } from "./lib/stitch-design-domain.js";

const TOOL_DEFINITIONS = [
  {
    name: "stitch_design_from_website",
    description: "Capture any public website and generate a Google Stitch compatible DESIGN.md. Writes DESIGN.md and screenshots under observer-output/stitch-design by default, and queues a vision worker refinement unless queueVision:false.",
    scopes: ["worker"],
    risk: "normal",
    parameters: {
      url: "string (required) - website URL to capture",
      name: "string - optional design system name",
      outputDir: "string - optional folder under OBSERVER_OUTPUT_ROOT; default observer-output/stitch-design/<site>",
      queueVision: "boolean - queue Observer vision worker to refine from screenshots (default true)",
      visionBrainId: "string - optional vision worker brain id (default routing vision worker)",
      writeFile: "boolean - write DESIGN.md and screenshots to observer-output (default true)",
      fullPage: "boolean - capture full-page screenshots (default true)",
      timeoutMs: "number - page navigation timeout, 5000-60000",
      viewports: "array - optional viewport objects with name,width,height"
    }
  },
  {
    name: "stitch_design_template",
    description: "Generate a blank Google Stitch compatible DESIGN.md template, optionally seeded with URL/name and manual vision notes.",
    scopes: ["worker"],
    risk: "normal",
    parameters: {
      url: "string - source URL label",
      name: "string - design system name",
      visionNotes: "object - optional summary, visualStyle, colors, components, dos, donts"
    }
  }
];

export function createStitchDesignPlugin(options = {}) {
  const {
    pluginId = "stitch-design",
    pluginName = "Stitch Design",
    description = "Website to Google Stitch DESIGN.md generator with screenshot capture and vision-worker refinement."
  } = options;

  let domain = null;

  function getDomain(api) {
    if (!domain) {
      domain = createStitchDesignDomain({ runtimeContext: api?.getRuntimeContext?.() || {} });
    }
    return domain;
  }

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
        data: false,
        tools: TOOL_DEFINITIONS.map((tool) => tool.name),
        capabilities: ["stitch-design.generate"],
        hooks: ["intake:tool-call"],
        runtimeContext: [
          "OBSERVER_CONTAINER_OUTPUT_ROOT",
          "OBSERVER_OUTPUT_ROOT",
          "createQueuedTask",
          "fs",
          "getObserverConfig",
          "path"
        ]
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
        api.provideCapability("stitch-design.generate", (args = {}) => getDomain(api).generateFromWebsite(args), { priority: 10 });
      }

      if (typeof api.addHook !== "function") return;

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) return payload;
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        try {
          const d = getDomain(api);
          const result = name === "stitch_design_template"
            ? d.buildTemplate(args)
            : await d.generateFromWebsite(args);
          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: {
              ok: false,
              error: true,
              message: String(error?.message || error || "stitch design error"),
              hint: String(error?.message || "").includes("Playwright")
                ? "Install Playwright in nova-observer, or enable the existing browser tooling dependency."
                : undefined
            }
          };
        }
      });
    }
  };
}

export default createStitchDesignPlugin;
