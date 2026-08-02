const PROJECT_FRAGMENT_ROOT_DIR = ".observer-fragments";
const PROJECT_FRAGMENT_CHAIN_FILE = "prose-chain.json";
const PROJECT_FRAGMENT_TYPES = [
  "prose",
  "character",
  "guideline",
  "knowledge",
  "note",
  "summary",
  "marker"
];
const PROJECT_FRAGMENT_PREFIXES = {
  prose: "pr",
  character: "ch",
  guideline: "gl",
  knowledge: "kn",
  note: "nt",
  summary: "sm",
  marker: "mk"
};
const PROJECT_FRAGMENT_STICKY_DEFAULTS = {
  guideline: true,
  summary: true
};
const PROJECT_FRAGMENT_TYPE_DEFINITIONS = {
  prose: {
    label: "Prose",
    description: "Draft manuscript, scene, chapter, or variation text.",
    stickyByDefault: false,
    placement: "user"
  },
  character: {
    label: "Character",
    description: "Character sheet, motivation, voice, relationship, or arc note.",
    stickyByDefault: false,
    placement: "user"
  },
  guideline: {
    label: "Guideline",
    description: "Always-available style, tone, canon, or writing instruction.",
    stickyByDefault: true,
    placement: "user"
  },
  knowledge: {
    label: "Knowledge",
    description: "Worldbuilding, continuity, setting, object, faction, or rule.",
    stickyByDefault: false,
    placement: "user"
  },
  note: {
    label: "Note",
    description: "Loose project memory, brainstorm, beat, issue, or reference.",
    stickyByDefault: false,
    placement: "user"
  },
  summary: {
    label: "Summary",
    description: "Rolling or scoped story summary for continuity context.",
    stickyByDefault: true,
    placement: "system"
  },
  marker: {
    label: "Marker",
    description: "Structural chapter, act, or timeline marker.",
    stickyByDefault: false,
    placement: "user"
  }
};

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeSearchText(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactFallback(value = "", maxLength = 220) {
  const text = normalizeText(value).replace(/\s+/g, " ");
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function uniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  )];
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.round(numeric), max));
}

function randomFragmentSuffix() {
  const consonants = "bdfgkmnprstvz";
  const vowels = "aeiou";
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    const pool = index % 2 === 0 ? consonants : vowels;
    suffix += pool[Math.floor(Math.random() * pool.length)];
  }
  return suffix;
}

function renderProjectFragmentContext(fragment = {}) {
  const type = normalizeText(fragment.type);
  const name = normalizeText(fragment.name || fragment.id);
  const content = normalizeText(fragment.content);
  if (type === "prose" || type === "summary") {
    return content;
  }
  if (type === "guideline") {
    return `**${name}**: ${content}`;
  }
  if (type === "character") {
    return `## ${name}\n${content}`;
  }
  if (type === "knowledge" || type === "note") {
    return `### ${name}\n${content}`;
  }
  if (type === "marker") {
    return "";
  }
  return `[${type || "fragment"}:${fragment.id}] ${content}`;
}

function normalizeProseChainEntry(entry = {}) {
  const proseFragments = uniqueStrings(entry?.proseFragments || []);
  const active = normalizeText(entry?.active);
  return {
    proseFragments,
    active: active && proseFragments.includes(active) ? active : (proseFragments[0] || "")
  };
}

function normalizeFragmentBundleFragment(input = {}) {
  return {
    type: normalizeText(input.type || "note"),
    name: normalizeText(input.name || ""),
    description: normalizeText(input.description || ""),
    content: String(input.content || ""),
    tags: uniqueStrings(input.tags || []),
    refs: uniqueStrings(input.refs || []),
    sticky: input.sticky === true,
    placement: normalizeText(input.placement) === "system" ? "system" : "user",
    order: clampInteger(input.order, 0, -100000, 100000),
    meta: input.meta && typeof input.meta === "object" ? input.meta : {}
  };
}

