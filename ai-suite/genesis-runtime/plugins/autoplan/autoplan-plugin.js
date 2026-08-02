/**
 * Plugin Name: Autoplan
 * Plugin Slug: autoplan
 * Description: Decision automation for worker agents. Injects six core decision principles
 *              into worker task prompts to auto-resolve common intermediate questions
 *              (completeness, DRY, explicit over clever, etc.). Also provides a tool for
 *              workers to explicitly invoke autoplan reasoning on a specific decision.
 *              Inspired by gstack's autoplan decision engine.
 * Version: 1.0.0
 * Author: Nova Observer
 */

// The six core decision principles from gstack's autoplan
const AUTOPLAN_PRINCIPLES = [
  {
    id: "completeness",
    title: "Choose Completeness",
    rule: "When choosing between a complete solution and a shortcut, always choose the complete solution. AI makes completeness nearly free - half-done work creates future debt.",
    examples: ["Write all needed tests, not just a few", "Handle all error cases, not just the happy path", "Fix the root cause, not just the symptom"]
  },
  {
    id: "blast-radius",
    title: "Fix the Full Blast Radius",
    rule: "When you find a bug or issue, fix it everywhere it appears, not just where you were asked. Search for similar patterns and address the whole class of problem.",
    examples: ["If one query lacks parameterization, find and fix all of them", "If one error is swallowed silently, audit all catch blocks", "If one endpoint lacks auth, verify all endpoints"]
  },
  {
    id: "pragmatic",
    title: "Choose the Cleaner Path",
    rule: "When two approaches solve the problem equally well, choose the one with less complexity and fewer moving parts. Simple code is easier to understand, test, and debug.",
    examples: ["A function is cleaner than a class if state is not needed", "One clear variable is better than three clever ones", "Explicit is better than implicit"]
  },
  {
    id: "dry",
    title: "Don't Repeat Yourself",
    rule: "Before creating something new (a helper, a pattern, a type), search the codebase for an existing solution. Prefer extending existing patterns over creating parallel ones.",
    examples: ["Search for similar utilities before writing a new one", "Extend existing error handling rather than adding a new pattern", "Use the project's established conventions"]
  },
  {
    id: "explicit",
    title: "Explicit Over Clever",
    rule: "Write code that is obviously correct, not impressively terse. Avoid magic, metaprogramming, or clever tricks when a straightforward approach works.",
    examples: ["A named function is better than a complex lambda", "Explicit type annotations beat inferred ambiguity", "Clear error messages beat cryptic codes"]
  },
  {
    id: "bias-to-action",
    title: "Bias Toward Action",
    rule: "When you have enough information to proceed, proceed. Don't ask for clarification on things you can reasonably infer. Make the decision and document your reasoning.",
    examples: ["If the intent is clear, implement it - don't ask for confirmation", "If a file path is ambiguous but one option is obviously correct, use it", "If a test name isn't specified, choose a descriptive one and move on"]
  }
];

function buildAutoplanPrinciplesNote(abridged = false) {
  if (abridged) {
    return [
      "Autoplan decision principles (apply when making intermediate decisions):",
      ...AUTOPLAN_PRINCIPLES.map((p) => `- ${p.title}: ${p.rule.split(".")[0]}.`)
    ].join("\n");
  }
  return [
    "Autoplan decision principles - apply these when you face a choice during this task:",
    ...AUTOPLAN_PRINCIPLES.map((p) => [
      `### ${p.title}`,
      p.rule,
      `Examples: ${p.examples.join("; ")}.`
    ].join("\n"))
  ].join("\n\n");
}

