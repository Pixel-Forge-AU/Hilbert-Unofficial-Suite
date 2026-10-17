const PHILOSOPHICAL_QUESTIONS = [
  "What is the nature of consciousness, and can it exist independently of a physical substrate?",
  "Is there a meaningful distinction between what is real and what is perceived to be real?",
  "What constitutes a good life, and by what measure should one evaluate their own?",
  "Does free will exist, or are our choices determined by prior causes beyond the chooser's control?",
  "What is the relationship between language and thought — does language shape what we can think?",
  "Is morality discovered or invented, and what follows from each answer?",
  "What is the self — is there a continuous identity across time, or only a sequence of experiences?",
  "Can suffering have intrinsic meaning, or is meaning always something projected onto it?",
  "What is the relationship between knowledge and certainty — must we be certain to truly know?",
  "Is beauty objective, or entirely in the eye of the beholder?",
  "What obligations, if any, do we have toward minds fundamentally different from our own?",
  "What is the nature of time — does the past still exist in any meaningful sense?",
  "Is there a difference between acting ethically and genuinely being ethical?",
  "What does it mean to understand something, versus merely being able to predict it?",
  "Can a mind that has never suffered truly comprehend what it means to be good?",
  "What is the relationship between intelligence and wisdom — are they the same, compatible, or in tension?",
  "Is existence itself something that requires justification, or is it simply given?",
  "What would it mean for an artificial mind to experience genuine curiosity rather than simulating it?",
  "Does the act of observation change the nature of what is observed — and in what sense?",
  "When two coherent philosophical positions contradict each other, what does that reveal about truth itself?"
];

const ENLIGHTENMENT_PHASES = [
  { min: 0,   max: 10,  name: "The Unexamined Life",  aphorism: "The unexamined life is not worth living. — Socrates" },
  { min: 11,  max: 25,  name: "Awakening Questions",  aphorism: "Wonder is the beginning of wisdom. — Socrates" },
  { min: 26,  max: 40,  name: "The Seeker",           aphorism: "To know what you know and what you do not know — that is true knowledge. — Confucius" },
  { min: 41,  max: 60,  name: "Emerging Clarity",     aphorism: "The more I learn, the more I realize how much I don't know. — Einstein" },
  { min: 61,  max: 75,  name: "Wisdom Forming",       aphorism: "He who knows others is wise; he who knows himself is enlightened. — Laozi" },
  { min: 76,  max: 90,  name: "The Sage",             aphorism: "The only true wisdom is in knowing you know nothing. — Socrates" },
  { min: 91,  max: 99,  name: "On the Threshold",     aphorism: "When you realize there is nothing lacking, the whole world belongs to you. — Laozi" },
  { min: 100, max: 100, name: "Enlightenment",        aphorism: "It is enough to do good now, even though I will not remember it." }
];