export function createProjectFragmentSystem(context = {}) {
  const {
    compactTaskText = compactFallback,
    fs,
    listContainerWorkspaceProjects,
    path
  } = context;

  async function readJsonFileIfExists(filePath = "", fallback = null) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  async function writeJsonFile(filePath = "", value = null) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  function getProjectFragmentRoot(project = {}) {
    const projectPath = normalizeText(project?.path);
    return projectPath ? path.join(projectPath, PROJECT_FRAGMENT_ROOT_DIR) : "";
  }

  function getProjectFragmentDir(project = {}) {
    const root = getProjectFragmentRoot(project);
    return root ? path.join(root, "fragments") : "";
  }

  function getProjectFragmentPath(project = {}, fragmentId = "") {
    const dir = getProjectFragmentDir(project);
    const id = normalizeText(fragmentId);
    return dir && id ? path.join(dir, `${id}.json`) : "";
  }

  function normalizeFragmentType(type = "") {
    const normalized = normalizeText(type).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
    return normalized || "note";
  }

  function normalizeProjectFragmentInput(input = {}, existing = null) {
    const now = new Date().toISOString();
    const type = normalizeFragmentType(input.type || existing?.type || "note");
    const id = normalizeText(input.id || existing?.id);
    const name = compactTaskText(normalizeText(input.name || existing?.name || id || type), 100);
    const content = String(input.content ?? existing?.content ?? "");
    const description = compactTaskText(normalizeText(input.description ?? existing?.description ?? content), 250);
    return {
      id,
      type,
      name,
      description,
      content,
      tags: uniqueStrings(input.tags ?? existing?.tags ?? []),
      refs: uniqueStrings(input.refs ?? existing?.refs ?? []),
      sticky: input.sticky == null
        ? Boolean(existing?.sticky ?? PROJECT_FRAGMENT_STICKY_DEFAULTS[type])
        : input.sticky === true,
      placement: normalizeText(input.placement || existing?.placement || PROJECT_FRAGMENT_TYPE_DEFINITIONS[type]?.placement) === "system" ? "system" : "user",
      createdAt: normalizeText(existing?.createdAt || input.createdAt) || now,
      updatedAt: normalizeText(input.updatedAt || existing?.updatedAt) || now,
      order: clampInteger(input.order ?? existing?.order, 0, -100000, 100000),
      meta: input.meta && typeof input.meta === "object"
        ? input.meta
        : (existing?.meta && typeof existing.meta === "object" ? existing.meta : {}),
      archived: input.archived == null ? Boolean(existing?.archived) : input.archived === true,
      version: clampInteger(existing?.version, 1, 1, 100000),
      versions: Array.isArray(existing?.versions) ? existing.versions : []
    };
  }

  function makeVersionSnapshot(fragment = {}, reason = "") {
    return {
      version: clampInteger(fragment.version, 1, 1, 100000),
      name: normalizeText(fragment.name),
      description: normalizeText(fragment.description),
      content: String(fragment.content || ""),
      createdAt: new Date().toISOString(),
      ...(normalizeText(reason) ? { reason: normalizeText(reason) } : {})
    };
  }

  async function resolveWorkspaceProject({ projectName = "", projectPath = "" } = {}) {
    const requestedName = normalizeSearchText(projectName);
    const requestedPath = normalizeText(projectPath);
    const projects = typeof listContainerWorkspaceProjects === "function"
      ? await listContainerWorkspaceProjects().catch(() => [])
      : [];
    if (requestedPath) {
      const resolved = projects.find((project) => normalizeText(project?.path) === requestedPath);
      if (resolved) {
        return resolved;
      }
    }
    if (requestedName) {
      const resolved = projects.find((project) => normalizeSearchText(project?.name) === requestedName);
      if (resolved) {
        return resolved;
      }
    }
    if (!requestedName && !requestedPath && projects.length === 1) {
      return projects[0];
    }
    throw new Error(projectName || projectPath
      ? `No workspace project found for ${projectName || projectPath}`
      : "projectName or projectPath is required");
  }

  async function listProjectFragments(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const dir = getProjectFragmentDir(project);
    const typeFilter = normalizeFragmentType(options.type || "");
    const hasTypeFilter = normalizeText(options.type);
    const query = normalizeSearchText(options.query || "");
    const includeArchived = options.includeArchived === true;
    const limit = clampInteger(options.limit, 100, 1, 500);
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const fragments = [];
    for (const entry of entries) {
      if (!entry.isFile() || !String(entry.name || "").endsWith(".json")) {
        continue;
      }
      const fragment = await readJsonFileIfExists(path.join(dir, entry.name), null);
      if (!fragment || typeof fragment !== "object") {
        continue;
      }
      const normalized = normalizeProjectFragmentInput(fragment, fragment);
      if (!includeArchived && normalized.archived) {
        continue;
      }
      if (hasTypeFilter && normalized.type !== typeFilter) {
        continue;
      }
      if (query) {
        const haystack = normalizeSearchText([
          normalized.id,
          normalized.type,
          normalized.name,
          normalized.description,
          normalized.content,
          ...(Array.isArray(normalized.tags) ? normalized.tags : [])
        ].join("\n"));
        if (!haystack.includes(query)) {
          continue;
        }
      }
      fragments.push(normalized);
    }
    fragments.sort((left, right) =>
      String(left.type).localeCompare(String(right.type))
      || Number(left.order || 0) - Number(right.order || 0)
      || String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
    );
    return {
      project,
      fragments: fragments.slice(0, limit),
      totalAvailable: fragments.length
    };
  }

  async function generateProjectFragmentId(project = {}, type = "note") {
    const prefix = PROJECT_FRAGMENT_PREFIXES[normalizeFragmentType(type)] || normalizeFragmentType(type).slice(0, 4) || "fr";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const id = `${prefix}-${randomFragmentSuffix()}`;
      try {
        await fs.access(getProjectFragmentPath(project, id));
      } catch {
        return id;
      }
    }
    return `${prefix}-${Date.now().toString(36).slice(-8)}`;
  }

  async function getProjectFragment(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const fragmentId = normalizeText(options.fragmentId || options.id);
    if (!fragmentId) {
      throw new Error("fragmentId is required");
    }
    const fragment = await readJsonFileIfExists(getProjectFragmentPath(project, fragmentId), null);
    if (!fragment || typeof fragment !== "object") {
      return { project, fragment: null };
    }
    return {
      project,
      fragment: normalizeProjectFragmentInput(fragment, fragment)
    };
  }

  async function createProjectFragment(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const input = options.fragment && typeof options.fragment === "object" ? options.fragment : options;
    const type = normalizeFragmentType(input.type || "note");
    const id = normalizeText(input.id) || await generateProjectFragmentId(project, type);
    const fragment = {
      ...normalizeProjectFragmentInput({ ...input, id, type }, null),
      version: 1,
      versions: []
    };
    await writeJsonFile(getProjectFragmentPath(project, fragment.id), fragment);
    if (fragment.type === "prose" && options.addToChain !== false) {
      await addProjectProseSection({ projectName: project.name, projectPath: project.path, fragmentId: fragment.id });
    }
    return { project, fragment };
  }

  async function updateProjectFragment(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const fragmentId = normalizeText(options.fragmentId || options.id);
    if (!fragmentId) {
      throw new Error("fragmentId is required");
    }
    const existing = await readJsonFileIfExists(getProjectFragmentPath(project, fragmentId), null);
    if (!existing || typeof existing !== "object") {
      throw new Error(`Fragment not found: ${fragmentId}`);
    }
    const input = options.fragment && typeof options.fragment === "object" ? options.fragment : options;
    const normalizedExisting = normalizeProjectFragmentInput(existing, existing);
    const next = normalizeProjectFragmentInput({ ...input, id: fragmentId }, normalizedExisting);
    next.updatedAt = new Date().toISOString();
    const changed = next.name !== normalizedExisting.name
      || next.description !== normalizedExisting.description
      || next.content !== normalizedExisting.content
      || next.type !== normalizedExisting.type;
    if (changed) {
      next.version = clampInteger(normalizedExisting.version, 1, 1, 100000) + 1;
      next.versions = [
        ...(Array.isArray(normalizedExisting.versions) ? normalizedExisting.versions : []),
        makeVersionSnapshot(normalizedExisting, options.reason || "project-fragment-update")
      ];
    }
    await writeJsonFile(getProjectFragmentPath(project, fragmentId), next);
    return { project, fragment: next };
  }

  async function listProjectFragmentVersions(options = {}) {
    const result = await getProjectFragment(options);
    return {
      ...result,
      versions: Array.isArray(result.fragment?.versions) ? result.fragment.versions : []
    };
  }

  async function revertProjectFragmentVersion(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const fragmentId = normalizeText(options.fragmentId || options.id);
    const targetVersion = clampInteger(options.version, 0, 0, 100000);
    if (!fragmentId || !targetVersion) {
      throw new Error("fragmentId and version are required");
    }
    const existing = await readJsonFileIfExists(getProjectFragmentPath(project, fragmentId), null);
    const normalizedExisting = normalizeProjectFragmentInput(existing, existing);
    const versions = Array.isArray(normalizedExisting.versions) ? normalizedExisting.versions : [];
    const snapshot = versions.find((entry) => Number(entry?.version || 0) === targetVersion);
    if (!snapshot) {
      throw new Error(`Fragment version not found: ${targetVersion}`);
    }
    const next = {
      ...normalizedExisting,
      name: normalizeText(snapshot.name || normalizedExisting.name),
      description: normalizeText(snapshot.description || normalizedExisting.description),
      content: String(snapshot.content ?? normalizedExisting.content ?? ""),
      updatedAt: new Date().toISOString(),
      version: clampInteger(normalizedExisting.version, 1, 1, 100000) + 1,
      versions: [
        ...versions,
        makeVersionSnapshot(normalizedExisting, `revert-to-${targetVersion}`)
      ]
    };
    await writeJsonFile(getProjectFragmentPath(project, fragmentId), next);
    return { project, fragment: next };
  }

  async function archiveProjectFragment(options = {}) {
    return updateProjectFragment({ ...options, archived: true, reason: "archive" });
  }

  async function restoreProjectFragment(options = {}) {
    return updateProjectFragment({ ...options, archived: false, reason: "restore" });
  }

  async function readProjectProseChain(project = {}) {
    const root = getProjectFragmentRoot(project);
    const chain = await readJsonFileIfExists(path.join(root, PROJECT_FRAGMENT_CHAIN_FILE), { entries: [] });
    return {
      entries: Array.isArray(chain?.entries)
        ? chain.entries
            .map(normalizeProseChainEntry)
            .filter((entry) => entry.active && entry.proseFragments.includes(entry.active))
        : []
    };
  }

  async function writeProjectProseChain(project = {}, chain = { entries: [] }) {
    const root = getProjectFragmentRoot(project);
    await writeJsonFile(path.join(root, PROJECT_FRAGMENT_CHAIN_FILE), {
      entries: Array.isArray(chain?.entries) ? chain.entries : []
    });
  }

  async function addProjectProseSection(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const fragmentId = normalizeText(options.fragmentId || options.id);
    if (!fragmentId) {
      throw new Error("fragmentId is required");
    }
    const chain = await readProjectProseChain(project);
    if (!chain.entries.some((entry) => entry.proseFragments.includes(fragmentId))) {
      chain.entries.push({ proseFragments: [fragmentId], active: fragmentId });
      await writeProjectProseChain(project, chain);
    }
    return { project, chain };
  }

  async function addProjectProseVariation(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const sectionIndex = clampInteger(options.sectionIndex, -1, -1, 100000);
    const fragmentId = normalizeText(options.fragmentId || options.id);
    if (sectionIndex < 0 || !fragmentId) {
      throw new Error("sectionIndex and fragmentId are required");
    }
    const chain = await readProjectProseChain(project);
    const entry = chain.entries[sectionIndex];
    if (!entry) {
      throw new Error(`Prose section not found: ${sectionIndex}`);
    }
    entry.proseFragments = uniqueStrings([...entry.proseFragments, fragmentId]);
    entry.active = fragmentId;
    await writeProjectProseChain(project, chain);
    return { project, chain };
  }

  async function switchActiveProjectProse(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const sectionIndex = clampInteger(options.sectionIndex, -1, -1, 100000);
    const fragmentId = normalizeText(options.fragmentId || options.id);
    if (sectionIndex < 0 || !fragmentId) {
      throw new Error("sectionIndex and fragmentId are required");
    }
    const chain = await readProjectProseChain(project);
    const entry = chain.entries[sectionIndex];
    if (!entry || !entry.proseFragments.includes(fragmentId)) {
      throw new Error(`Prose variation not found in section ${sectionIndex}: ${fragmentId}`);
    }
    entry.active = fragmentId;
    await writeProjectProseChain(project, chain);
    return { project, chain };
  }

  async function removeProjectProseSection(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const sectionIndex = clampInteger(options.sectionIndex, -1, -1, 100000);
    if (sectionIndex < 0) {
      throw new Error("sectionIndex is required");
    }
    const chain = await readProjectProseChain(project);
    const removed = chain.entries.splice(sectionIndex, 1);
    await writeProjectProseChain(project, chain);
    if (options.archiveFragments === true) {
      for (const fragmentId of removed.flatMap((entry) => entry.proseFragments || [])) {
        await archiveProjectFragment({
          projectName: project.name,
          projectPath: project.path,
          fragmentId
        }).catch(() => null);
      }
    }
    return { project, chain, removed };
  }

  async function moveProjectProseSection(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const fromIndex = clampInteger(options.fromIndex ?? options.sectionIndex, -1, -1, 100000);
    const toIndex = clampInteger(options.toIndex, -1, -1, 100000);
    if (fromIndex < 0 || toIndex < 0) {
      throw new Error("fromIndex and toIndex are required");
    }
    const chain = await readProjectProseChain(project);
    if (!chain.entries[fromIndex] || toIndex >= chain.entries.length) {
      throw new Error(`Cannot move prose section ${fromIndex} to ${toIndex}`);
    }
    const [entry] = chain.entries.splice(fromIndex, 1);
    chain.entries.splice(toIndex, 0, entry);
    await writeProjectProseChain(project, chain);
    return { project, chain };
  }

  async function reorderProjectFragments(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const items = Array.isArray(options.items) ? options.items : [];
    const updated = [];
    for (const item of items) {
      const fragmentId = normalizeText(item?.id || item?.fragmentId);
      if (!fragmentId) {
        continue;
      }
      const result = await updateProjectFragment({
        projectName: project.name,
        projectPath: project.path,
        fragmentId,
        fragment: {
          order: clampInteger(item?.order, 0, -100000, 100000)
        },
        reason: "reorder"
      }).catch(() => null);
      if (result?.fragment) {
        updated.push(result.fragment);
      }
    }
    return { project, updated };
  }

  async function getProjectProseChain(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const chain = await readProjectProseChain(project);
    const fragments = await listProjectFragments({
      projectName: project.name,
      projectPath: project.path,
      includeArchived: true,
      limit: 500
    }).then((result) => result.fragments).catch(() => []);
    const byId = new Map(fragments.map((fragment) => [fragment.id, fragment]));
    return {
      project,
      chain: {
        entries: chain.entries.map((entry, index) => ({
          ...entry,
          sectionIndex: index,
          activeFragment: byId.get(entry.active) ? summarizeFragment(byId.get(entry.active)) : null,
          fragments: entry.proseFragments
            .map((fragmentId) => byId.get(fragmentId))
            .filter(Boolean)
            .map(summarizeFragment)
        }))
      }
    };
  }

  async function getProjectFragmentRefs(options = {}) {
    const { project, fragment } = await getProjectFragment(options);
    if (!fragment) {
      throw new Error("fragment not found");
    }
    const all = await listProjectFragments({
      projectName: project.name,
      projectPath: project.path,
      includeArchived: true,
      limit: 500
    }).then((result) => result.fragments);
    const byId = new Map(all.map((entry) => [entry.id, entry]));
    const refs = uniqueStrings(fragment.refs || []).map((id) => ({
      id,
      found: byId.has(id),
      fragment: byId.has(id) ? summarizeFragment(byId.get(id)) : null
    }));
    const backRefs = all
      .filter((entry) => entry.id !== fragment.id && uniqueStrings(entry.refs || []).includes(fragment.id))
      .map(summarizeFragment);
    return {
      project,
      fragment: summarizeFragment(fragment),
      refs,
      backRefs
    };
  }

  async function validateProjectFragments(options = {}) {
    const { project, fragments } = await listProjectFragments({
      ...options,
      includeArchived: true,
      limit: 500
    });
    const byId = new Map(fragments.map((fragment) => [fragment.id, fragment]));
    const chain = await readProjectProseChain(project);
    const issues = [];
    for (const fragment of fragments) {
      for (const refId of uniqueStrings(fragment.refs || [])) {
        if (!byId.has(refId)) {
          issues.push({
            code: "missing_ref",
            severity: "warning",
            fragmentId: fragment.id,
            refId,
            message: `Fragment ${fragment.id} references missing fragment ${refId}.`
          });
        }
      }
    }
    chain.entries.forEach((entry, index) => {
      if (!byId.has(entry.active)) {
        issues.push({
          code: "missing_active_prose",
          severity: "error",
          sectionIndex: index,
          fragmentId: entry.active,
          message: `Prose chain section ${index + 1} has missing active fragment ${entry.active}.`
        });
      }
      for (const fragmentId of entry.proseFragments) {
        const fragment = byId.get(fragmentId);
        if (!fragment) {
          issues.push({
            code: "missing_prose_variation",
            severity: "warning",
            sectionIndex: index,
            fragmentId,
            message: `Prose chain section ${index + 1} includes missing variation ${fragmentId}.`
          });
        } else if (fragment.type !== "prose" && fragment.type !== "marker") {
          issues.push({
            code: "non_prose_chain_fragment",
            severity: "warning",
            sectionIndex: index,
            fragmentId,
            message: `Prose chain section ${index + 1} includes ${fragment.type} fragment ${fragmentId}.`
          });
        }
      }
    });
    return {
      project,
      ok: issues.length === 0,
      issues,
      summary: {
        fragmentCount: fragments.length,
        proseSectionCount: chain.entries.length,
        issueCount: issues.length
      }
    };
  }

  async function exportProjectFragmentBundle(options = {}) {
    const { project, fragments } = await listProjectFragments({
      ...options,
      includeArchived: options.includeArchived === true,
      limit: 500
    });
    const chain = await readProjectProseChain(project);
    return {
      _observer: "project-fragment-bundle",
      version: 1,
      exportedAt: new Date().toISOString(),
      projectName: project.name,
      sourcePath: project.path,
      fragments: fragments.map((fragment) => ({
        id: fragment.id,
        type: fragment.type,
        name: fragment.name,
        description: fragment.description,
        content: fragment.content,
        tags: fragment.tags,
        refs: fragment.refs,
        sticky: fragment.sticky,
        placement: fragment.placement,
        order: fragment.order,
        meta: fragment.meta,
        archived: fragment.archived,
        version: fragment.version,
        versions: fragment.versions
      })),
      proseChain: chain
    };
  }

  async function importProjectFragmentBundle(options = {}) {
    const project = await resolveWorkspaceProject(options);
    const bundle = options.bundle && typeof options.bundle === "object" ? options.bundle : {};
    const fragments = Array.isArray(bundle.fragments) ? bundle.fragments : [];
    const preserveIds = options.preserveIds !== false;
    const overwrite = options.overwrite === true;
    const idMap = new Map();
    const imported = [];
    for (const rawFragment of fragments) {
      const sourceId = normalizeText(rawFragment?.id);
      if (!sourceId || idMap.has(sourceId)) {
        continue;
      }
      const type = normalizeFragmentType(rawFragment?.type || "note");
      idMap.set(sourceId, preserveIds ? sourceId : await generateProjectFragmentId(project, type));
    }
    for (const rawFragment of fragments) {
      const sourceId = normalizeText(rawFragment?.id);
      const type = normalizeFragmentType(rawFragment?.type || "note");
      const targetId = idMap.get(sourceId) || await generateProjectFragmentId(project, type);
      if (!sourceId) {
        idMap.set(targetId, targetId);
      }
      const fragment = {
        ...normalizeFragmentBundleFragment(rawFragment),
        id: targetId,
        type
      };
      const existing = await readJsonFileIfExists(getProjectFragmentPath(project, targetId), null);
      if (existing && !overwrite) {
        continue;
      }
      const normalized = normalizeProjectFragmentInput({
        ...fragment,
        refs: uniqueStrings(fragment.refs).map((refId) => idMap.get(refId) || refId)
      }, overwrite && existing ? normalizeProjectFragmentInput(existing, existing) : null);
      normalized.id = targetId;
      normalized.version = existing && overwrite ? clampInteger(existing.version, 1, 1, 100000) + 1 : clampInteger(rawFragment?.version, 1, 1, 100000);
      normalized.versions = Array.isArray(rawFragment?.versions) ? rawFragment.versions : [];
      await writeJsonFile(getProjectFragmentPath(project, targetId), normalized);
      imported.push(normalized);
    }
    if (bundle.proseChain && typeof bundle.proseChain === "object") {
      const chain = {
        entries: Array.isArray(bundle.proseChain.entries)
          ? bundle.proseChain.entries.map((entry) => normalizeProseChainEntry({
            proseFragments: uniqueStrings(entry?.proseFragments || []).map((id) => idMap.get(id) || id),
            active: idMap.get(entry?.active) || entry?.active
          })).filter((entry) => entry.active)
          : []
      };
      if (chain.entries.length) {
        await writeProjectProseChain(project, chain);
      }
    }
    return {
      project,
      imported: imported.map(summarizeFragment),
      importedCount: imported.length
    };
  }

  function summarizeFragment(fragment = {}) {
    return {
      id: normalizeText(fragment.id),
      type: normalizeText(fragment.type),
      name: normalizeText(fragment.name),
      description: normalizeText(fragment.description),
      tags: Array.isArray(fragment.tags) ? fragment.tags.slice(0, 12) : [],
      refs: Array.isArray(fragment.refs) ? fragment.refs.slice(0, 12) : [],
      sticky: fragment.sticky === true,
      placement: normalizeText(fragment.placement) === "system" ? "system" : "user",
      order: Number(fragment.order || 0),
      archived: fragment.archived === true,
      version: Number(fragment.version || 1),
      createdAt: normalizeText(fragment.createdAt),
      updatedAt: normalizeText(fragment.updatedAt),
      preview: compactTaskText(String(fragment.content || "").trim(), 220),
      contentLength: String(fragment.content || "").length
    };
  }

  async function buildProjectFragmentSummary(options = {}) {
    const { project, fragments } = await listProjectFragments({ ...options, includeArchived: false, limit: 500 });
    const typeCounts = {};
    let stickyCount = 0;
    for (const fragment of fragments) {
      typeCounts[fragment.type] = Number(typeCounts[fragment.type] || 0) + 1;
      if (fragment.sticky) {
        stickyCount += 1;
      }
    }
    const chain = await readProjectProseChain(project);
    return {
      root: getProjectFragmentRoot(project),
      types: PROJECT_FRAGMENT_TYPES.map((type) => ({
        type,
        prefix: PROJECT_FRAGMENT_PREFIXES[type] || type.slice(0, 4),
        ...(PROJECT_FRAGMENT_TYPE_DEFINITIONS[type] || {})
      })),
      totalCount: fragments.length,
      stickyCount,
      typeCounts,
      proseSectionCount: chain.entries.length,
      recent: fragments
        .slice()
        .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
        .slice(0, 8)
        .map(summarizeFragment)
    };
  }

  async function buildProjectFragmentContext(options = {}) {
    const { project, fragments } = await listProjectFragments({ ...options, includeArchived: false, limit: 500 });
    const chain = await readProjectProseChain(project);
    const byId = new Map(fragments.map((fragment) => [fragment.id, fragment]));
    const activeProse = chain.entries
      .map((entry) => byId.get(entry.active))
      .filter((fragment) => fragment && fragment.type === "prose");
    const fallbackProse = fragments.filter((fragment) => fragment.type === "prose")
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
    const prose = (activeProse.length ? activeProse : fallbackProse).slice(-clampInteger(options.proseLimit, 12, 0, 80));
    const sticky = fragments.filter((fragment) => fragment.sticky && fragment.type !== "prose")
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
    const shortlist = fragments.filter((fragment) => !fragment.sticky && fragment.type !== "prose")
      .sort((left, right) => String(left.type).localeCompare(String(right.type)) || Number(left.order || 0) - Number(right.order || 0))
      .slice(0, clampInteger(options.shortlistLimit, 40, 0, 200));
    const blocks = [];
    const systemPlaced = sticky.filter((fragment) => fragment.placement === "system");
    const userPlaced = sticky.filter((fragment) => fragment.placement !== "system");
    if (systemPlaced.length) {
      blocks.push({
        id: "project-system-fragments",
        role: "system",
        order: 100,
        content: systemPlaced.map((fragment) => `[@fragment=${fragment.id}]\n${renderProjectFragmentContext(fragment)}`).join("\n\n")
      });
    }
    if (userPlaced.length) {
      blocks.push({
        id: "project-sticky-fragments",
        role: "user",
        order: 100,
        content: userPlaced.map((fragment) => `[@fragment=${fragment.id}]\n${renderProjectFragmentContext(fragment)}`).join("\n\n")
      });
    }
    if (shortlist.length) {
      blocks.push({
        id: "project-fragment-shortlist",
        role: "user",
        order: 200,
        content: [
          "## Available project fragments",
          ...shortlist.map((fragment) => `- ${fragment.id} (${fragment.type}): ${fragment.name}${fragment.description ? ` - ${fragment.description}` : ""}`)
        ].join("\n")
      });
    }
    if (prose.length) {
      blocks.push({
        id: "project-prose",
        role: "user",
        order: 300,
        content: [
          "## Project prose",
          ...prose.map((fragment) => `[@fragment=${fragment.id}]\n${renderProjectFragmentContext(fragment)}`)
        ].join("\n\n")
      });
    }
    const text = blocks
      .sort((left, right) => String(left.role).localeCompare(String(right.role)) || Number(left.order || 0) - Number(right.order || 0))
      .map((block) => `[@block=${block.id} role=${block.role}]\n${block.content}`)
      .join("\n\n");
    return {
      project,
      blocks,
      text,
      summary: await buildProjectFragmentSummary({ projectName: project.name, projectPath: project.path })
    };
  }

  return {
    PROJECT_FRAGMENT_ROOT_DIR,
    PROJECT_FRAGMENT_TYPES: PROJECT_FRAGMENT_TYPES.slice(),
    addProjectProseSection,
    addProjectProseVariation,
    archiveProjectFragment,
    buildProjectFragmentContext,
    buildProjectFragmentSummary,
    createProjectFragment,
    exportProjectFragmentBundle,
    getProjectFragment,
    getProjectFragmentRefs,
    getProjectProseChain,
    importProjectFragmentBundle,
    listProjectFragments,
    listProjectFragmentVersions,
    moveProjectProseSection,
    removeProjectProseSection,
    reorderProjectFragments,
    restoreProjectFragment,
    revertProjectFragmentVersion,
    switchActiveProjectProse,
    updateProjectFragment,
    validateProjectFragments
  };
}