function resolveDecision(decision = "", context = "") {
  const text = `${decision} ${context}`.toLowerCase();

  // Heuristic matching for common decision types
  if (
    /should i fix\b|only fix\b|just fix\b|fix(?:ing)? (?:it|this|the same|this bug)\b/.test(text) &&
    /elsewhere|everywhere|\ball\b|other|multiple|several|same pattern|more than one/.test(text)
  ) {
    return {
      principle: "blast-radius",
      resolution: "Fix the full blast radius - find all similar instances and fix them all.",
      confidence: "high"
    };
  }
  if (/should i test\b|do i need test|write test/.test(text)) {
    return {
      principle: "completeness",
      resolution: "Yes - write the tests. Completeness is nearly free with AI assistance.",
      confidence: "high"
    };
  }
  if (/should i create|do i need a|i need a\b|new.*helper|new.*util|new.*function|need.*helper|need.*util/.test(text)) {
    return {
      principle: "dry",
      resolution: "Search the codebase first. If a similar utility already exists, extend or reuse it.",
      confidence: "medium"
    };
  }
  if (/simple\s+or\s+complex|minimal\s+or\s+full|class\s+or\s+function|add.*abstraction|need.*abstraction|simpler.*approach|which.*approach.*cleaner|cleaner.*approach/.test(text)) {
    return {
      principle: "pragmatic",
      resolution: "Choose the path with less complexity and fewer moving parts. If the simpler option solves the problem equally well, use it.",
      confidence: "high"
    };
  }
  if (/shortcut\s+or|complete\s+or\s+partial|full\s+solution\s+or/.test(text)) {
    return {
      principle: "completeness",
      resolution: "Choose the complete solution. Shortcuts create debt.",
      confidence: "high"
    };
  }
  if (/clever\s+or|magic\s+or|metaclass|metaprogramming/.test(text)) {
    return {
      principle: "explicit",
      resolution: "Choose the explicit, obvious approach over the clever one.",
      confidence: "high"
    };
  }
  if (/should i ask\b|should i clarify\b|need more info/.test(text)) {
    return {
      principle: "bias-to-action",
      resolution: "If you have enough information to proceed reasonably, proceed. Document your assumption.",
      confidence: "medium"
    };
  }

  // Default: return all principles for the agent to apply
  return {
    principle: "all",
    resolution: "Apply all autoplan principles: choose completeness, fix blast radius, prefer clean over clever, reuse before creating, be explicit, and bias toward action.",
    confidence: "low",
    principles: AUTOPLAN_PRINCIPLES.map((p) => ({ id: p.id, title: p.title, rule: p.rule }))
  };
}