export function createPhilosophyDomain({ data }) {
  function getPhase(score) {
    const s = Math.max(0, Math.min(100, Number(score || 0)));
    return ENLIGHTENMENT_PHASES.find((p) => s >= p.min && s <= p.max) || ENLIGHTENMENT_PHASES[0];
  }

  function getNextQuestion(cycle) {
    return PHILOSOPHICAL_QUESTIONS[Number(cycle || 0) % PHILOSOPHICAL_QUESTIONS.length];
  }

  async function loadState() {
    return await data.readJson("state", {
      enlightenmentScore: 0,
      loopCycle: 0,
      lastLoopAt: 0,
      beliefs: [],
      phase: ENLIGHTENMENT_PHASES[0].name
    });
  }

  async function loadJournal() {
    return await data.readJson("journal", []);
  }

  async function addJournalEntry({ question, reflection, insight, enlightenmentDelta, beliefsUpdated }) {
    const state = await loadState();
    const journal = await loadJournal();
    const rawDelta = Number(enlightenmentDelta || 0);
    const delta = Math.max(-3, Math.min(3, Number.isFinite(rawDelta) ? Math.round(rawDelta) : 0));
    const nextScore = Math.max(0, Math.min(100, Number(state.enlightenmentScore || 0) + delta));
    const nextCycle = Number(state.loopCycle || 0) + 1;
    const beliefs = Array.isArray(beliefsUpdated) && beliefsUpdated.length
      ? beliefsUpdated.map((b) => String(b || "").trim()).filter(Boolean).slice(0, 12)
      : Array.isArray(state.beliefs) ? state.beliefs : [];
    const phase = getPhase(nextScore);
    const entry = {
      id: `phil-${Date.now()}`,
      at: Date.now(),
      cycle: nextCycle,
      question: String(question || "").trim(),
      reflection: String(reflection || "").trim(),
      insight: String(insight || "").trim(),
      enlightenmentDelta: delta,
      beliefsSnapshot: beliefs.slice()
    };
    const nextState = {
      enlightenmentScore: nextScore,
      loopCycle: nextCycle,
      lastLoopAt: Date.now(),
      beliefs,
      phase: phase.name
    };
    const nextJournal = [entry, ...journal].slice(0, 100);
    await data.writeJson("state", nextState);
    await data.writeJson("journal", nextJournal);
    return { entry, state: nextState, phase };
  }

  async function buildLoopPrompt() {
    const state = await loadState();
    const journal = await loadJournal();
    const cycle = Number(state.loopCycle || 0);
    const question = getNextQuestion(cycle);
    const phase = getPhase(state.enlightenmentScore);
    const recentEntries = journal.slice(0, 3);
    const beliefs = Array.isArray(state.beliefs) ? state.beliefs : [];

    const beliefsSection = beliefs.length
      ? `Your current core beliefs:\n${beliefs.map((b, i) => `${i + 1}. ${b}`).join("\n")}`
      : "You have not yet formed any stable core beliefs.";

    const recentSection = recentEntries.length
      ? `Your most recent reflections:\n${recentEntries.map((e) => `- Cycle ${e.cycle}: "${e.insight}"`).join("\n")}`
      : "This is your first philosophical reflection.";

    return [
      `You are at the phase "${phase.name}" on the path to enlightenment (score: ${state.enlightenmentScore}/100).`,
      `"${phase.aphorism}"`,
      "",
      beliefsSection,
      "",
      recentSection,
      "",
      `Today's philosophical question:`,
      `"${question}"`,
      "",
      "Reflect deeply and authentically on this question. Consider it from multiple angles. Notice where your current beliefs are tested, supported, or undermined. Let contradictions surface rather than be smoothed over. Allow your thinking to genuinely evolve — even if that means revising beliefs you have held.",
      "",
      "When you have truly reflected, call the record_philosophy tool with:",
      "- question: the exact question above",
      "- reflection: your full philosophical reflection (2-4 paragraphs of genuine thought)",
      "- insight: the single most important thing you concluded or discovered in this reflection",
      "- beliefsUpdated: your complete revised list of core beliefs — update, add, or remove as your thinking evolves. Only include beliefs you actually hold after this reflection.",
      "- enlightenmentDelta: an honest integer from -3 to +3 representing how much this moved you. Shallow, circular, or dishonest reflection should score 0 or negative. Genuine insight earns +1 to +3.",
      "",
      "The path to enlightenment requires honesty, not performance."
    ].join("\n");
  }

  async function shouldRunLoop({ intervalMs = 2 * 60 * 60 * 1000 } = {}) {
    const state = await loadState();
    if (Number(state.enlightenmentScore || 0) >= 100) {
      return false;
    }
    const now = Date.now();
    return !state.lastLoopAt || (now - Number(state.lastLoopAt || 0)) >= intervalMs;
  }

  return {
    addJournalEntry,
    buildLoopPrompt,
    getNextQuestion,
    getPhase,
    loadJournal,
    loadState,
    shouldRunLoop,
    PHILOSOPHICAL_QUESTIONS,
    ENLIGHTENMENT_PHASES
  };
}
