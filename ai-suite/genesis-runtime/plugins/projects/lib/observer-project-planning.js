export function createObserverProjectPlanning(context = {}) {
  const {
    PROJECT_ROLE_PLAYBOOKS,
    compactTaskText,
    getProjectConfig,
    inspectWorkspaceProject,
    moveContainerPath,
    normalizeSummaryComparisonText,
    path,
    readContainerFile,
    writeContainerTextFile
  } = context;
  const PROJECT_PHASE_ORDER = ["directive", "intake", "scoping", "implementation", "quality", "finalization"];
  const PROJECT_PHASE_LABELS = {
    directive: "Directive",
    intake: "Intake",
    scoping: "Scoping",
    implementation: "Implementation",
    quality: "Quality",
    finalization: "Finalization"
  };
  const WORKSTREAM_LABELS = {
    creative: "Creative",
    research: "Research",
    frontend: "Front-end",
    backend: "Back-end",
    full_stack: "Full-stack",
    ops: "Operations",
    content: "Content",
    general: "General"
  };
  const PROJECT_PHASE_LABEL_LOOKUP = Object.fromEntries(
    Object.entries(PROJECT_PHASE_LABELS).map(([key, label]) => [String(label || "").trim().toLowerCase(), key])
  );
  const WORKSTREAM_LABEL_LOOKUP = Object.fromEntries(
    Object.entries(WORKSTREAM_LABELS).map(([key, label]) => [String(label || "").trim().toLowerCase(), key])
  );
  const CREATIVE_ROLE_NAMES = new Set([
    "Story Architect",
    "Developmental Editor",
    "Line Editor",
    "Continuity Editor",
    "Character Writer",
    "Worldbuilding Designer"
  ]);
  const CREATIVE_PRIMARY_ROLE_NAMES = new Set([
    "Story Architect",
    "Developmental Editor",
    "Line Editor",
    "Continuity Editor",
    "Character Writer"
  ]);
  const SCOPING_ROLE_NAMES = new Set([
    "Project Manager",
    "Product Manager",
    "Business Analyst",
    "Technical Architect / Solutions Architect",
    "Support Engineer",
    "Content Designer"
  ]);
  const IMPLEMENTATION_ROLE_NAMES = new Set([
    "Front-End Developer",
    "Front-End Framework Developer",
    "UI Designer",
    "Back-End Developer",
    "Database Engineer",
    "Full-Stack Developer",
    "DevOps Engineer",
    "Cloud Engineer",
    "Content Designer",
    "Graphic Designer",
    "Brand Designer",
    "Motion Designer",
    "Automation QA Engineer"
  ]);
  const QUALITY_ROLE_NAMES = new Set([
    "QA Tester",
    "Automation QA Engineer",
    "Accessibility Specialist",
    "Security Engineer",
    "Penetration Tester",
    "Web Administrator",
    "SEO Specialist",
    "CRO Specialist"
  ]);
  const FINALIZATION_ROLE_NAMES = new Set([
    "Project Manager",
    "QA Tester",
    "Accessibility Specialist",
    "SEO Specialist",
    "Copywriter",
    "Content Manager",
    "Digital Marketer",
    "Community Manager",
    "Web Administrator",
    "CRO Specialist",
    "Security Engineer"
  ]);
  const FRONTEND_ROLE_NAMES = new Set([
    "Front-End Developer",
    "Front-End Framework Developer",
    "UI Designer",
    "Graphic Designer",
    "Brand Designer",
    "Motion Designer",
    "Accessibility Specialist",
    "SEO Specialist",
    "CRO Specialist",
    "Web Administrator"
  ]);
  const BACKEND_ROLE_NAMES = new Set([
    "Back-End Developer",
    "Database Engineer",
    "Full-Stack Developer",
    "Security Engineer",
    "Penetration Tester",
    "Cloud Engineer",
    "DevOps Engineer"
  ]);
  const OPS_ROLE_NAMES = new Set([
    "DevOps Engineer",
    "Cloud Engineer",
    "Web Administrator"
  ]);
  const CONTENT_ROLE_NAMES = new Set([
    "Content Designer",
    "Support Engineer",
    "Copywriter",
    "Content Manager",
    "Community Manager"
  ]);
  const MARKETING_ROLE_NAMES = new Set([
    "SEO Specialist",
    "Copywriter",
    "Content Manager",
    "Digital Marketer",
    "Community Manager",
    "CRO Specialist"
  ]);
  const EXPLICIT_ROLE_SIGNAL_PATTERNS = {
    "Accessibility Specialist": [/\baccessib/i, /\ba11y\b/i, /\bwcag\b/i, /\bcontrast\b/i, /\bkeyboard\b/i, /\baria\b/i, /\bscreen reader\b/i, /\bsemantic\b/i],
    "QA Tester": [/\bqa\b/i, /\btest\b/i, /\bverify\b/i, /\bregression\b/i, /\bbug\b/i],
    "Automation QA Engineer": [/\btest automation\b/i, /\bsmoke test\b/i, /\bautomation\b/i, /\bcoverage\b/i, /\bregression\b/i],
    "Security Engineer": [/\bsecurity\b/i, /\bauth\b/i, /\bauthori[sz]ation\b/i, /\bsecret\b/i, /\bvulnerab/i, /\bxss\b/i, /\bcsrf\b/i, /\binjection\b/i],
    "Penetration Tester": [/\bpen(?:-| )?test\b/i, /\bsecurity audit\b/i, /\bvulnerab/i],
    "SEO Specialist": [/\bseo\b/i, /\bmetadata\b/i, /\bmeta tags?\b/i, /\bsitemap\b/i, /\bschema\b/i, /\bdiscoverab/i],
    "Copywriter": [/\bcopy\b/i, /\bheadline\b/i, /\bcta\b/i, /\bmessaging\b/i],
    "Digital Marketer": [/\bmarketing\b/i, /\bcampaign\b/i, /\blanding page\b/i, /\bad(s|vert)\b/i],
    "Community Manager": [/\bcommunity\b/i, /\bannouncement\b/i, /\brelease notes\b/i],
    "CRO Specialist": [/\bcro\b/i, /\bconversion\b/i, /\bexperiment\b/i, /\bcta\b/i]
  };

  function getProjectImplementationRoot(project, inspection) {
    const projectPath = String(project?.path || "").trim();
    if (!projectPath) {
      return "";
    }
    return projectPath;
  }

  function getProjectSpecialtyEvidence(project = {}, inspection = {}, focus = "") {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const directories = Array.isArray(inspection?.directories) ? inspection.directories : [];
    const corpus = [
      String(project?.name || "").trim(),
      String(project?.path || "").trim(),
      String(focus || "").trim(),
      files.join("\n"),
      directories.join("\n")
    ].join("\n").toLowerCase();
    const creativePatterns = [
      /\b(story|novel|novella|manuscript|chapter|scene|outline|arc|draft|dialogue|voice|pacing|front matter|end matter|reading copy|character|characters|world|lore)\b/g,
      /(^|\/)(manuscript|outline|chapters?|scenes?|characters?|story-bible|world|lore)(\/|$)/g
    ];
    const researchPatterns = [
      /\b(research|scientific|science|literature review|evidence synthesis|peer[- ]reviewed|citations?|references|study|studies|journal|paper|papers|findings|methodology|hypothesis|analysis|dataset|biology|biological|biochem(?:istry)?|chemistry|chemical|metabolic|pathway|pathways|genetic|genomics|proteomics|clinical|bioinformatics)\b/g,
      /(^|\/)(research|papers?|literature|findings|evidence|references|citations?|studies|datasets?)(\/|$)/g
    ];
    const codePatterns = [
      /\b(package\.json|tsconfig|vite|webpack|api|frontend|backend|plugin|component|build|tests?)\b/g,
      /\.(js|jsx|ts|tsx|php|css|scss|sass|py|java|go|rs|c|cpp|cs)$/g,
      /(^|\/)(src|app|lib|components?|pages|includes|server|api|assets)(\/|$)/g
    ];
    let creativeScore = 0;
    let researchScore = 0;
    let codeScore = 0;
    for (const pattern of creativePatterns) {
      const matches = corpus.match(pattern);
      creativeScore += matches ? matches.length : 0;
    }
    for (const pattern of researchPatterns) {
      const matches = corpus.match(pattern);
      researchScore += matches ? matches.length : 0;
    }
    for (const pattern of codePatterns) {
      const matches = corpus.match(pattern);
      codeScore += matches ? matches.length : 0;
    }
    if (inspection?.hasPackageJson) {
      codeScore += 4;
    }
    if (inspection?.hasSource) {
      codeScore += 4;
    }
    const hasStrongCreativeStructure = files.some((file) => /(^|\/)(chapter-[^/]+|chapter\d+|scene-[^/]+|scene\d+|novella-draft|manuscript|story-outline|story-bible|character-sheet|world-guide)\.[a-z0-9]+$/i.test(String(file || "").trim()))
      || directories.some((directory) => /(^|\/)(manuscript|outline|chapters?|scenes?|characters?|story-bible|world|lore|notes)(\/|$)/i.test(String(directory || "").trim()));
    const hasCreativePrimaryInputs = files.some((file) => /(^|\/)(manuscript|outline|chapters?|scenes?|characters?|story-bible|world|lore|notes)\//i.test(String(file || "").trim()));
    const hasResearchPrimaryInputs = files.some((file) => /(^|\/)(research|papers?|literature|findings|evidence|references|citations?|studies|datasets?)\//i.test(String(file || "").trim()))
      || directories.some((directory) => /(^|\/)(research|papers?|literature|findings|evidence|references|citations?|studies|datasets?)(\/|$)/i.test(String(directory || "").trim()));
    const markdownFileCount = files.filter((file) => /\.md$/i.test(String(file || "").trim())).length;
    return {
      creativeScore,
      researchScore,
      codeScore,
      hasStrongCreativeStructure,
      hasCreativePrimaryInputs,
      hasResearchPrimaryInputs,
      markdownFileCount
    };
  }

  function inferProjectCycleSpecialty(project = {}, todoState = {}, focus = "") {
    const inspection = todoState?.inspection || {};
    const focusText = String(focus || "").trim().toLowerCase();
    if (
      /\b(readme(?:\.md)?|documentation|docs?|setup|installation|getting started|current status|status report|overview|guide)\b/.test(focusText)
    ) {
      return "document";
    }
    if (
      /\b(research|scientific|science|literature review|evidence synthesis|peer[- ]reviewed|citations?|references|study|studies|journal|paper|papers|biology|biological|biochem(?:istry)?|chemistry|chemical|metabolic|pathway|pathways|genetic|genomics|proteomics|clinical|bioinformatics)\b/.test(focusText)
    ) {
      return "retrieval";
    }
    const {
      creativeScore,
      researchScore,
      codeScore,
      hasStrongCreativeStructure,
      hasCreativePrimaryInputs,
      hasResearchPrimaryInputs,
      markdownFileCount
    } = getProjectSpecialtyEvidence(project, inspection, focus);
    if (
      hasStrongCreativeStructure
      && (
        !inspection?.hasPackageJson
        || (!inspection?.hasSource && markdownFileCount >= 2)
        || creativeScore >= Math.max(2, codeScore)
        || hasCreativePrimaryInputs
      )
    ) {
      return "creative";
    }
    if (creativeScore >= 2 && codeScore === 0 && markdownFileCount >= 2) {
      return "creative";
    }
    if (creativeScore >= Math.max(3, codeScore + 2)) {
      return "creative";
    }
    if (
      hasResearchPrimaryInputs
      && (
        !inspection?.hasPackageJson
        || (!inspection?.hasSource && markdownFileCount >= 1)
        || researchScore >= Math.max(2, codeScore)
      )
    ) {
      return "retrieval";
    }
    if (researchScore >= Math.max(4, codeScore + 1, creativeScore + 1)) {
      return "retrieval";
    }
    if (researchScore >= 2 && codeScore === 0 && markdownFileCount >= 1) {
      return "retrieval";
    }
    return "code";
  }

  function getProjectPhaseIndex(phase = "") {
    const index = PROJECT_PHASE_ORDER.indexOf(String(phase || "").trim().toLowerCase());
    return index >= 0 ? index : PROJECT_PHASE_ORDER.indexOf("scoping");
  }

  function isProjectPhaseAtLeast(assessment = {}, phase = "") {
    return getProjectPhaseIndex(assessment?.phase) >= getProjectPhaseIndex(phase);
  }

  function normalizeProjectAssessmentSummary(assessment = {}, { source = "" } = {}) {
    if (!assessment || typeof assessment !== "object") {
      return null;
    }
    const normalizedPhaseLabel = compactTaskText(String(assessment?.phaseLabel || "").trim(), 80);
    const phase = String(assessment?.phase || PROJECT_PHASE_LABEL_LOOKUP[normalizedPhaseLabel.toLowerCase()] || "").trim().toLowerCase();
    const normalizedWorkstreamLabel = compactTaskText(String(assessment?.workstreamLabel || "").trim(), 80);
    const workstream = String(assessment?.workstream || WORKSTREAM_LABEL_LOOKUP[normalizedWorkstreamLabel.toLowerCase()] || "").trim().toLowerCase();
    const currentPriority = compactTaskText(String(assessment?.currentPriority || "").trim(), 240);
    const deferredPosture = compactTaskText(String(assessment?.deferredPosture || "").trim(), 240);
    const hasMeaningfulContent = Boolean(phase || normalizedPhaseLabel || workstream || normalizedWorkstreamLabel || currentPriority || deferredPosture);
    if (!hasMeaningfulContent) {
      return null;
    }
    const inferredDeferred = deferredPosture
      ? /\bdefer(?:red)?\b/i.test(deferredPosture)
      : (phase ? getProjectPhaseIndex(phase) < getProjectPhaseIndex("quality") : false);
    return {
      phase,
      phaseLabel: PROJECT_PHASE_LABELS[phase] || normalizedPhaseLabel || "Scoping",
      phaseIndex: getProjectPhaseIndex(phase || "scoping"),
      workstream,
      workstreamLabel: WORKSTREAM_LABELS[workstream] || normalizedWorkstreamLabel || "General",
      currentPriority: currentPriority || "",
      deferLatePassAudits: assessment?.deferLatePassAudits === true || inferredDeferred,
      deferredPosture: deferredPosture || "",
      source: String(source || assessment?.source || "").trim() || "snapshot"
    };
  }

  function parseProjectAssessmentSnapshot(roleTaskContent = "", fallbackAssessment = null) {
    const parsed = {};
    let currentSection = "";
    for (const rawLine of String(roleTaskContent || "").split(/\r?\n/)) {
      const line = String(rawLine || "");
      const headingMatch = line.match(/^\s*##\s+(.+?)\s*$/);
      if (headingMatch) {
        currentSection = String(headingMatch[1] || "").trim();
        continue;
      }
      if (currentSection !== "Assessment Snapshot") {
        continue;
      }
      const phaseMatch = line.match(/^\s*[-*]\s+Phase:\s*(.+?)\s*$/i);
      if (phaseMatch) {
        parsed.phaseLabel = compactTaskText(String(phaseMatch[1] || "").trim(), 80);
        continue;
      }
      const workstreamMatch = line.match(/^\s*[-*]\s+Primary track:\s*(.+?)\s*$/i);
      if (workstreamMatch) {
        parsed.workstreamLabel = compactTaskText(String(workstreamMatch[1] || "").trim(), 80);
        continue;
      }
      const priorityMatch = line.match(/^\s*[-*]\s+Current priority:\s*(.+?)\s*$/i);
      if (priorityMatch) {
        parsed.currentPriority = compactTaskText(String(priorityMatch[1] || "").trim(), 240);
        continue;
      }
      const postureMatch = line.match(/^\s*[-*]\s+Deferred posture:\s*(.+?)\s*$/i);
      if (postureMatch) {
        parsed.deferredPosture = compactTaskText(String(postureMatch[1] || "").trim(), 240);
      }
    }
    const normalizedFallback = normalizeProjectAssessmentSummary(fallbackAssessment, { source: "live" });
    return normalizeProjectAssessmentSummary(
      {
        ...parsed,
        ...(normalizedFallback && typeof normalizedFallback === "object" ? normalizedFallback : {})
      },
      { source: normalizedFallback ? "live" : "snapshot" }
    );
  }

  function buildProjectAssessment(project = {}, inspection = {}, directiveState = {}, { todoState = null } = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const directories = Array.isArray(inspection?.directories) ? inspection.directories : [];
    const specialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const packageFile = pickInspectionFile(inspection, [/package\.json$/i]);
    const readmeFile = pickInspectionFile(inspection, [/readme\.md$/i]);
    const archiveFile = pickInspectionFile(inspection, [/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i]);
    const directivePath = String(directiveState?.path || findProjectDirectiveFile(inspection) || "").trim();
    const directiveObjectiveText = compactTaskText(String(directiveState?.objectiveText || "").trim(), 220);
    const directiveUncheckedCount = Array.isArray(directiveState?.uncheckedItems) ? directiveState.uncheckedItems.length : 0;
    const directiveCheckedCount = Array.isArray(directiveState?.checkedItems) ? directiveState.checkedItems.length : 0;
    const directiveAuthoritative = Boolean(directiveState?.authoritative || directivePath);
    const markdownFileCount = files.filter((file) => /\.(md|mdx|txt)$/i.test(String(file || "").trim())).length;
    const codeFileCount = files.filter((file) => /\.(js|jsx|ts|tsx|mjs|cjs|py|php|rb|go|rs|java|cs|cpp|c)$/i.test(String(file || "").trim())).length;
    const styleFileCount = files.filter((file) => /\.(css|scss|sass|less)$/i.test(String(file || "").trim())).length;
    const markupFileCount = files.filter((file) => /\.(html|htm|vue|svelte)$/i.test(String(file || "").trim())).length;
    const backendFileCount = files.filter((file) => /\.(php|py|rb|go|rs|java|cs)$/i.test(String(file || "").trim())).length
      + directories.filter((directory) => /(^|\/)(server|api|backend|includes)(\/|$)/i.test(String(directory || "").trim())).length;
    const manuscriptFileCount = files.filter((file) => /(^|\/)(chapter-[^/]+|chapter\d+|scene-[^/]+|scene\d+|novella-draft|manuscript|story-outline|story-bible|character-sheet|world-guide)\.[a-z0-9]+$/i.test(String(file || "").trim())).length;
    const creativeNoteCount = files.filter((file) => /(^|\/)(outline|chapters?|scenes?|characters?|story-bible|world|lore|notes)(\/|$)/i.test(String(file || "").trim())).length;
    const marketingFileCount = files.filter((file) => /(^|\/)(landing|campaign|pricing|marketing|copy|seo|newsletter|blog)[^/]*\.(md|html|txt|json)$/i.test(String(file || "").trim())).length;
    const hasConcreteNonArchiveFiles = files.some((file) => {
      const normalized = String(file || "").trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      if (["project-todo.md", "project-role-tasks.md", "readme.md"].includes(normalized)) {
        return false;
      }
      return !/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i.test(normalized);
    });
    const archiveOnlyInput = Boolean(archiveFile && !hasConcreteNonArchiveFiles);
    const hasFrontendSurface = Boolean(
      styleFileCount
      || markupFileCount
      || files.some((file) => /\.(jsx?|tsx?)$/i.test(String(file || "").trim()))
      || directories.some((directory) => /(^|\/)(src|app|components?|pages|public|assets)(\/|$)/i.test(String(directory || "").trim()))
    );
    const hasBackendSurface = Boolean(
      backendFileCount
      || directories.some((directory) => /(^|\/)(server|api|backend|includes)(\/|$)/i.test(String(directory || "").trim()))
    );
    const hasOpsSurface = Boolean(
      inspection?.hasPackageJson
      || files.some((file) => /(^|\/)(dockerfile|docker-compose\.(ya?ml)|makefile|procfile|vercel\.json|netlify\.toml|\.github\/workflows\/.+)$/i.test(String(file || "").trim()))
    );
    const hasWebContentSurface = Boolean(
      hasFrontendSurface
      && (inspection?.hasReadme || markdownFileCount >= 2 || marketingFileCount > 0)
    );
    const hasCreativeSurface = specialty === "creative"
      && Boolean(manuscriptFileCount || creativeNoteCount || markdownFileCount >= 2);
    const hasConcreteImplementationSurface = specialty === "creative"
      ? hasCreativeSurface
      : Boolean(codeFileCount || styleFileCount || markupFileCount || backendFileCount);
    const significantImplementationSurface = specialty === "creative"
      ? manuscriptFileCount + creativeNoteCount >= 2
      : codeFileCount + styleFileCount + markupFileCount + backendFileCount >= 3;
    const hasPlanningEvidence = Boolean((todoState?.unchecked?.length || 0) + (todoState?.checked?.length || 0));
    const hasScopingAnchor = Boolean(
      directiveAuthoritative
      || inspection?.hasReadme
      || inspection?.hasPackageJson
      || hasPlanningEvidence
      || hasCreativeSurface
    );
    const hasCompletionEvidence = Boolean(
      inspection?.hasTests
      || directiveCheckedCount
      || (todoState?.checked?.length || 0)
    );
    let phase = "scoping";
    if (directiveAuthoritative && directiveUncheckedCount > 0) {
      phase = "directive";
    } else if (archiveOnlyInput || (!hasConcreteImplementationSurface && !inspection?.hasReadme && !inspection?.hasPackageJson && !hasCreativeSurface)) {
      phase = "intake";
    } else if (!hasScopingAnchor) {
      phase = "scoping";
    } else if (Boolean(todoState?.exportRequirementsMode)) {
      phase = "finalization";
    } else if (
      hasConcreteImplementationSurface
      && significantImplementationSurface
      && (inspection?.hasTests || hasCompletionEvidence)
    ) {
      phase = "quality";
    } else if (hasConcreteImplementationSurface || hasCreativeSurface || inspection?.hasPackageJson) {
      phase = "implementation";
    } else {
      phase = "scoping";
    }
    let workstream = "general";
    if (specialty === "creative") {
      workstream = "creative";
    } else if (specialty === "retrieval") {
      workstream = "research";
    } else if (hasFrontendSurface && hasBackendSurface) {
      workstream = "full_stack";
    } else if (hasFrontendSurface) {
      workstream = "frontend";
    } else if (hasBackendSurface) {
      workstream = "backend";
    } else if (hasOpsSurface) {
      workstream = "ops";
    } else if (inspection?.hasReadme || markdownFileCount >= 2) {
      workstream = "content";
    }
    const currentPriority = phase === "directive"
      ? "Finish the directive-scoped work before broadening into cleanup or late-pass audits."
      : phase === "intake"
        ? "Establish the real project inputs and a concrete directive before specialist routing widens."
        : phase === "scoping"
          ? "Clarify the next concrete implementation slice and keep the project grounded in current files."
          : phase === "implementation"
            ? "Advance the strongest implementation slice and capture follow-up work as it becomes clear."
            : phase === "quality"
              ? "Run focused validation and hardening passes against work that is already scoped and implemented."
              : "Close export blockers, completion evidence, and finishing-pass issues without reopening project scope.";
    const deferLatePassAudits = getProjectPhaseIndex(phase) < getProjectPhaseIndex("quality");
    const deferredPosture = deferLatePassAudits
      ? "Late-pass audit roles stay deferred until the project reaches a quality/finalization pass unless the directive explicitly calls for them."
      : "Late-pass audit roles can activate when the current objective explicitly warrants them.";
    const signalText = [
      String(project?.name || "").trim(),
      String(project?.path || "").trim(),
      directivePath,
      directiveObjectiveText,
      ...(Array.isArray(directiveState?.uncheckedItems) ? directiveState.uncheckedItems.map((entry) => String(entry?.label || entry?.focus || "").trim()) : []),
      ...(Array.isArray(directiveState?.checkedItems) ? directiveState.checkedItems.map((entry) => String(entry?.label || entry?.focus || "").trim()) : []),
      files.join("\n"),
      directories.join("\n")
    ].join("\n");
    return {
      specialty,
      phase,
      phaseLabel: PROJECT_PHASE_LABELS[phase] || "Scoping",
      phaseIndex: getProjectPhaseIndex(phase),
      workstream,
      workstreamLabel: WORKSTREAM_LABELS[workstream] || "General",
      currentPriority,
      deferLatePassAudits,
      deferredPosture,
      hasFrontendSurface,
      hasBackendSurface,
      hasOpsSurface,
      hasWebContentSurface,
      hasConcreteImplementationSurface,
      hasScopingAnchor,
      hasCompletionEvidence,
      archiveOnlyInput,
      hasTests: Boolean(inspection?.hasTests),
      hasReadme: Boolean(inspection?.hasReadme || readmeFile),
      hasPackageJson: Boolean(inspection?.hasPackageJson || packageFile),
      directiveAuthoritative,
      directivePath,
      directiveObjectiveText,
      directiveUncheckedCount,
      directiveCheckedCount,
      signalText
    };
  }

  function roleHasExplicitSignal(roleName = "", assessment = {}, taskText = "") {
    const patterns = EXPLICIT_ROLE_SIGNAL_PATTERNS[String(roleName || "").trim()];
    if (!Array.isArray(patterns) || !patterns.length) {
      return false;
    }
    const corpus = `${String(assessment?.signalText || "")}\n${String(taskText || "")}`;
    return patterns.some((pattern) => pattern.test(corpus));
  }

  function roleMatchesAssessmentWorkstream(roleName = "", assessment = {}) {
    const normalizedRoleName = String(roleName || "").trim();
    if (!normalizedRoleName) {
      return false;
    }
    switch (String(assessment?.workstream || "").trim()) {
      case "creative":
        return CREATIVE_ROLE_NAMES.has(normalizedRoleName);
      case "frontend":
        return FRONTEND_ROLE_NAMES.has(normalizedRoleName) || CONTENT_ROLE_NAMES.has(normalizedRoleName);
      case "backend":
        return BACKEND_ROLE_NAMES.has(normalizedRoleName);
      case "full_stack":
        return FRONTEND_ROLE_NAMES.has(normalizedRoleName)
          || BACKEND_ROLE_NAMES.has(normalizedRoleName)
          || normalizedRoleName === "Full-Stack Developer";
      case "ops":
        return OPS_ROLE_NAMES.has(normalizedRoleName);
      case "content":
        return CONTENT_ROLE_NAMES.has(normalizedRoleName) || MARKETING_ROLE_NAMES.has(normalizedRoleName);
      case "research":
        return CONTENT_ROLE_NAMES.has(normalizedRoleName)
          || normalizedRoleName === "Business Analyst"
          || normalizedRoleName === "Product Manager"
          || normalizedRoleName === "QA Tester";
      default:
        return false;
    }
  }

  function shouldSeedRoleNow(roleName = "", assessment = {}, taskText = "") {
    const normalizedRoleName = String(roleName || "").trim();
    if (!normalizedRoleName) {
      return false;
    }
    const explicitSignal = roleHasExplicitSignal(normalizedRoleName, assessment, taskText);
    if (String(assessment?.specialty || "").trim() === "creative") {
      return CREATIVE_ROLE_NAMES.has(normalizedRoleName)
        || ["Project Manager", "Content Designer", "Brand Designer", "QA Tester"].includes(normalizedRoleName);
    }
    if (String(assessment?.phase || "").trim() === "directive") {
      return ["Project Manager", "Product Manager", "QA Tester"].includes(normalizedRoleName);
    }
    if (normalizedRoleName === "Project Manager") {
      return true;
    }
    if (["Product Manager", "Business Analyst", "Technical Architect / Solutions Architect", "Support Engineer"].includes(normalizedRoleName)) {
      return isProjectPhaseAtLeast(assessment, "scoping") || explicitSignal;
    }
    if (["Front-End Developer", "Front-End Framework Developer", "UI Designer"].includes(normalizedRoleName)) {
      return ((isProjectPhaseAtLeast(assessment, "implementation") && assessment?.hasFrontendSurface) || explicitSignal);
    }
    if (["Back-End Developer", "Database Engineer"].includes(normalizedRoleName)) {
      return ((isProjectPhaseAtLeast(assessment, "implementation") && assessment?.hasBackendSurface) || explicitSignal);
    }
    if (normalizedRoleName === "Full-Stack Developer") {
      return ((isProjectPhaseAtLeast(assessment, "implementation") && assessment?.hasFrontendSurface && assessment?.hasBackendSurface) || explicitSignal);
    }
    if (["DevOps Engineer", "Cloud Engineer"].includes(normalizedRoleName)) {
      return ((isProjectPhaseAtLeast(assessment, "implementation") && assessment?.hasOpsSurface) || explicitSignal);
    }
    if (["Graphic Designer", "Brand Designer", "Motion Designer", "Content Designer"].includes(normalizedRoleName)) {
      return (isProjectPhaseAtLeast(assessment, "implementation") || explicitSignal);
    }
    if (normalizedRoleName === "QA Tester") {
      return isProjectPhaseAtLeast(assessment, "implementation") || explicitSignal;
    }
    if (normalizedRoleName === "Automation QA Engineer") {
      return ((isProjectPhaseAtLeast(assessment, "implementation") && assessment?.hasConcreteImplementationSurface) || explicitSignal);
    }
    if (normalizedRoleName === "Accessibility Specialist") {
      return ((isProjectPhaseAtLeast(assessment, "quality") && assessment?.hasFrontendSurface) || explicitSignal);
    }
    if (["Security Engineer", "Penetration Tester"].includes(normalizedRoleName)) {
      return ((isProjectPhaseAtLeast(assessment, "quality") && assessment?.hasBackendSurface) || explicitSignal);
    }
    if (["SEO Specialist", "CRO Specialist", "Copywriter", "Content Manager", "Digital Marketer", "Community Manager", "Web Administrator"].includes(normalizedRoleName)) {
      return ((isProjectPhaseAtLeast(assessment, "finalization") && (assessment?.hasWebContentSurface || assessment?.hasFrontendSurface)) || explicitSignal);
    }
    return true;
  }

  function describeDeferredProjectRole(roleName = "", assessment = {}) {
    const normalizedRoleName = String(roleName || "").trim();
    if (!normalizedRoleName || String(assessment?.specialty || "").trim() === "creative") {
      return "";
    }
    if (normalizedRoleName === "Accessibility Specialist" && assessment?.hasFrontendSurface && !isProjectPhaseAtLeast(assessment, "quality")) {
      return "Deferred until a later accessibility pass after scoping and core UI implementation are clearer.";
    }
    if (["QA Tester", "Automation QA Engineer"].includes(normalizedRoleName) && assessment?.hasConcreteImplementationSurface && !isProjectPhaseAtLeast(assessment, "quality")) {
      return "Deferred until there is a stable enough implementation slice to validate instead of only scoping it.";
    }
    if (["Security Engineer", "Penetration Tester"].includes(normalizedRoleName) && assessment?.hasBackendSurface && !isProjectPhaseAtLeast(assessment, "quality")) {
      return "Deferred until a later hardening/security pass after the current implementation direction is clearer.";
    }
    if (["SEO Specialist", "CRO Specialist", "Copywriter", "Content Manager", "Digital Marketer", "Community Manager", "Web Administrator"].includes(normalizedRoleName)
      && (assessment?.hasWebContentSurface || assessment?.hasFrontendSurface)
      && !isProjectPhaseAtLeast(assessment, "finalization")) {
      return "Deferred until launch/finalization work is underway so the project does not drift into premature marketing or polishing passes.";
    }
    return "";
  }

  function scoreProjectRoleForActivation(roleName = "", assessment = {}, { taskCount = 0, firstTask = "" } = {}) {
    const normalizedRoleName = String(roleName || "").trim();
    if (!normalizedRoleName) {
      return 0;
    }
    const explicitSignal = roleHasExplicitSignal(normalizedRoleName, assessment, firstTask);
    let score = 10 + Math.min(3, Number(taskCount || 0)) * 8;
    if (String(assessment?.specialty || "").trim() === "creative") {
      if (normalizedRoleName === "Project Manager") score += 120;
      if (normalizedRoleName === "Content Designer") score += 80;
      if (normalizedRoleName === "Brand Designer") score += 75;
      if (normalizedRoleName === "QA Tester") score += 70;
      if (CREATIVE_PRIMARY_ROLE_NAMES.has(normalizedRoleName)) score += 160;
      if (roleMatchesAssessmentWorkstream(normalizedRoleName, assessment)) score += 30;
      return score + (explicitSignal ? 20 : 0);
    }
    if (String(assessment?.phase || "").trim() === "directive") {
      if (normalizedRoleName === "Project Manager") return score + 220;
      if (normalizedRoleName === "Product Manager") return score + 160;
      if (normalizedRoleName === "QA Tester") return score + 120;
      return score;
    }
    if (normalizedRoleName === "Project Manager") score += 110;
    if (normalizedRoleName === "Product Manager") score += 70;
    if (normalizedRoleName === "Technical Architect / Solutions Architect") score += 45;
    if (normalizedRoleName === "Business Analyst") score += 35;
    if (SCOPING_ROLE_NAMES.has(normalizedRoleName) && String(assessment?.phase || "").trim() === "scoping") score += 140;
    if (IMPLEMENTATION_ROLE_NAMES.has(normalizedRoleName) && String(assessment?.phase || "").trim() === "implementation") score += 145;
    if (QUALITY_ROLE_NAMES.has(normalizedRoleName) && String(assessment?.phase || "").trim() === "quality") score += 160;
    if (FINALIZATION_ROLE_NAMES.has(normalizedRoleName) && String(assessment?.phase || "").trim() === "finalization") score += 150;
    if (String(assessment?.phase || "").trim() === "intake") {
      if (normalizedRoleName === "Project Manager") score += 120;
      if (normalizedRoleName === "Product Manager") score += 70;
      if (normalizedRoleName === "Support Engineer") score += 55;
      if (normalizedRoleName === "DevOps Engineer" && assessment?.archiveOnlyInput) score += 110;
    }
    if (normalizedRoleName === "Automation QA Engineer" && !assessment?.hasTests) score += 25;
    if (normalizedRoleName === "Accessibility Specialist" && assessment?.hasFrontendSurface) score += 30;
    if (["Security Engineer", "Penetration Tester"].includes(normalizedRoleName) && assessment?.hasBackendSurface) score += 25;
    if (roleMatchesAssessmentWorkstream(normalizedRoleName, assessment)) score += 35;
    if (explicitSignal) score += 30;
    return score;
  }

  function getProjectActiveRoleLimit(assessment = {}) {
    if (String(assessment?.specialty || "").trim() === "creative") {
      return 5;
    }
    switch (String(assessment?.phase || "").trim()) {
      case "directive":
        return 3;
      case "intake":
        return 2;
      case "quality":
      case "finalization":
        return 4;
      default:
        return 3;
    }
  }

  function buildInactiveRoleSectionLines(roleName = "", tasks = [], assessment = {}) {
    if (Array.isArray(tasks) && tasks.length) {
      const prefix = isProjectPhaseAtLeast(assessment, "quality")
        ? "Suggested follow-up"
        : "Suggested later";
      return tasks.map((task) => `- ${prefix}: ${task}`);
    }
    return [describeDeferredProjectRole(roleName, assessment) || "No confirmed role-specific task yet from the current project scan."];
  }

  function findProjectDirectiveFile(inspection = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const directiveFile = files.find((file) => /(^|\/)directive\.md$/i.test(String(file || "").trim()));
    return String(directiveFile || "").trim();
  }

  function isDirectiveVariantFile(file = "") {
    const normalized = String(file || "").trim();
    if (!normalized) {
      return false;
    }
    const basename = path.posix.basename(normalized).toLowerCase();
    if (basename === "directive.md") {
      return false;
    }
    return basename.replace(/[^a-z0-9]/g, "") === "directivemd";
  }

  function findProjectDirectiveVariantFile(inspection = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const variantFile = files.find((file) => isDirectiveVariantFile(file));
    return String(variantFile || "").trim();
  }

  function normalizeDirectiveTaskLabel(text = "") {
    return compactTaskText(
      String(text || "")
        .replace(/\s+/g, " ")
        .replace(/[.;:,!?]+$/g, "")
        .trim(),
      180
    );
  }

  function isPlaceholderTaskLabel(text = "") {
    const normalized = String(text || "").trim().toLowerCase();
    return normalized === "none"
      || normalized === "n/a"
      || normalized === "na"
      || normalized === "no active tasks"
      || normalized === "no pending tasks"
      || normalized === "no completed tasks";
  }

  function repairFlattenedSingleLineTodoContent(text = "") {
    if (text.includes("\n") || text.trim().length < 80) {
      return text;
    }
    // Worker wrote the whole file as one line — reconstruct line structure from
    // inline markdown markers (e.g. "## Heading" mid-line, "**Label:**" bold sections,
    // ". - next bullet" sentence-then-bullet runs).
    const expanded = text
      // Bold section labels like **Completed Actions:** → proper headings
      .replace(/\*\*([A-Z][^*]{2,}:)\*\*/g, (_, label) => `\n## ${label.replace(/:$/, "")}`)
      // Inline ## headings not at the start of the line
      .replace(/([^\n])\s+(#{1,3} +[A-Z])/g, "$1\n$2")
      // Bullets that directly follow a sentence ending (". - item")
      .replace(/([.!?]) {1,3}- +/g, "$1\n- ");
    if (expanded.split(/\n/).length > text.split(/\n/).length) {
      return expanded;
    }
    return text;
  }

  function repairPlainBulletTodoContent(content = "") {
    const text = repairFlattenedSingleLineTodoContent(String(content || ""));
    if (!text.trim()) {
      return text;
    }
    const classifyTodoSectionState = (heading = "") => {
      const normalizedHeading = String(heading || "").trim().toLowerCase();
      if (!normalizedHeading) {
        return "";
      }
      if (/\b(completed|done|finished|checked|closed|resolved)\b/.test(normalizedHeading)) {
        return "checked";
      }
      if (
        /\b(active tasks?|current priorit(?:y|ies)|follow(?:-| )?up tasks?|follow(?:-| )?ups?|next steps?|pending|todo|open|remaining|backlog|action items?)\b/.test(normalizedHeading)
      ) {
        return "unchecked";
      }
      return "";
    };
    let currentSection = "";
    let changed = false;
    const repairedLines = text.split(/\r?\n/).map((line) => {
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      if (heading) {
        currentSection = classifyTodoSectionState(heading[1]);
        return line;
      }
      if (/^(?:\s*[-*]\s+)?\[[ xX]\]\s+.+$/.test(line)) {
        return line;
      }
      const bullet = line.match(/^(\s*)(?:[-*]|\d+[.)])\s+(?!\[)(.+?)\s*$/);
      if (!bullet) return line;
      const label = String(bullet[2] || "").trim();
      if (!label || !currentSection) return line;
      changed = true;
      if (currentSection === "checked") return `${bullet[1]}- [x] ${label}`;
      if (currentSection === "unchecked") return `${bullet[1]}- [ ] ${label}`;
      return line;
    });
    return changed ? repairedLines.join("\n") : text;
  }

  function extractCheckboxItems(content = "", { checked = false } = {}) {
    const normalizeTodoLabel = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
    const pattern = checked
      ? /^(?:[-*]\s+)?\[[xX]\]\s+(.+)$/gim
      : /^(?:[-*]\s+)?\[(?![xX\]])[^\]]*\]\s+(.+)$/gim;
    return [...String(content || "").matchAll(pattern)]
      .map((match) => normalizeTodoLabel(match[1]))
      .filter((entry) => entry && !isPlaceholderTaskLabel(entry));
  }

  function extractLegacyTodoItems(content = "", { checked = false } = {}) {
    const items = [];
    const seen = new Set();
    const desiredState = checked ? "checked" : "unchecked";
    const classifyTodoSectionState = (heading = "") => {
      const normalizedHeading = String(heading || "").trim().toLowerCase();
      if (!normalizedHeading) {
        return "";
      }
      if (/\b(completed|done|finished|checked|closed|resolved)\b/.test(normalizedHeading)) {
        return "checked";
      }
      if (
        /\b(active tasks?|current priorit(?:y|ies)|follow(?:-| )?up tasks?|follow(?:-| )?ups?|next steps?|pending|todo|open|remaining|backlog|action items?)\b/.test(normalizedHeading)
      ) {
        return "unchecked";
      }
      return "";
    };
    let currentSection = "";
    for (const rawLine of String(content || "").split(/\r?\n/)) {
      const line = String(rawLine || "");
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      if (heading) {
        currentSection = classifyTodoSectionState(heading[1]);
        continue;
      }
      if (currentSection !== desiredState) {
        continue;
      }
      if (/^(?:\s*[-*]\s+)?\[[ xX]\]\s+.+$/.test(line)) {
        continue;
      }
      const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/);
      if (!bullet) {
        continue;
      }
      const label = String(bullet[1] || "").replace(/\s+/g, " ").trim();
      if (!label || isPlaceholderTaskLabel(label) || seen.has(label)) {
        continue;
      }
      seen.add(label);
      items.push(label);
    }
    return items;
  }

  function maybeDecodeEscapedNewlineContent(content = "") {
    const raw = String(content || "");
    if (!raw) {
      return raw;
    }
    if (raw.includes("\n")) {
      return raw;
    }
    if (!/\\n/.test(raw)) {
      return raw;
    }
    const decoded = raw
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
    const rawLineCount = raw.split(/\r?\n/).length;
    const decodedLineCount = decoded.split(/\r?\n/).length;
    if (decodedLineCount <= rawLineCount) {
      return raw;
    }
    return decoded;
  }

  function parseProjectTodoState(content = "") {
    const originalContent = String(content || "");
    const decodedContent = maybeDecodeEscapedNewlineContent(originalContent);
    const normalizedContent = repairPlainBulletTodoContent(decodedContent);
    const checked = extractCheckboxItems(normalizedContent, { checked: true });
    const unchecked = extractCheckboxItems(normalizedContent, { checked: false });
    if (checked.length || unchecked.length || normalizedContent !== originalContent) {
      return {
        checked,
        unchecked,
        normalizedContent,
        normalized: normalizedContent !== originalContent
      };
    }
    return {
      checked: extractLegacyTodoItems(decodedContent, { checked: true }),
      unchecked: extractLegacyTodoItems(decodedContent, { checked: false }),
      normalizedContent: originalContent,
      normalized: false
    };
  }

  function inspectTodoDerailmentSignals(content = "", parsedTodoState = null) {
    const raw = String(content || "");
    const parsed = parsedTodoState && typeof parsedTodoState === "object"
      ? parsedTodoState
      : parseProjectTodoState(raw);
    const checked = Array.isArray(parsed?.checked) ? parsed.checked : [];
    const unchecked = Array.isArray(parsed?.unchecked) ? parsed.unchecked : [];
    const allItems = [...checked, ...unchecked];
    const hasLiteralEscapedNewlinesOnly = /\\n/.test(raw) && !/\r?\n/.test(raw);
    const hasStructuredTodoMarkers = /(^|\n)\s*##\s*(Current Priority|Follow-up Tasks|Active Tasks|Completed Tasks)\b/im.test(raw);
    const hasLegacyBullets = /(^|\n)\s*(?:[-*]|\d+[.)])\s+\S/m.test(raw);
    const hasCheckboxBullets = /(^|\n)\s*(?:[-*]\s+)?\[[ xX]\]\s+\S/m.test(raw);
    const hasTruncatedItems = allItems.some((entry) => /\.\.\.$|…$/.test(String(entry || "").trim()));
    const signals = [];
    if (hasLiteralEscapedNewlinesOnly) {
      signals.push("literal_escaped_newlines");
    }
    if (!allItems.length && (hasStructuredTodoMarkers || hasLegacyBullets || hasCheckboxBullets)) {
      signals.push("empty_parse_with_structured_content");
    }
    if (hasTruncatedItems) {
      signals.push("truncated_items");
    }
    return signals;
  }

  function buildDirectiveTaskFocus(taskLabel = "", directivePath = "") {
    const normalizedLabel = normalizeDirectiveTaskLabel(taskLabel);
    if (!normalizedLabel) {
      return "";
    }
    const directiveFileName = path.posix.basename(String(directivePath || "").trim() || "directive.md");
    const normalizedLower = normalizedLabel.toLowerCase();
    if (
      normalizedLower.startsWith("complete the unchecked directive item in ")
      || normalizedLower.startsWith("complete the directive objective in ")
    ) {
      return normalizedLabel;
    }
    return compactTaskText(`Complete the unchecked directive item in ${directiveFileName}: ${normalizedLabel}.`, 220);
  }

  function extractDirectiveObjectiveText(content = "") {
    const lines = String(content || "").split(/\r?\n/);
    let insideObjectiveSection = false;
    const collected = [];
    for (const rawLine of lines) {
      const line = String(rawLine || "");
      if (/^\s*##\s+objective\s*$/i.test(line)) {
        insideObjectiveSection = true;
        continue;
      }
      if (insideObjectiveSection && /^\s*##\s+/.test(line)) {
        break;
      }
      if (!insideObjectiveSection) {
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed || /^[-*]\s+/.test(trimmed)) {
        continue;
      }
      collected.push(trimmed);
    }
    if (collected.length) {
      return compactTaskText(collected.join(" "), 220);
    }
    const inlineMatch = String(content || "").match(/^\s*objective\s*:\s*(.+)$/im);
    return compactTaskText(String(inlineMatch?.[1] || "").trim(), 220);
  }

  function parseProjectDirectiveState(inspection = {}, directiveContent = "") {
    const normalizedDirectiveContent = maybeDecodeEscapedNewlineContent(directiveContent);
    const directivePath = findProjectDirectiveFile(inspection);
    const directiveFileName = path.posix.basename(directivePath || "directive.md");
    const uncheckedItems = [];
    const checkedItems = [];
    const seenUnchecked = new Set();
    const seenChecked = new Set();
    const pushItem = (collection, seen, label) => {
      const normalizedLabel = normalizeDirectiveTaskLabel(label);
      if (!normalizedLabel) {
        return;
      }
      const dedupeKey = normalizeSummaryComparisonText(normalizedLabel);
      if (!dedupeKey || seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      collection.push({
        label: normalizedLabel,
        focus: buildDirectiveTaskFocus(normalizedLabel, directivePath),
        preferredTarget: directivePath
      });
    };
    for (const rawLine of String(normalizedDirectiveContent || "").split(/\r?\n/)) {
      const line = String(rawLine || "");
      const markdownCheckboxMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
      if (markdownCheckboxMatch) {
        const isChecked = /x/i.test(String(markdownCheckboxMatch[1] || "").trim());
        pushItem(isChecked ? checkedItems : uncheckedItems, isChecked ? seenChecked : seenUnchecked, markdownCheckboxMatch[2]);
        continue;
      }
      const inlineCheckboxMatch = line.match(/^\s*(.+?)\s+\[([ xX])\]\s*$/);
      if (inlineCheckboxMatch) {
        const isChecked = /x/i.test(String(inlineCheckboxMatch[2] || "").trim());
        pushItem(isChecked ? checkedItems : uncheckedItems, isChecked ? seenChecked : seenUnchecked, inlineCheckboxMatch[1]);
      }
    }
    const objectiveText = extractDirectiveObjectiveText(normalizedDirectiveContent);
    return {
      path: directivePath,
      fileName: directiveFileName,
      objectiveText,
      uncheckedItems,
      checkedItems,
      authoritative: Boolean(directivePath && (uncheckedItems.length || checkedItems.length || objectiveText))
    };
  }

  function buildProjectDirectiveContent(project, inspection = {}) {
    const projectName = String(project?.name || "Project").trim() || "Project";
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const readmeFile = pickInspectionFile(inspection, [/readme\.md$/i]);
    const packageFile = pickInspectionFile(inspection, [/package\.json$/i]);
    const manuscriptFile = pickInspectionFile(inspection, [/(chapter|scene|novella|manuscript).*\.md$/i, /\.md$/i]);
    const outlineFile = pickInspectionFile(inspection, [/(outline|beat|story-outline).*\.md$/i]);
    const notesFile = pickInspectionFile(inspection, [/(notes|story-bible|brief|characters?|world|lore).*\.md$/i]);
    if (projectSpecialty === "creative") {
      const primaryDraftTarget = manuscriptFile || outlineFile || notesFile || "the strongest current story file";
      const supportTarget = outlineFile || notesFile || manuscriptFile || "the supporting story notes";
      return [
        `# Directive: ${projectName}`,
        "",
        "## Objective",
        "Advance the strongest manuscript, outline, or story-supporting file with one concrete writing improvement.",
        "",
        "## Current Focus",
        `- [ ] Inspect ${primaryDraftTarget} and improve it directly with one meaningful writing pass.`,
        `- [ ] Preserve continuity, voice, tense, and named details against ${supportTarget}.`,
        "- [ ] Record the completed writing pass and the next follow-up in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.",
        ""
      ].join("\n");
    }
    const primaryTarget = readmeFile || packageFile || pickInspectionFile(inspection, [/\.(js|jsx|ts|tsx|py|php|java|go|rs|md)$/i]) || "the most relevant concrete project file or directory";
    return [
      `# Directive: ${projectName}`,
      "",
      "## Objective",
      "Review the project structure and identify the best runnable or shippable next step.",
      "",
      "## Current Focus",
      `- [ ] Inspect ${primaryTarget} before deciding on the next concrete pass.`,
      "- [ ] Make one concrete improvement, or record the exact blocker, in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.",
      "- [ ] Keep this directive aligned with the current objective when the project direction becomes clearer.",
      ""
    ].join("\n");
  }

  async function readProjectDirectiveState(project, inspection = {}) {
    const directivePath = findProjectDirectiveFile(inspection);
    const directiveVariantPath = findProjectDirectiveVariantFile(inspection);
    if (!directivePath && !directiveVariantPath) {
      return parseProjectDirectiveState(inspection, "");
    }
    let directiveContent = "";
    let variantContent = "";
    try {
      if (directivePath) {
        directiveContent = await readContainerFile(`${project.path}/${directivePath}`);
      }
    } catch {
      directiveContent = "";
    }
    try {
      if (directiveVariantPath) {
        variantContent = await readContainerFile(`${project.path}/${directiveVariantPath}`);
      }
    } catch {
      variantContent = "";
    }
    const canonicalState = parseProjectDirectiveState(inspection, directiveContent);
    const variantState = directiveVariantPath
      ? parseProjectDirectiveState(
        {
          ...inspection,
          files: [directivePath || "directive.md"]
        },
        variantContent
      )
      : null;
    if (
      variantState?.authoritative
      && (!canonicalState.authoritative || !String(directiveContent || "").trim())
    ) {
      return {
        ...variantState,
        path: directivePath || "directive.md",
        fileName: "directive.md"
      };
    }
    return canonicalState;
  }

  async function ensureProjectDirectiveForWorkspaceProject(project, inspection = null) {
    let resolvedInspection = inspection || await inspectWorkspaceProject(project);
    const existingDirectivePath = findProjectDirectiveFile(resolvedInspection);
    const directiveVariantPath = findProjectDirectiveVariantFile(resolvedInspection);
    if (existingDirectivePath && directiveVariantPath && typeof moveContainerPath === "function") {
      let canonicalContent = "";
      let variantContent = "";
      try {
        canonicalContent = await readContainerFile(`${project.path}/${existingDirectivePath}`);
      } catch {
        canonicalContent = "";
      }
      try {
        variantContent = await readContainerFile(`${project.path}/${directiveVariantPath}`);
      } catch {
        variantContent = "";
      }
      const canonicalState = parseProjectDirectiveState(resolvedInspection, canonicalContent);
      const variantState = parseProjectDirectiveState(
        {
          ...resolvedInspection,
          files: [existingDirectivePath || "directive.md"]
        },
        variantContent
      );
      if (
        variantState.authoritative
        && (!canonicalState.authoritative || !String(canonicalContent || "").trim())
      ) {
        await moveContainerPath(
          `${project.path}/${directiveVariantPath}`,
          `${project.path}/${existingDirectivePath}`,
          { overwrite: true, timeoutMs: 30000 }
        );
        resolvedInspection = await inspectWorkspaceProject(project);
      }
    }
    const repairedDirectivePath = findProjectDirectiveFile(resolvedInspection);
    if (repairedDirectivePath || getProjectConfig().autoCreateProjectDirective === false) {
      return {
        inspection: resolvedInspection,
        directivePath: repairedDirectivePath,
        created: false
      };
    }
    const directivePath = `${project.path}/directive.md`;
    const content = buildProjectDirectiveContent(project, resolvedInspection);
    await writeContainerTextFile(directivePath, content, { timeoutMs: 30000 });
    const refreshedInspection = await inspectWorkspaceProject(project);
    return {
      inspection: refreshedInspection,
      directivePath: findProjectDirectiveFile(refreshedInspection) || "directive.md",
      created: true
    };
  }

  function shouldRefreshLegacyPlanningContent(project, inspection = {}, content = "") {
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    if (projectSpecialty !== "creative") {
      return false;
    }
    const text = String(content || "");
    if (!text.trim()) {
      return false;
    }
    if (/^- \[[xX]\] .+$/m.test(text)) {
      return false;
    }
    return /\bbest runnable or shippable next step\b/i.test(text)
      || /\bpurpose, setup, and current status\b/i.test(text)
      || /\bblock another developer from running\b/i.test(text);
  }

  function isTemplateReadmeCreationTask(label = "") {
    const text = String(label || "").trim().toLowerCase().replace(/[`"]/g, "");
    return /^create or improve a readme\b/.test(text)
      || /^create a concise readme\.md\b/.test(text)
      || /^create concise readme\.md\b/.test(text);
  }

  function isTemplateDirectiveCreationTask(label = "") {
    const text = String(label || "").trim().toLowerCase().replace(/[`"]/g, "");
    return /^create a directive\.md\b/.test(text)
      || /^create directive\.md\b/.test(text);
  }

  function repairSatisfiedTemplateSetupTasks(content = "", inspection = {}) {
    const text = String(content || "");
    if (!text.trim()) {
      return text;
    }
    const hasReadme = Boolean(inspection?.hasReadme || pickInspectionFile(inspection, [/readme\.md$/i]));
    const hasDirective = Boolean(findProjectDirectiveFile(inspection));
    if (!hasReadme && !hasDirective) {
      return text;
    }
    const lines = text.split(/\r?\n/);
    let changed = false;
    const nextLines = lines.map((line) => {
      const uncheckedMatch = String(line || "").match(/^(\s*-\s+\[)\s(\]\s+)(.+?)\s*$/);
      if (!uncheckedMatch) {
        return line;
      }
      const label = compactTaskText(String(uncheckedMatch[3] || "").trim(), 220);
      const satisfied = (hasReadme && isTemplateReadmeCreationTask(label))
        || (hasDirective && isTemplateDirectiveCreationTask(label));
      if (!satisfied) {
        return line;
      }
      changed = true;
      return `${uncheckedMatch[1]}x${uncheckedMatch[2]}${uncheckedMatch[3]}`;
    });
    return changed ? nextLines.join("\n") : text;
  }

  function pickInspectionFile(inspection, patterns = []) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    for (const pattern of patterns) {
      const match = files.find((file) => pattern.test(String(file || "").toLowerCase()));
      if (match) {
        return match;
      }
    }
    return files[0] || "";
  }

  function pickDirectiveObjectiveTarget(objectiveText = "", inspection = {}, projectSpecialty = "") {
    const normalizedObjective = String(objectiveText || "").trim().toLowerCase();
    if (!normalizedObjective) {
      return "";
    }
    if (projectSpecialty === "creative") {
      if (/\b(setting|world|worldbuild|world-building|worldbuilding|lore|myth|kingdom|culture|magic system)\b/.test(normalizedObjective)) {
        return pickInspectionFile(inspection, [/(world|lore|brief|notes|foundation|magic).*\.md$/i, /\.md$/i]);
      }
      if (/\b(character|motivation|interiority|arc|dialogue|voice)\b/.test(normalizedObjective)) {
        return pickInspectionFile(inspection, [/(character|scene|manuscript|draft).*\.md$/i, /\.md$/i]);
      }
      if (/\b(chapter|scene|beat|pacing|stakes|manuscript|draft|rewrite|revise|revision|prose)\b/.test(normalizedObjective)) {
        return pickInspectionFile(inspection, [/(chapter|scene|manuscript|draft).*\.md$/i, /\.md$/i]);
      }
      return pickInspectionFile(inspection, [/(chapter|scene|manuscript|outline|notes|world|lore).*\.md$/i, /\.md$/i]);
    }
    return pickInspectionFile(inspection, [/\.(js|jsx|ts|tsx|py|php|java|go|rs|md)$/i]);
  }

  function buildDirectiveObjectiveTask(project, inspection = {}, directiveState = {}) {
    const objectiveText = compactTaskText(String(directiveState?.objectiveText || "").trim(), 220);
    const objectiveClause = String(objectiveText || "").replace(/[.]+$/g, "").trim();
    if (!objectiveText) {
      return "";
    }
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const targetFile = pickDirectiveObjectiveTarget(objectiveText, inspection, projectSpecialty);
    if (targetFile) {
      if (projectSpecialty === "creative") {
        return compactTaskText(
          `Inspect ${targetFile} and complete the directive objective with one concrete writing pass: ${objectiveClause}.`,
          220
        );
      }
      return compactTaskText(
        `Inspect ${targetFile} and complete the directive objective with one concrete improvement: ${objectiveClause}.`,
        220
      );
    }
    if (projectSpecialty === "creative") {
      return compactTaskText(
        `Complete the directive objective by improving the strongest current story file directly: ${objectiveClause}.`,
        220
      );
    }
    return compactTaskText(
      `Complete the directive objective with one concrete improvement in the most relevant project file: ${objectiveClause}.`,
      220
    );
  }

  function buildProjectTodoContent(project, inspection, directiveState = {}) {
    const implementationRoot = getProjectImplementationRoot(project, inspection);
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const assessment = buildProjectAssessment(project, inspection, directiveState);
    const hasDirective = Boolean(findProjectDirectiveFile(inspection));
    const directiveDriven = Boolean(directiveState?.authoritative);
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const archiveFile = pickInspectionFile(inspection, [/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i]);
    const hasConcreteNonArchiveFiles = files.some((file) => {
      const normalized = String(file || "").trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      if (["project-todo.md", "project-role-tasks.md", "readme.md"].includes(normalized)) {
        return false;
      }
      return !/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i.test(normalized);
    });
    const archiveOnlyInput = Boolean(archiveFile && !hasConcreteNonArchiveFiles);
    const tasks = [];
    const completedTasks = [];
    if (directiveDriven) {
      tasks.push(
        ...(Array.isArray(directiveState?.uncheckedItems)
          ? directiveState.uncheckedItems.map((entry) => String(entry?.focus || "").trim()).filter(Boolean)
          : [])
      );
      completedTasks.push(
        ...(Array.isArray(directiveState?.checkedItems)
          ? directiveState.checkedItems.map((entry) => String(entry?.focus || "").trim()).filter(Boolean)
          : [])
      );
      if (!tasks.length && directiveState?.objectiveText) {
        tasks.push(buildDirectiveObjectiveTask(project, inspection, directiveState));
      }
    } else if (archiveOnlyInput) {
      tasks.push(`Inspect ${archiveFile} and unzip it into the workspace so the real project files are available for concrete work.`);
      tasks.push("After extraction, identify the best runnable or shippable next step from the unpacked project files.");
      tasks.push("Update this todo file after extraction and after each concrete work pass by checking off completed items and adding any newly discovered follow-up tasks.");
    } else {
      tasks.push(projectSpecialty === "creative"
        ? "Review the project structure and identify the best shippable story or content next step."
        : "Review the project structure and identify the best runnable or shippable next step.");
      if (!hasDirective) {
        tasks.push(projectSpecialty === "creative"
          ? "Create a directive.md that names the current story objective, primary writing target, and continuity guardrails."
          : "Create a directive.md that states the current objective, primary target, and definition of done.");
      }
      if (implementationRoot && implementationRoot !== project.path) {
        tasks.push(`Treat ${implementationRoot} as the primary implementation folder for code and product files.`);
      }
      if (!inspection?.hasReadme) {
        tasks.push(projectSpecialty === "creative"
          ? "Create or improve a README that explains the project purpose, structure, active draft files, and current status."
          : "Create or improve a README that explains the project purpose, setup, and current status.");
      }
      if (inspection?.hasPackageJson) {
        tasks.push("Inspect the package scripts and verify the most useful build, run, or test workflow.");
      }
      if (inspection?.hasSource && !inspection?.hasTests) {
        tasks.push("Add or improve lightweight test coverage for the most important behavior you can verify safely.");
      }
      if (inspection?.hasTodoMarkers) {
        tasks.push("Work through the most important existing TODO or FIXME markers in the source.");
      }
      if (projectSpecialty === "creative") {
        tasks.push("Strengthen the manuscript, outline, or current scene work with one concrete writing improvement.");
        tasks.push("Preserve continuity, voice, tense, and named details while revising prose.");
      }
      tasks.push("Make one concrete improvement that advances the project meaningfully.");
      tasks.push("Update this todo file after each work pass by checking off completed items and adding any newly discovered follow-up tasks.");
    }
    const uniqueTasks = [...new Set(tasks.map((entry) => compactTaskText(entry, 220)).filter(Boolean))];
    const uniqueCompletedTasks = [...new Set(completedTasks.map((entry) => compactTaskText(entry, 220)).filter(Boolean))];
    return [
      `# Project Todo: ${project.name}`,
      "",
      "Use this file to track the current project advancement cycle.",
      "",
      "## Active Tasks",
      ...uniqueTasks.map((entry) => `- [ ] ${entry}`),
      ...uniqueCompletedTasks.map((entry) => `- [x] ${entry}`),
      "",
      "## Notes",
      `- Generated by Nova from native project inspection on ${new Date().toLocaleString("en-AU")}.`,
      inspection?.files?.length ? `- Files sampled: ${inspection.files.slice(0, 12).join(", ")}` : "- Files sampled: none.",
      `- Assessment: ${assessment.phaseLabel} phase on a ${assessment.workstreamLabel} track.`,
      `- Current priority: ${assessment.currentPriority}`,
      assessment.deferLatePassAudits ? "- Late-pass review work is deferred until the project reaches a quality/finalization pass or the directive explicitly calls for it." : "",
      directiveDriven ? `- Directive source: ${directiveState.path}.` : "",
      directiveDriven && directiveState?.objectiveText ? `- Directive objective: ${directiveState.objectiveText}` : "",
      ""
    ].join("\n");
  }

  function buildSeededRoleTaskMap(project, inspection, directiveState = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const directories = Array.isArray(inspection?.directories) ? inspection.directories : [];
    const implementationRoot = getProjectImplementationRoot(project, inspection);
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const assessment = buildProjectAssessment(project, inspection, directiveState);
    const implementationRelRoot = implementationRoot && implementationRoot !== project.path
      ? String(implementationRoot).replace(`${project.path}/`, "")
      : "";
    const packageFile = pickInspectionFile(inspection, [/package\.json$/i]);
    const readmeFile = pickInspectionFile(inspection, [/readme\.md$/i]);
    const jsFile = pickInspectionFile(inspection, [/\.tsx?$/i, /\.jsx?$/i]);
    const cssFile = pickInspectionFile(inspection, [/\.css$/i, /\.scss$/i, /\.sass$/i]);
    const phpFile = pickInspectionFile(inspection, [/\.php$/i]);
    const archiveFile = pickInspectionFile(inspection, [/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i]);
    const manuscriptFile = pickInspectionFile(inspection, [/(chapter|scene|novella|manuscript).*\.md$/i, /\.md$/i]);
    const outlineFile = pickInspectionFile(inspection, [/(outline|beat|story-outline).*\.md$/i]);
    const notesFile = pickInspectionFile(inspection, [/(notes|story-bible|brief).*\.md$/i]);
    const characterFile = pickInspectionFile(inspection, [/(cast|character|characters).*\.md$/i]);
    const worldFile = pickInspectionFile(inspection, [/(world|lore|factions|locations).*\.md$/i]);
    const sourceDir = directories.find((entry) => /^(src|app|lib)(\/|$)/i.test(String(entry || ""))) || directories[0] || "";
    const hasConcreteNonArchiveFiles = files.some((file) => {
      const normalized = String(file || "").trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      if (["project-todo.md", "project-role-tasks.md", "readme.md"].includes(normalized)) {
        return false;
      }
      return !/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i.test(normalized);
    });
    const archiveOnlyInput = Boolean(archiveFile && !hasConcreteNonArchiveFiles);
    const roleTasks = new Map();
    const add = (roleName, task) => {
      const normalized = compactTaskText(String(task || "").trim(), 180);
      if (!normalized) {
        return;
      }
      if (!shouldSeedRoleNow(roleName, assessment, normalized)) {
        return;
      }
      if (!roleTasks.has(roleName)) {
        roleTasks.set(roleName, []);
      }
      const existing = roleTasks.get(roleName);
      if (!existing.includes(normalized)) {
        existing.push(normalized);
      }
    };

    if (implementationRelRoot) {
      add("Project Manager", `Keep concrete implementation work inside ${implementationRelRoot} unless a root-level planning file clearly needs an update.`);
    }
    add("Project Manager", `Keep PROJECT-TODO.md and PROJECT-ROLE-TASKS.md aligned for ${project.name} after each concrete work pass.`);
    if (directiveState?.authoritative) {
      const directivePath = String(directiveState.path || "directive.md").trim();
      if (!(Array.isArray(directiveState.uncheckedItems) && directiveState.uncheckedItems.length)) {
        return roleTasks;
      }
      add("Project Manager", `Finish the current directive in ${directivePath} before broadening the pass to other project cleanup.`);
      for (const item of (Array.isArray(directiveState.uncheckedItems) ? directiveState.uncheckedItems : []).slice(0, 3)) {
        add("Project Manager", `Drive this directive item to completion and mirror it in PROJECT-TODO.md: ${item.label}.`);
      }
      if (directiveState?.objectiveText) {
        add("Product Manager", `Keep the next concrete pass anchored to the directive objective in ${directivePath}: ${directiveState.objectiveText}.`);
      }
      add("QA Tester", `Verify ${directivePath} reflects the completed directive state after each concrete pass.`);
      return roleTasks;
    }
    if (projectSpecialty === "creative") {
      add("Story Architect", `Strengthen the story shape in ${outlineFile || manuscriptFile || "the current draft"} so the next beat, escalation, and reveal timing are clearer.`);
      add("Developmental Editor", `Strengthen chapter-level pacing, stakes, and scene purpose in ${manuscriptFile || outlineFile || "the current manuscript"}.`);
      add("Line Editor", `Tighten prose, rhythm, and sentence clarity in ${manuscriptFile || "the strongest draft file"} while preserving voice.`);
      add("Continuity Editor", `Cross-check ${manuscriptFile || "the manuscript"}, ${outlineFile || "the outline"}, and ${notesFile || characterFile || worldFile || "the supporting notes"} for continuity drift before the next pass closes.`);
      add("Character Writer", `Sharpen motivation, interiority, and voice in ${characterFile || manuscriptFile || "the current character-facing scene"}.`);
      if (worldFile) {
        add("Worldbuilding Designer", `Use ${worldFile} to keep faction, location, and setting details legible and consistent with the active manuscript pass.`);
      }
      add("Content Designer", `Revise the strongest manuscript or outline file in ${project.name} with one concrete prose improvement that preserves continuity.`);
      add("Brand Designer", `Keep tone and voice consistent across the manuscript, outline, and supporting notes for ${project.name}.`);
      add("QA Tester", `Perform a fast continuity spot-check across ${manuscriptFile || "the manuscript"} and ${outlineFile || "the outline"} after each writing pass.`);
      add("Project Manager", `Turn the next manuscript or chapter improvement into a single focused work package instead of a broad writing sweep.`);
    }
    if (archiveOnlyInput) {
      add("Project Manager", `Use ${archiveFile} as the immediate intake target and unpack it before broader repo cleanup.`);
      add("DevOps Engineer", `Unzip ${archiveFile} into the workspace so the real project tree is available for inspection and edits.`);
      add("QA Tester", `Verify the extracted project files from ${archiveFile} are present and inspectable before calling the intake complete.`);
      return roleTasks;
    }
    add("Product Manager", inspection?.hasReadme
      ? (projectSpecialty === "creative"
        ? `Clarify the most shippable story or content next step for ${project.name} in PROJECT-TODO.md using evidence from ${readmeFile || "the current docs"}.`
        : `Clarify the most shippable next step for ${project.name} in PROJECT-TODO.md using evidence from ${readmeFile || "the current docs"}.`)
      : (projectSpecialty === "creative"
        ? `Create a concise README.md for ${project.name} covering purpose, structure, active draft files, and current status.`
        : `Create a concise README.md for ${project.name} covering purpose, setup, and current status.`));
    add("Project Manager", files.length
      ? `Turn the current project scan into one concrete next action tied to ${files[0]}.`
      : `Turn the current project scan into one concrete next action for ${project.name}.`);

    if (packageFile) {
      add("DevOps Engineer", `Verify the most useful run/build/test script in ${packageFile} and record the safe workflow in PROJECT-TODO.md.`);
      add("Front-End Framework Developer", `Inspect framework/tooling usage in ${packageFile} and confirm the next implementation target.`);
    }
    if (readmeFile) {
      add("Content Designer", projectSpecialty === "creative"
        ? `Tighten overview, file-map, and writing-status wording in ${readmeFile} so another contributor can continue ${project.name} confidently.`
        : `Tighten setup/status wording in ${readmeFile} so the current state of ${project.name} is clear.`);
      add("Support Engineer", projectSpecialty === "creative"
        ? `Use ${readmeFile} to identify handoff or structure gaps that would block another contributor from continuing ${project.name}.`
        : `Use ${readmeFile} to identify setup gaps that would block another developer from running ${project.name}.`);
    }
    if (jsFile) {
      add("Front-End Developer", `Inspect ${jsFile} for the most concrete UI or interaction improvement that can be shipped safely.`);
      add("QA Tester", `Define or run the smallest useful verification around ${jsFile} and capture the result in project notes.`);
    }
    if (cssFile) {
      add("UI Designer", `Review ${cssFile} for the highest-value layout or visual consistency fix.`);
      add("Accessibility Specialist", `Check ${cssFile} for styling choices that could affect readability, focus states, or contrast.`);
    }
    if (phpFile) {
      add("Back-End Developer", `Inspect ${phpFile} for one safe server-side improvement or bug fix.`);
      add("Security Engineer", `Review ${phpFile} for obvious input handling, auth, or data exposure risks.`);
      add("QA Tester", `Add or document one concrete verification path for ${phpFile}.`);
    }
    if (sourceDir && !jsFile && !phpFile) {
      add("Full-Stack Developer", `Inspect ${sourceDir} and choose one vertical-slice improvement that can be completed safely.`);
    }
    if (inspection?.hasSource && !inspection?.hasTests) {
      add("Automation QA Engineer", `Add lightweight coverage or a smoke-check around ${jsFile || phpFile || sourceDir || "the most critical source path"}.`);
    }
    if (inspection?.hasTodoMarkers) {
      add("Project Manager", `Triage the most important TODO/FIXME marker in ${jsFile || phpFile || sourceDir || "the source tree"} and turn it into a concrete work item.`);
    }
    add("Technical Architect / Solutions Architect", `Use ${sourceDir || packageFile || phpFile || readmeFile || "the sampled project files"} to record one concrete architectural or boundary decision if needed.`);
    add("Business Analyst", `Extract one missing rule, requirement, or acceptance criterion from ${readmeFile || phpFile || packageFile || "the sampled files"}.`);

    return roleTasks;
  }

  function getProjectRolePlaybookByName(roleName = "") {
    return PROJECT_ROLE_PLAYBOOKS.find((entry) => String(entry?.name || "").trim() === String(roleName || "").trim()) || null;
  }

  function deriveActiveProjectRoles(project, inspection, directiveState = {}, seededTasks = null) {
    const assessment = buildProjectAssessment(project, inspection, directiveState);
    const seededRoleTasks = seededTasks instanceof Map
      ? seededTasks
      : buildSeededRoleTaskMap(project, inspection, directiveState);
    const orderedNames = PROJECT_ROLE_PLAYBOOKS.map((entry) => entry.name);
    const limit = getProjectActiveRoleLimit(assessment);
    const ranked = orderedNames
      .filter((roleName) => Array.isArray(seededRoleTasks.get(roleName)) && seededRoleTasks.get(roleName).length)
      .map((roleName) => ({
        name: roleName,
        reason: compactTaskText(String(seededRoleTasks.get(roleName)?.[0] || "").trim(), 180),
        score: scoreProjectRoleForActivation(roleName, assessment, {
          taskCount: seededRoleTasks.get(roleName)?.length || 0,
          firstTask: seededRoleTasks.get(roleName)?.[0] || ""
        })
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return orderedNames.indexOf(left.name) - orderedNames.indexOf(right.name);
      });
    return ranked
      .slice(0, Math.max(1, limit))
      .map(({ name, reason }) => ({ name, reason }));
  }

  function parseProjectRoleTaskBoardState(roleTaskContent = "", { project = null, inspection = null, directiveState = null } = {}) {
    const normalizedRoleTaskContent = maybeDecodeEscapedNewlineContent(roleTaskContent);
    const liveAssessment = project && inspection
      ? buildProjectAssessment(project, inspection, directiveState || {})
      : null;
    const assessment = parseProjectAssessmentSnapshot(normalizedRoleTaskContent, liveAssessment);
    const seededRoleTasks = project && inspection
      ? buildSeededRoleTaskMap(project, inspection, directiveState || {})
      : new Map();
    const derivedActiveRoles = project && inspection
      ? deriveActiveProjectRoles(project, inspection, directiveState || {}, seededRoleTasks)
      : [];
    const roleReports = new Map(PROJECT_ROLE_PLAYBOOKS.map((entry) => [entry.name, {
      name: entry.name,
      playbook: entry.playbook,
      checked: [],
      unchecked: [],
      recommended: [],
      explicitSelected: false
    }]));
    for (const [roleName, tasks] of seededRoleTasks.entries()) {
      if (!roleReports.has(roleName)) {
        continue;
      }
      roleReports.get(roleName).recommended = (Array.isArray(tasks) ? tasks : []).slice(0, 3);
    }
    const explicitActiveRoles = [];
    let currentRoleName = "";
    let currentSection = "";
    for (const rawLine of String(normalizedRoleTaskContent || "").split(/\r?\n/)) {
      const line = String(rawLine || "");
      const headingMatch = line.match(/^\s*##\s+(.+?)\s*$/);
      if (headingMatch) {
        currentSection = String(headingMatch[1] || "").trim();
        currentRoleName = roleReports.has(currentSection) ? currentSection : "";
        continue;
      }
      if (currentSection === "Active Roles") {
        const activeMatch = line.match(/^\s*[-*]\s+([^:]+?)(?::\s*(.+))?\s*$/);
        const roleName = String(activeMatch?.[1] || "").trim();
        if (roleName && roleReports.has(roleName)) {
          explicitActiveRoles.push({
            name: roleName,
            reason: compactTaskText(String(activeMatch?.[2] || "").trim(), 180)
          });
          roleReports.get(roleName).explicitSelected = true;
        }
        continue;
      }
      if (!currentRoleName || !roleReports.has(currentRoleName)) {
        continue;
      }
      const checkboxMatch = line.match(/^\s*(?:[-*]\s+)?\[([^\]]*)\]\s+(.+?)\s*$/);
      if (checkboxMatch) {
        const label = String(checkboxMatch[2] || "").replace(/\s+/g, " ").trim();
        if (!label) {
          continue;
        }
        if (/^[xX]$/.test(String(checkboxMatch[1] || "").trim())) {
          roleReports.get(currentRoleName).checked.push(label);
        } else {
          roleReports.get(currentRoleName).unchecked.push(label);
        }
        continue;
      }
      const playbookMatch = line.match(/^\s*Playbook:\s*(.+)\s*$/i);
      if (playbookMatch) {
        roleReports.get(currentRoleName).playbook = compactTaskText(String(playbookMatch[1] || "").trim(), 220);
        continue;
      }
      const narrativeLine = compactTaskText(String(line || "").replace(/^\s*[-*]\s+/, "").trim(), 180);
      if (
        narrativeLine
        && !/^No active role task yet from the current project scan\.?$/i.test(narrativeLine)
        && !/^No confirmed role-specific task yet from the current project scan\.?$/i.test(narrativeLine)
      ) {
        const recommendations = roleReports.get(currentRoleName).recommended;
        if (!recommendations.includes(narrativeLine) && recommendations.length < 3) {
          recommendations.push(narrativeLine);
        }
      }
    }
    const selectedRoleMap = new Map();
    for (const entry of explicitActiveRoles.length ? explicitActiveRoles : derivedActiveRoles) {
      const roleName = String(entry?.name || "").trim();
      if (!roleName || !roleReports.has(roleName)) {
        continue;
      }
      if (!selectedRoleMap.has(roleName)) {
        selectedRoleMap.set(roleName, {
          name: roleName,
          reason: compactTaskText(String(entry?.reason || "").trim(), 180)
        });
      }
    }
    const reports = PROJECT_ROLE_PLAYBOOKS.map((entry) => {
      const base = roleReports.get(entry.name) || {
        name: entry.name,
        playbook: entry.playbook,
        checked: [],
        unchecked: [],
        recommended: [],
        explicitSelected: false
      };
      const selected = selectedRoleMap.has(entry.name) || base.explicitSelected || base.checked.length > 0 || base.unchecked.length > 0;
      const totalCount = base.checked.length + base.unchecked.length;
      return {
        name: entry.name,
        playbook: base.playbook || entry.playbook,
        selected,
        checkedCount: base.checked.length,
        uncheckedCount: base.unchecked.length,
        totalCount,
        checked: base.checked.slice(0, 4),
        unchecked: base.unchecked.slice(0, 4),
        recommended: base.recommended.slice(0, 3),
        reason: compactTaskText(String(selectedRoleMap.get(entry.name)?.reason || base.recommended?.[0] || "").trim(), 180),
        status: totalCount
          ? (base.unchecked.length ? "active" : "completed")
          : (selected ? "planned" : (base.recommended.length ? "suggested" : "idle"))
      };
    });
    return {
      assessment,
      activeRoles: reports.filter((entry) => entry.selected).map((entry) => ({
        name: entry.name,
        reason: entry.reason
      })),
      roleReports: reports.filter((entry) => entry.selected || entry.totalCount > 0 || entry.recommended.length > 0)
    };
  }

  function inspectRoleTaskBoardDerailmentSignals(content = "", roleState = null) {
    const raw = String(content || "");
    const state = roleState && typeof roleState === "object"
      ? roleState
      : parseProjectRoleTaskBoardState(raw);
    const reports = Array.isArray(state?.roleReports) ? state.roleReports : [];
    const hasLiteralEscapedNewlinesOnly = /\\n/.test(raw) && !/\r?\n/.test(raw);
    const hasRoleSections = /(^|\n)\s*##\s+Active Roles\b/im.test(raw) || /(^|\n)\s*##\s+[A-Za-z].+/m.test(raw);
    const hasCheckboxBullets = /(^|\n)\s*(?:[-*]\s+)?\[[ xX]\]\s+\S/m.test(raw);
    const allTaskLabels = reports.flatMap((entry) => [
      ...(Array.isArray(entry?.checked) ? entry.checked : []),
      ...(Array.isArray(entry?.unchecked) ? entry.unchecked : [])
    ]);
    const hasTruncatedItems = allTaskLabels.some((entry) => /\.\.\.$|…$/.test(String(entry || "").trim()));
    const signals = [];
    if (hasLiteralEscapedNewlinesOnly) {
      signals.push("literal_escaped_newlines");
    }
    if (hasRoleSections && hasCheckboxBullets && !allTaskLabels.length) {
      signals.push("empty_parse_with_structured_content");
    }
    if (hasTruncatedItems) {
      signals.push("truncated_items");
    }
    return signals;
  }

  function buildProjectRoleTaskBoardContent(project, inspection, directiveState = {}) {
    const assessment = buildProjectAssessment(project, inspection, directiveState);
    const seededTasks = buildSeededRoleTaskMap(project, inspection, directiveState);
    const activeRoles = deriveActiveProjectRoles(project, inspection, directiveState, seededTasks);
    const activeRoleNameSet = new Set(activeRoles.map((entry) => String(entry?.name || "").trim()).filter(Boolean));
    const lines = [
      `# Project Role Tasks: ${project.name}`,
      "",
      "Use this file as the running task board for project work by role.",
      "Nova can add tasks, tick them off, and move work between roles as understanding improves.",
      "Keep tasks concrete. Prefer one-line checkbox items that point to a file, feature, defect, document, or validation target.",
      "",
      "## Assessment Snapshot",
      `- Phase: ${assessment.phaseLabel}`,
      `- Primary track: ${assessment.workstreamLabel}`,
      `- Current priority: ${assessment.currentPriority}`,
      `- Deferred posture: ${assessment.deferredPosture}`,
      "",
      "## Active Roles",
      ...(activeRoles.length
        ? activeRoles.map((entry) => `- ${entry.name}: ${entry.reason}`)
        : ["- Project Manager: Keep the project board aligned until clearer specialist work emerges."]),
      "",
      ...PROJECT_ROLE_PLAYBOOKS.flatMap((entry) => ([
        `## ${entry.name}`,
        `Playbook: ${entry.playbook}`,
        ...(activeRoleNameSet.has(entry.name)
          ? (seededTasks.get(entry.name)?.length
            ? seededTasks.get(entry.name).map((task) => `- [ ] ${task}`)
            : ["No active role task yet from the current project scan."])
          : buildInactiveRoleSectionLines(entry.name, seededTasks.get(entry.name) || [], assessment)),
        ""
      ])),
      "## Notes",
      `- Generated by Nova from native project inspection on ${new Date().toLocaleString("en-AU")}.`,
      inspection?.files?.length ? `- Files sampled: ${inspection.files.slice(0, 12).join(", ")}` : "- Files sampled: none.",
      "- Review PROJECT-TODO.md alongside this file for the general advancement checklist.",
      ""
    ];
    return lines.filter(Boolean).join("\n");
  }

  async function ensureProjectRoleTaskBoardForWorkspaceProject(project, inspection = null) {
    if (!getProjectConfig().autoCreateProjectRoleTasks) {
      return {
        roleTaskPath: `${project.path}/PROJECT-ROLE-TASKS.md`,
        unchecked: [],
        checked: [],
        activeRoles: [],
        roleReports: [],
        assessment: null
      };
    }
    const directiveSeed = await ensureProjectDirectiveForWorkspaceProject(project, inspection);
    const resolvedInspection = directiveSeed.inspection;
    const directiveState = await readProjectDirectiveState(project, resolvedInspection);
    const roleTaskPath = `${project.path}/PROJECT-ROLE-TASKS.md`;
    let roleTaskContent = "";
    try {
      roleTaskContent = await readContainerFile(roleTaskPath);
    } catch {
      roleTaskContent = "";
    }
    const hasRoleTaskBoard = Boolean(roleTaskContent);
    const looksLikeBlankTemplate = hasRoleTaskBoard
      && !/^- \[[ xX]\] .+/m.test(roleTaskContent)
      && /^- \[ \]$/m.test(roleTaskContent);
    const shouldRefreshLegacyBoard = hasRoleTaskBoard && shouldRefreshLegacyPlanningContent(project, resolvedInspection, roleTaskContent);
    if (!hasRoleTaskBoard || looksLikeBlankTemplate || shouldRefreshLegacyBoard) {
      const content = buildProjectRoleTaskBoardContent(project, resolvedInspection, directiveState);
      await writeContainerTextFile(roleTaskPath, content, { timeoutMs: 30000 });
      roleTaskContent = content;
    }
    const repairedRoleTaskContent = repairSatisfiedTemplateSetupTasks(roleTaskContent, resolvedInspection);
    if (repairedRoleTaskContent !== roleTaskContent) {
      await writeContainerTextFile(roleTaskPath, repairedRoleTaskContent, { timeoutMs: 30000 });
      roleTaskContent = repairedRoleTaskContent;
    }
    if (!roleTaskContent) {
      roleTaskContent = await readContainerFile(roleTaskPath);
    }
    const roleState = parseProjectRoleTaskBoardState(roleTaskContent, {
      project,
      inspection: resolvedInspection,
      directiveState
    });
    const roleDerailmentSignals = inspectRoleTaskBoardDerailmentSignals(roleTaskContent, roleState);
    let derailmentRecovered = false;
    if (roleDerailmentSignals.length) {
      const canonicalRoleTaskContent = buildProjectRoleTaskBoardContent(project, resolvedInspection, directiveState);
      if (canonicalRoleTaskContent && canonicalRoleTaskContent.trim() !== String(roleTaskContent || "").trim()) {
        await writeContainerTextFile(roleTaskPath, canonicalRoleTaskContent, { timeoutMs: 30000 });
        roleTaskContent = canonicalRoleTaskContent;
        derailmentRecovered = true;
      }
    }
    const recoveredRoleState = parseProjectRoleTaskBoardState(roleTaskContent, {
      project,
      inspection: resolvedInspection,
      directiveState
    });
    const recoveredUnchecked = extractCheckboxItems(roleTaskContent, { checked: false });
    const recoveredChecked = extractCheckboxItems(roleTaskContent, { checked: true });
    return {
      roleTaskPath,
      unchecked: recoveredUnchecked,
      checked: recoveredChecked,
      assessment: recoveredRoleState?.assessment || null,
      activeRoles: Array.isArray(recoveredRoleState?.activeRoles) ? recoveredRoleState.activeRoles : [],
      roleReports: Array.isArray(recoveredRoleState?.roleReports) ? recoveredRoleState.roleReports : [],
      derailmentSignals: roleDerailmentSignals,
      derailmentRecovered
    };
  }

  async function ensureProjectTodoForWorkspaceProject(project) {
    const projectConfig = getProjectConfig();
    const directiveSeed = await ensureProjectDirectiveForWorkspaceProject(project);
    const inspection = directiveSeed.inspection;
    const directiveState = await readProjectDirectiveState(project, inspection);
    const todoPath = `${project.path}/PROJECT-TODO.md`;
    let syntheticTodoContent = "";
    if (!inspection?.hasTodo && projectConfig.autoCreateProjectTodo) {
      const content = buildProjectTodoContent(project, inspection, directiveState);
      await writeContainerTextFile(todoPath, content, { timeoutMs: 30000 });
    } else if (!inspection?.hasTodo) {
      syntheticTodoContent = buildProjectTodoContent(project, inspection, directiveState);
    }
    const roleTaskBoard = await ensureProjectRoleTaskBoardForWorkspaceProject(project, inspection);
    let todoContent = "";
    try {
      todoContent = await readContainerFile(todoPath);
    } catch {
      todoContent = syntheticTodoContent;
    }
    const todoWasBlank = !String(todoContent || "").trim();
    let parsedTodoState = parseProjectTodoState(todoContent);
    if (!todoWasBlank && parsedTodoState.normalized && parsedTodoState.normalizedContent !== todoContent) {
      await writeContainerTextFile(todoPath, parsedTodoState.normalizedContent, { timeoutMs: 30000 });
      todoContent = parsedTodoState.normalizedContent;
      parsedTodoState = parseProjectTodoState(todoContent);
    }
    const repairedSatisfiedSetupTasks = repairSatisfiedTemplateSetupTasks(todoContent, inspection);
    if (repairedSatisfiedSetupTasks !== todoContent) {
      await writeContainerTextFile(todoPath, repairedSatisfiedSetupTasks, { timeoutMs: 30000 });
      todoContent = repairedSatisfiedSetupTasks;
      parsedTodoState = parseProjectTodoState(todoContent);
    }
    const todoLooksLikeBlankTemplate = !todoWasBlank
      && !/^- \[[ xX]\] .+$/m.test(todoContent)
      && /^- \[ \]$/m.test(todoContent);
    const shouldRefreshLegacyTodo = !todoWasBlank && shouldRefreshLegacyPlanningContent(project, inspection, todoContent);
    let todoRecovered = false;
    if (todoWasBlank || todoLooksLikeBlankTemplate || shouldRefreshLegacyTodo) {
      const canonicalTodoContent = buildProjectTodoContent(project, inspection, directiveState);
      if (String(canonicalTodoContent || "").trim()) {
        await writeContainerTextFile(todoPath, canonicalTodoContent, { timeoutMs: 30000 });
        todoContent = canonicalTodoContent;
        parsedTodoState = parseProjectTodoState(todoContent);
        todoRecovered = true;
      }
    }
    const directiveCompleted = Boolean(
      directiveState?.authoritative
      && Array.isArray(directiveState.checkedItems)
      && directiveState.checkedItems.length
      && (!Array.isArray(directiveState.uncheckedItems) || !directiveState.uncheckedItems.length)
    );
    if (directiveCompleted) {
      const canonicalTodoContent = buildProjectTodoContent(project, inspection, directiveState);
      if (canonicalTodoContent && canonicalTodoContent.trim() !== String(todoContent || "").trim()) {
        await writeContainerTextFile(todoPath, canonicalTodoContent, { timeoutMs: 30000 });
        todoContent = canonicalTodoContent;
        parsedTodoState = parseProjectTodoState(todoContent);
      }
      const canonicalRoleTaskContent = buildProjectRoleTaskBoardContent(project, inspection, directiveState);
      if (canonicalRoleTaskContent) {
        await writeContainerTextFile(roleTaskBoard.roleTaskPath, canonicalRoleTaskContent, { timeoutMs: 30000 });
      }
    }
    parsedTodoState = parseProjectTodoState(todoContent);
    const todoDerailmentSignals = inspectTodoDerailmentSignals(todoContent, parsedTodoState);
    let todoDerailmentRecovered = false;
    if (todoDerailmentSignals.length) {
      const canonicalTodoContent = buildProjectTodoContent(project, inspection, directiveState);
      if (canonicalTodoContent && canonicalTodoContent.trim() !== String(todoContent || "").trim()) {
        await writeContainerTextFile(todoPath, canonicalTodoContent, { timeoutMs: 30000 });
        todoContent = canonicalTodoContent;
        parsedTodoState = parseProjectTodoState(todoContent);
        todoDerailmentRecovered = true;
      }
    }
    const unchecked = Array.isArray(parsedTodoState?.unchecked) ? parsedTodoState.unchecked : [];
    const checked = Array.isArray(parsedTodoState?.checked) ? parsedTodoState.checked : [];
    const assessment = roleTaskBoard?.assessment
      || buildProjectAssessment(project, inspection, directiveState, {
        todoState: {
          checked,
          unchecked
        }
      });
    return {
      inspection,
      todoPath,
      roleTaskPath: roleTaskBoard.roleTaskPath,
      unchecked,
      checked,
      assessment,
      roleUnchecked: directiveCompleted ? [] : roleTaskBoard.unchecked,
      roleChecked: directiveCompleted ? [] : roleTaskBoard.checked,
      activeRoles: directiveCompleted ? [] : roleTaskBoard.activeRoles,
      roleReports: directiveCompleted ? [] : roleTaskBoard.roleReports,
      directiveState,
      directiveCompleted,
      todoRecovered,
      derailmentSignals: {
        todo: todoDerailmentSignals,
        roleTasks: Array.isArray(roleTaskBoard?.derailmentSignals) ? roleTaskBoard.derailmentSignals : []
      },
      derailmentRecovered: {
        todo: todoDerailmentRecovered,
        roleTasks: roleTaskBoard?.derailmentRecovered === true
      }
    };
  }

  return {
    buildProjectDirectiveContent,
    buildProjectAssessment,
    buildProjectRoleTaskBoardContent,
    buildProjectTodoContent,
    ensureProjectDirectiveForWorkspaceProject,
    ensureProjectRoleTaskBoardForWorkspaceProject,
    ensureProjectTodoForWorkspaceProject,
    findProjectDirectiveFile,
    getProjectImplementationRoot,
    inferProjectCycleSpecialty,
    parseProjectTodoState,
    parseProjectAssessmentSnapshot,
    parseProjectRoleTaskBoardState,
    parseProjectDirectiveState,
    pickInspectionFile,
    readProjectDirectiveState
  };
}