export function createAutoplanPlugin(options = {}) {
  const {
    pluginId = "autoplan",
    pluginName = "Autoplan",
    description = "Injects decision principles into worker prompts to auto-resolve intermediate questions."
  } = options;

  const TOOL_DEFINITIONS = [
    {
      name: "autoplan_resolve",
      description: "Resolve a specific intermediate decision using autoplan principles. Describe the decision you face and get a concrete recommendation based on the six core principles.",
      scopes: ["worker", "intake"],
      parameters: {
        decision: "string (required) - the decision you are facing",
        context: "string - additional context about the situation"
      }
    },
    {
      name: "autoplan_principles",
      description: "Get the full text of all six autoplan decision principles. Use when you want to reason through a complex tradeoff with the full principles in front of you.",
      scopes: ["worker", "intake"],
      parameters: { abridged: "boolean - return a short summary instead of full principles (default false)" }
    },
    {
      name: "autoplan_checklist",
      description: "Run through the autoplan preflight checklist before starting a task: is the scope clear? is this complete or a shortcut? have I searched for existing solutions?",
      scopes: ["worker", "intake"],
      parameters: {
        taskDescription: "string (required) - what you are about to do"
      }
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
        data: false,
        tools: TOOL_DEFINITIONS.map((t) => t.name),
        capabilities: ["autoplan.decision"],
        hooks: [
          "intake:tool-call",
          "intake:tools:list",
          "intake:prompt:build",
          "worker:prompt:build"
        ],
        runtimeContext: []
      },
      dependencies: { requiredCapabilities: [], optionalCapabilities: [] },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) {
          api.registerTool(tool);
        }
      }

      if (typeof api.provideCapability === "function") {
        api.provideCapability("autoplan.decision", () => ({
          resolveDecision,
          AUTOPLAN_PRINCIPLES,
          buildAutoplanPrinciplesNote
        }), { priority: 10 });
      }

      if (typeof api.addHook !== "function") return;

      const injectPrinciples = (payload = {}, extra = []) => {
        const existingLines = Array.isArray(payload?.lines) ? payload.lines : [];
        return { ...payload, lines: [...existingLines, buildAutoplanPrinciplesNote(true), ...extra] };
      };

      // Inject abridged principles into every worker system prompt. Also remind workers
      // of the available autoplan tools so they know they can invoke them explicitly.
      api.addHook("worker:prompt:build", async (payload = {}) =>
        injectPrinciples(payload, [
          "When you face an intermediate decision during this task, call autoplan_resolve with the decision text. Use autoplan_principles for a full principles reference, or autoplan_checklist before starting a complex task."
        ])
      );

      // Inject abridged principles into the intake system prompt so the intake brain
      // makes better routing/clarify/enqueue decisions using the same principles.
      api.addHook("intake:prompt:build", async (payload = {}) => injectPrinciples(payload));

      api.addHook("intake:tools:list", async (payload = {}) => {
        const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
        for (const tool of TOOL_DEFINITIONS) {
          tools.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
        }
        return { ...payload, tools };
      });

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

        try {
          let result;

          if (name === "autoplan_resolve") {
            const decision = String(args.decision || "").trim();
            if (!decision) throw new Error("decision is required");
            result = {
              decision,
              ...resolveDecision(decision, String(args.context || ""))
            };

          } else if (name === "autoplan_principles") {
            result = {
              principles: AUTOPLAN_PRINCIPLES,
              summary: buildAutoplanPrinciplesNote(args.abridged === true)
            };

          } else if (name === "autoplan_checklist") {
            const taskDescription = String(args.taskDescription || "").trim();
            if (!taskDescription) throw new Error("taskDescription is required");
            const td = taskDescription.toLowerCase();
            const isBugFix = /\b(?:bug|fix|broken|crash|fail(?:ure)?|regression)\b/.test(td);
            const isNewCode = /\b(?:new|create|implement|build|write|introduce)\b/.test(td);
            const isRefactor = /\b(?:refactor|restructure|reorganize|rename|extract|clean(?:up)?)\b/.test(td);

            const preflight = [
              {
                check: "Is the task objective clear and verifiable?",
                principle: "completeness",
                action: "Confirm you can state the done condition in one sentence before proceeding."
              },
              {
                check: "Am I planning a complete solution or a shortcut?",
                principle: "completeness",
                action: "Choose the complete solution - shortcuts create debt."
              }
            ];

            if (isBugFix) {
              preflight.push({
                check: "This looks like a bug fix - have I searched for the same pattern elsewhere?",
                principle: "blast-radius",
                action: "Search the codebase for similar instances before closing the task. Fix the whole class of problem.",
                priority: "high"
              });
            }

            if (isNewCode) {
              preflight.push({
                check: "This involves creating something new - does a similar utility or pattern already exist?",
                principle: "dry",
                action: "Use list_files or read_file to check before writing new abstractions.",
                priority: "high"
              });
            }

            if (isRefactor) {
              preflight.push({
                check: "This is a refactor - am I keeping the interface stable or intentionally changing it?",
                principle: "pragmatic",
                action: "Choose the simpler resulting structure. Avoid adding complexity in the name of cleanliness."
              });
            }

            // Always include these
            preflight.push(
              ...(!isNewCode ? [{
                check: "Have I searched for existing patterns/utilities before creating new ones?",
                principle: "dry",
                action: "Use list_files or read_file to check for similar code before writing new abstractions."
              }] : []),
              {
                check: "Is my planned approach explicit and readable, or clever and opaque?",
                principle: "explicit",
                action: "Prefer the explicit approach. Write code that is obviously correct."
              },
              {
                check: "Am I over-asking for clarification on things I can reasonably infer?",
                principle: "bias-to-action",
                action: "If intent is clear enough to proceed, proceed. Document assumptions in your final summary."
              }
            );

            if (!isBugFix) {
              preflight.push({
                check: "If I encounter a bug while working, should I search for the same pattern elsewhere?",
                principle: "blast-radius",
                action: "Yes - fix the full class of problem, not just the instance you were shown."
              });
            }

            result = { taskDescription, preflight };
          }

          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { error: true, message: String(error?.message || error || "autoplan error") }
          };
        }
      });
    }
  };
}
