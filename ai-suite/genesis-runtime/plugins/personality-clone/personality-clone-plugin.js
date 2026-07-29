/**
 * Plugin Name: Personality Clone
 * Plugin Slug: personality-clone
 * Description: Distills message/document history into reusable persona, work, and skill artifacts.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import {
  applyPersonaCorrection,
  buildCloneArtifacts,
  buildCombinedSkillMarkdown,
  buildIncrementalMerge,
  buildPersonaMarkdown,
  buildWorkMarkdown,
  analyzePersonalityClone
} from "./lib/personality-clone-domain.js";

const TOOL_DEFINITIONS = [
  {
    name: "personality_clone_analyze_history",
    description: "Analyze a person's history and return structured expression, decision, work, and evidence buckets for building a personality clone.",
    scopes: ["worker", "intake"],
    risk: "normal",
    parameters: {
      name: "string - display name for the person",
      targetName: "string - sender name to filter structured chat exports",
      text: "string - raw pasted history",
      sources: "array - source objects with id, kind, content",
      manualTags: "array - explicit traits or culture tags",
      identity: "object - optional company, level, role"
    }
  },
  {
    name: "personality_clone_build_artifacts",
    description: "Build persona.md, work.md, and combined SKILL.md content from message/document history and manual tags.",
    scopes: ["worker", "intake"],
    risk: "normal",
    parameters: {
      name: "string - display name for the person",
      targetName: "string - sender name to filter structured chat exports",
      text: "string - raw pasted history",
      sources: "array - source objects with id, kind, content",
      manualTags: "array - explicit traits or culture tags",
      identity: "object - optional company, level, role"
    }
  },
  {
    name: "personality_clone_apply_correction",
    description: "Append a high-priority persona correction entry when the clone behaves unlike the source person.",
    scopes: ["worker", "intake"],
    risk: "normal",
    parameters: {
      personaMarkdown: "string - existing persona.md content",
      scene: "string - situation where the correction applies",
      wrong: "string - behavior the clone incorrectly used",
      correct: "string - behavior the real person would use"
    }
  },
  {
    name: "personality_clone_incremental_merge",
    description: "Analyze new history against an existing clone and return append-only work/persona patches plus conflict-safe evidence.",
    scopes: ["worker", "intake"],
    risk: "normal",
    parameters: {
      existingWorkMarkdown: "string - existing work.md content",
      existingPersonaMarkdown: "string - existing persona.md content",
      name: "string - display name for the person",
      targetName: "string - sender name to filter structured chat exports",
      text: "string - new raw history",
      sources: "array - new source objects with id, kind, content",
      manualTags: "array - explicit traits or culture tags"
    }
  }
];

function handled(payload, result) {
  return { ...payload, handled: true, result };
}

function buildToolError(payload, error) {
  return handled(payload, {
    error: true,
    message: String(error?.message || error || "personality clone tool failed")
  });
}

export function createPersonalityClonePlugin(options = {}) {
  const {
    pluginId = "personality-clone",
    pluginName = "Personality Clone",
    description = "Builds reusable personality clone artifacts from observed history."
  } = options;

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
        capabilities: ["personality-clone.build"],
        hooks: [
          "intake:tool-call",
          "intake:tools:list"
        ],
        runtimeContext: []
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: {
        isolation: "inprocess"
      }
    },

    async init(api) {
      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) {
          api.registerTool(tool);
        }
      }

      if (typeof api.provideCapability === "function") {
        api.provideCapability("personality-clone.build", () => ({
          analyzePersonalityClone,
          buildCloneArtifacts,
          buildPersonaMarkdown,
          buildWorkMarkdown,
          buildCombinedSkillMarkdown,
          applyPersonaCorrection,
          buildIncrementalMerge
        }), { priority: 10 });
      }

      if (typeof api.addHook !== "function") {
        return;
      }

      api.addHook("intake:tools:list", async (payload = {}) => {
        const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
        for (const tool of TOOL_DEFINITIONS) {
          tools.push({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          });
        }
        return { ...payload, tools };
      });

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
        if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
          return payload;
        }

        try {
          if (name === "personality_clone_analyze_history") {
            return handled(payload, analyzePersonalityClone(args));
          }

          if (name === "personality_clone_build_artifacts") {
            return handled(payload, buildCloneArtifacts(args));
          }

          if (name === "personality_clone_apply_correction") {
            return handled(payload, {
              personaMarkdown: applyPersonaCorrection(args)
            });
          }

          if (name === "personality_clone_incremental_merge") {
            return handled(payload, buildIncrementalMerge(args));
          }

          return payload;
        } catch (error) {
          return buildToolError(payload, error);
        }
      });
    }
  };
}

export default createPersonalityClonePlugin;
