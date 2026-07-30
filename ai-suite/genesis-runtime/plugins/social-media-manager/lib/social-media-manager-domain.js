import { compactText } from "../../../observer-general-utils.js";

const DEFAULT_PLATFORMS = [
  {
    id: "reddit",
    name: "Reddit",
    url: "https://www.reddit.com/search/?q={query}",
    strengths: ["community discussion", "niche discovery", "question answering"],
    risk: "high",
    fitKeywords: ["developer", "gaming", "ai", "tool", "software", "hobby", "community"]
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    url: "https://www.linkedin.com/search/results/content/?keywords={query}",
    strengths: ["professional credibility", "B2B reach", "founder updates"],
    risk: "medium",
    fitKeywords: ["business", "b2b", "professional", "saas", "consulting", "career", "enterprise"]
  },
  {
    id: "product-hunt",
    name: "Product Hunt",
    url: "https://www.producthunt.com/search?q={query}",
    strengths: ["launch discovery", "maker feedback", "early adopters"],
    risk: "medium",
    fitKeywords: ["startup", "app", "software", "tool", "productivity", "ai", "maker"]
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    url: "https://hn.algolia.com/?q={query}",
    strengths: ["technical buyers", "critical feedback", "engineering audience"],
    risk: "high",
    fitKeywords: ["developer", "engineering", "technical", "open source", "security", "ai"]
  },
  {
    id: "indie-hackers",
    name: "Indie Hackers",
    url: "https://www.indiehackers.com/search?q={query}",
    strengths: ["founder audience", "build-in-public", "growth feedback"],
    risk: "medium",
    fitKeywords: ["startup", "founder", "bootstrapped", "saas", "marketing", "creator"]
  },
  {
    id: "x",
    name: "X",
    url: "https://x.com/search?q={query}&src=typed_query",
    strengths: ["fast experiments", "public threads", "creator networking"],
    risk: "medium",
    fitKeywords: ["creator", "startup", "ai", "design", "news", "marketing", "tool"]
  },
  {
    id: "facebook-groups",
    name: "Facebook Groups",
    url: "https://www.facebook.com/search/groups/?q={query}",
    strengths: ["local groups", "consumer communities", "support threads"],
    risk: "high",
    fitKeywords: ["local", "consumer", "parent", "hobby", "community", "service"]
  },
  {
    id: "tiktok",
    name: "TikTok",
    url: "https://www.tiktok.com/search?q={query}",
    strengths: ["short demos", "consumer discovery", "visual storytelling"],
    risk: "medium",
    fitKeywords: ["visual", "consumer", "fashion", "food", "fitness", "home", "creator"]
  }
];


function slugify(value = "", fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function asArray(value = []) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueStrings(values = [], limit = 24) {
  const seen = new Set();
  const out = [];
  for (const value of asArray(values)) {
    const normalized = compactText(value, 80);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

function parseTimestamp(value = null, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) {
    return Number(fallback || 0);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function normalizeStatus(value = "", allowed = [], fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeProduct(record = {}) {
  const now = Date.now();
  const name = compactText(record.name || record.title || "", 160) || "Untitled product";
  const id = compactText(record.id || `product-${slugify(name)}-${now}`, 120);
  return {
    id,
    name,
    url: compactText(record.url || record.productUrl || "", 300),
    description: compactText(record.description || "", 1200),
    audience: compactText(record.audience || record.targetAudience || "", 600),
    valueProposition: compactText(record.valueProposition || record.value || "", 600),
    keywords: uniqueStrings(record.keywords || record.tags || []),
    constraints: compactText(record.constraints || record.notes || "", 1000),
    status: normalizeStatus(record.status, ["active", "paused", "archived"], "active"),
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now
  };
}

function normalizeOpportunity(record = {}) {
  const now = Date.now();
  const platform = compactText(record.platform || record.platformId || "web", 80).toLowerCase();
  const title = compactText(record.title || record.name || `${platform} opportunity`, 180);
  return {
    id: compactText(record.id || `opp-${slugify(platform)}-${slugify(title)}-${now}`, 140),
    productId: compactText(record.productId || "", 140),
    platform,
    platformName: compactText(record.platformName || record.name || platform, 120),
    title,
    url: compactText(record.url || "", 500),
    audienceFit: compactText(record.audienceFit || record.fit || "", 700),
    postingGuidance: compactText(record.postingGuidance || record.guidance || "", 900),
    angle: compactText(record.angle || "", 400),
    searchQuery: compactText(record.searchQuery || "", 160),
    score: Math.max(0, Math.min(100, Math.round(Number(record.score || 0) || 0))),
    status: normalizeStatus(record.status, ["candidate", "approved", "rejected", "posted"], "candidate"),
    risk: normalizeStatus(record.risk, ["low", "medium", "high"], "medium"),
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now
  };
}

function normalizePost(record = {}) {
  const now = Date.now();
  const body = compactText(record.body || record.text || record.content || "", 4000);
  return {
    id: compactText(record.id || `post-${now}-${Math.random().toString(36).slice(2, 8)}`, 140),
    productId: compactText(record.productId || "", 140),
    opportunityId: compactText(record.opportunityId || "", 140),
    platform: compactText(record.platform || "", 80).toLowerCase(),
    title: compactText(record.title || "", 220),
    body,
    callToAction: compactText(record.callToAction || "", 300),
    url: compactText(record.url || "", 500),
    status: normalizeStatus(record.status, ["draft", "approved", "published", "archived"], "draft"),
    publishedUrl: compactText(record.publishedUrl || "", 500),
    scheduledAt: parseTimestamp(record.scheduledAt, 0),
    publishedAt: parseTimestamp(record.publishedAt, 0),
    metrics: normalizeMetrics(record.metrics || {}),
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now
  };
}

function normalizePublishingTarget(record = {}) {
  const now = Date.now();
  const platform = compactText(record.platform || record.service || "web", 80).toLowerCase();
  const accountId = compactText(record.accountId || record.account || "default", 100).toLowerCase();
  const label = compactText(record.label || record.name || `${platform} ${accountId}`, 160);
  return {
    id: compactText(record.id || `target-${slugify(platform)}-${slugify(accountId)}-${slugify(label)}`, 160),
    platform,
    accountId,
    label,
    composerUrl: compactText(record.composerUrl || record.url || "", 600),
    titleSelector: compactText(record.titleSelector || "", 180),
    bodySelector: compactText(record.bodySelector || record.textSelector || "", 180),
    submitSelector: compactText(record.submitSelector || "", 180),
    publishedUrlSelector: compactText(record.publishedUrlSelector || "", 180),
    monitorTextSelector: compactText(record.monitorTextSelector || "body", 180),
    commentSelector: compactText(record.commentSelector || "", 180),
    commentAuthorSelector: compactText(record.commentAuthorSelector || "", 180),
    commentTextSelector: compactText(record.commentTextSelector || "", 180),
    replySelector: compactText(record.replySelector || "", 180),
    replySubmitSelector: compactText(record.replySubmitSelector || "", 180),
    status: normalizeStatus(record.status, ["active", "paused", "archived"], "active"),
    notes: compactText(record.notes || "", 1000),
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now
  };
}

function normalizeMetrics(record = {}) {
  return {
    views: Math.max(0, Math.round(Number(record.views || 0) || 0)),
    likes: Math.max(0, Math.round(Number(record.likes || 0) || 0)),
    comments: Math.max(0, Math.round(Number(record.comments || 0) || 0)),
    shares: Math.max(0, Math.round(Number(record.shares || 0) || 0)),
    clicks: Math.max(0, Math.round(Number(record.clicks || 0) || 0))
  };
}

function normalizeInteraction(record = {}) {
  const now = Date.now();
  const text = compactText(record.text || record.commentText || record.body || "", 2400);
  return {
    id: compactText(record.id || `interaction-${now}-${Math.random().toString(36).slice(2, 8)}`, 140),
    postId: compactText(record.postId || "", 140),
    productId: compactText(record.productId || "", 140),
    platform: compactText(record.platform || "", 80).toLowerCase(),
    author: compactText(record.author || record.commentAuthor || "", 160),
    text,
    sentiment: normalizeStatus(record.sentiment || inferSentiment(text), ["positive", "neutral", "negative", "question"], "neutral"),
    intent: compactText(record.intent || inferIntent(text), 120),
    replyDraft: compactText(record.replyDraft || "", 2400),
    replyStatus: normalizeStatus(record.replyStatus, ["needs-review", "approved", "replied", "ignored"], "needs-review"),
    externalUrl: compactText(record.externalUrl || record.url || "", 500),
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now
  };
}

function normalizeState(state = {}) {
  return {
    version: 1,
    products: Array.isArray(state.products) ? state.products.map(normalizeProduct) : [],
    publishingTargets: Array.isArray(state.publishingTargets) ? state.publishingTargets.map(normalizePublishingTarget) : [],
    opportunities: Array.isArray(state.opportunities) ? state.opportunities.map(normalizeOpportunity) : [],
    posts: Array.isArray(state.posts) ? state.posts.map(normalizePost) : [],
    interactions: Array.isArray(state.interactions) ? state.interactions.map(normalizeInteraction) : []
  };
}

function inferSentiment(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/[?]/.test(lower) || /\b(how|what|why|when|where|can|does|is it|price|cost)\b/.test(lower)) {
    return "question";
  }
  if (/\b(bad|broken|spam|hate|scam|expensive|confusing|annoying)\b/.test(lower)) {
    return "negative";
  }
  if (/\b(great|love|nice|useful|thanks|awesome|helpful|interested)\b/.test(lower)) {
    return "positive";
  }
  return "neutral";
}

function inferIntent(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/\b(price|cost|pricing|free|paid|trial)\b/.test(lower)) return "pricing";
  if (/\b(how|setup|install|start|use)\b/.test(lower)) return "how-to";
  if (/\b(compare|alternative|versus|vs)\b/.test(lower)) return "comparison";
  if (/\b(bug|broken|issue|error)\b/.test(lower)) return "support";
  if (/\b(spam|self promo|promotion)\b/.test(lower)) return "moderation-risk";
  return "general";
}

function productSearchTerms(product = {}, extraKeywords = []) {
  return uniqueStrings([
    product.name,
    product.audience,
    product.valueProposition,
    ...asArray(product.keywords),
    ...asArray(extraKeywords)
  ].flatMap((entry) => String(entry || "").split(/[^a-zA-Z0-9]+/g)).filter((entry) => entry.length > 2), 10);
}

function scorePlatform(platform = {}, terms = [], product = {}) {
  const haystack = [
    product.name,
    product.description,
    product.audience,
    product.valueProposition,
    ...(product.keywords || [])
  ].join(" ").toLowerCase();
  const matches = (platform.fitKeywords || []).filter((keyword) => haystack.includes(String(keyword || "").toLowerCase()));
  const termBonus = Math.min(16, terms.length * 2);
  return Math.max(30, Math.min(95, 52 + matches.length * 9 + termBonus - (platform.risk === "high" ? 8 : 0)));
}

function platformName(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const found = DEFAULT_PLATFORMS.find((entry) => entry.id === normalized || entry.name.toLowerCase() === normalized);
  return found?.name || normalized || "social";
}

function firstSentence(value = "", fallback = "") {
  const normalized = compactText(value, 500);
  if (!normalized) return fallback;
  const match = normalized.match(/^(.+?[.!?])(?:\s|$)/);
  return compactText(match ? match[1] : normalized, 180);
}

function buildPostBody({ product = {}, opportunity = {}, tone = "helpful", variant = 0, platform = "" } = {}) {
  const name = product.name || "this";
  const audience = product.audience || "people working on this problem";
  const value = product.valueProposition || firstSentence(product.description, "make the job easier");
  const angle = opportunity.angle || `A practical note for ${audience}`;
  const url = product.url ? `\n\n${product.url}` : "";
  const p = String(platform || opportunity.platform || "").trim().toLowerCase();
  const proof = product.description
    ? `\n\nThe problem it is trying to solve: ${compactText(product.description, 260)}`
    : "";
  const constraints = product.constraints ? `\n\nContext: ${compactText(product.constraints, 220)}` : "";
  const variantsByPlatform = {
    reddit: [
      `I am looking for blunt feedback from people who actually deal with this.\n\n${name} is for ${audience}. It helps with: ${value}.${proof}${constraints}\n\nI do not want to do drive-by promo, so the useful question is: what would make this worth trying, and what would make you ignore it?${url}`,
      `Question for people here: how are you currently handling ${value}?\n\nI built ${name} for ${audience}, and I am trying to sanity-check whether the angle is actually useful for this community.${proof}\n\nHappy to share details, but mostly looking for what feels missing or overbuilt.${url}`,
      `${angle}\n\nI am building ${name}. The concrete use case is ${value}.${proof}\n\nIf this is relevant to your workflow, what would you need to see before trusting it?${url}`
    ],
    linkedin: [
      `${name} is built for ${audience}.\n\nThe practical problem: ${value}.${proof}\n\nI am looking for operators, founders, and teams who have run into this workflow and can pressure-test the positioning. The most useful feedback would be where this saves time, where it creates friction, and what proof would make it credible.${url}`,
      `A small product update:\n\n${name} helps ${audience} with ${value}.${proof}\n\nThe next step is not hype; it is better feedback from people close to the problem. If this maps to something your team deals with, I would value a sharp critique.${url}`,
      `Working on ${name}, focused on ${audience}.\n\nThe core promise is simple: ${value}.${proof}\n\nI am especially interested in what a professional buyer or daily user would need to know before taking it seriously.${url}`
    ],
    x: [
      `${name} is for ${audience}.\n\nIt helps with ${value}.\n\nLooking for sharp feedback from people who have this problem: what would make this immediately useful, and what would make you bounce?${url}`,
      `Building ${name}.\n\nAudience: ${audience}\nProblem: ${value}\n\nTrying to make the pitch clearer and the product more useful. What would you test first?${url}`,
      `If you deal with ${value}, I would like your read on ${name}.\n\nUseful? Too vague? Missing the real pain?\n\n${compactText(product.description, 180)}${url}`
    ],
    "hacker-news": [
      `I built ${name} for ${audience}. The aim is to help with ${value}.${proof}\n\nThe technical/product question I am trying to answer: is this solving a real workflow problem, or just packaging something people would rather script themselves?\n\nCritical feedback welcome.${url}`,
      `${name}: ${value}\n\nIt is aimed at ${audience}.${proof}\n\nI am interested in the failure modes: where would this be too brittle, too opaque, or not worth adopting?${url}`,
      `Show HN-style draft: ${name}\n\nIt helps ${audience} with ${value}.${proof}\n\nI would appreciate feedback on whether the problem framing is real and what technical detail should be shown up front.${url}`
    ],
    "product-hunt": [
      `${name} helps ${audience} ${value}.\n\nWhat it does:\n- ${compactText(value, 140)}\n- Built for ${compactText(audience, 140)}\n- Designed around practical workflow feedback${proof}\n\nI would love feedback on onboarding, positioning, and the first feature you would try.${url}`,
      `Launching an early version of ${name}.\n\nIt is for ${audience}, focused on ${value}.${proof}\n\nIf you try it, the question I care about most is: did it get you to value quickly enough?${url}`,
      `${name} is a practical tool for ${audience}.\n\nThe promise: ${value}.\n\nFeedback wanted on clarity, usefulness, and what should be added before a wider launch.${url}`
    ]
  };
  const generic = [
    `${angle}\n\n${name} is for ${audience}. It helps with ${value}.${proof}${constraints}\n\nI am looking for useful feedback from people close to the problem. What would make this worth trying?${url}`,
    `${name} is built around one problem: ${value}.\n\nAudience: ${audience}.${proof}\n\nI would rather get specific criticism than vague encouragement. What is unclear, unconvincing, or missing?${url}`,
    `Sharing ${name} because it may help ${audience}.\n\nThe useful bit: ${value}.${proof}\n\nIf this overlaps with your work, I would value a practical read on whether the promise is strong enough.${url}`
  ];
  const variants = variantsByPlatform[p] || variantsByPlatform[platformName(p).toLowerCase()] || generic;
  const picked = variants[Math.abs(Number(variant || 0)) % variants.length];
  if (String(tone || "").toLowerCase().includes("concise")) {
    return compactText(picked, 520);
  }
  return picked;
}

function buildReplyDraft({ product = {}, interaction = {} } = {}) {
  const text = String(interaction.text || "");
  const name = product.name || "it";
  const value = product.valueProposition || product.description || "the core workflow";
  if (interaction.intent === "pricing") {
    return `Thanks for asking. Pricing depends on the setup, but the best next step is to check the product page or tell me what you need it for and I can point you at the right option.`;
  }
  if (interaction.intent === "support") {
    return `Thanks for flagging that. Could you share what happened and where you hit the issue? I would like to understand it properly before guessing.`;
  }
  if (interaction.sentiment === "negative" || interaction.intent === "moderation-risk") {
    return `Fair point, and I do not want this to feel like drive-by promotion. The relevant reason I shared ${name} here is that it helps with ${value}. Happy to remove or clarify if this is not a fit for the thread.`;
  }
  if (interaction.sentiment === "question" || text.includes("?")) {
    return `Good question. ${name} is meant to help with ${value}. The shortest way to test whether it fits is to try it against one real workflow and see where it saves time.`;
  }
  return `Thanks, I appreciate you taking a look. The part I am most interested in improving is whether ${name} actually helps with ${value} in a real workflow.`;
}

function summarizeCampaign(state = {}) {
  const products = state.products.length;
  const publishingTargets = state.publishingTargets.length;
  const opportunities = state.opportunities.length;
  const posts = state.posts.length;
  const published = state.posts.filter((post) => post.status === "published").length;
  const interactions = state.interactions.length;
  const needsReview = state.interactions.filter((entry) => entry.replyStatus === "needs-review").length;
  const totals = state.posts.reduce((acc, post) => {
    const metrics = normalizeMetrics(post.metrics || {});
    for (const key of Object.keys(metrics)) {
      acc[key] = Number(acc[key] || 0) + Number(metrics[key] || 0);
    }
    return acc;
  }, { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 });
  return { products, publishingTargets, opportunities, posts, published, interactions, needsReview, metrics: totals };
}

export function createSocialMediaManagerDomain({
  dataApi = null,
  broadcast = () => {}
} = {}) {
  const dataKey = "social-media-manager-state";

  async function readState() {
    const saved = dataApi ? await dataApi.readJson(dataKey, {}) : {};
    return normalizeState(saved);
  }

  async function writeState(state = {}) {
    const normalized = normalizeState(state);
    if (dataApi) {
      await dataApi.writeJson(dataKey, normalized);
    }
    return normalized;
  }

  async function listState() {
    const state = await readState();
    return {
      ...state,
      summary: summarizeCampaign(state)
    };
  }

  async function saveProduct(input = {}) {
    const state = await readState();
    const now = Date.now();
    const explicitId = compactText(input.id || "", 140);
    const product = normalizeProduct({ ...input, id: explicitId || input.id, updatedAt: now });
    const index = state.products.findIndex((entry) => entry.id === product.id);
    if (index >= 0) {
      state.products[index] = normalizeProduct({ ...state.products[index], ...input, id: product.id, updatedAt: now });
    } else {
      state.products.push(product);
    }
    await writeState(state);
    const saved = index >= 0 ? state.products[index] : product;
    broadcast({ type: index >= 0 ? "social.product.updated" : "social.product.created", product: saved });
    return saved;
  }

  async function savePublishingTarget(input = {}) {
    const state = await readState();
    const now = Date.now();
    const target = normalizePublishingTarget({ ...input, updatedAt: now });
    const index = state.publishingTargets.findIndex((entry) => entry.id === target.id);
    if (index >= 0) {
      state.publishingTargets[index] = normalizePublishingTarget({ ...state.publishingTargets[index], ...input, id: target.id, updatedAt: now });
    } else {
      state.publishingTargets.push(target);
    }
    await writeState(state);
    const saved = index >= 0 ? state.publishingTargets[index] : target;
    broadcast({ type: index >= 0 ? "social.target.updated" : "social.target.created", publishingTarget: saved });
    return saved;
  }

  async function findPublishingTarget(reference = {}) {
    const state = await readState();
    const targetId = String(reference.targetId || reference.id || "").trim();
    const platform = String(reference.platform || reference.service || "").trim().toLowerCase();
    const accountId = String(reference.accountId || "").trim().toLowerCase();
    return state.publishingTargets.find((target) => {
      if (targetId && target.id === targetId) return true;
      if (platform && accountId) return target.platform === platform && target.accountId === accountId;
      if (platform) return target.platform === platform && target.status === "active";
      return false;
    }) || null;
  }

  async function findProduct(reference = "") {
    const state = await readState();
    const normalized = String(reference || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return state.products.find((product) =>
      product.id.toLowerCase() === normalized
      || product.name.toLowerCase() === normalized
      || product.name.toLowerCase().includes(normalized)
    ) || null;
  }

  async function discoverOpportunities(input = {}) {
    const state = await readState();
    let product = null;
    const productRef = String(input.productId || input.product || input.name || "").trim();
    if (productRef) {
      product = state.products.find((entry) =>
        entry.id === productRef
        || entry.name.toLowerCase() === productRef.toLowerCase()
        || entry.name.toLowerCase().includes(productRef.toLowerCase())
      ) || null;
    }
    if (!product) {
      product = normalizeProduct(input.product || input);
      if (input.saveProduct !== false) {
        const existingIndex = state.products.findIndex((entry) => entry.id === product.id);
        if (existingIndex >= 0) state.products[existingIndex] = product;
        else state.products.push(product);
      }
    }
    const terms = productSearchTerms(product, input.keywords || []);
    const query = encodeURIComponent(terms.slice(0, 4).join(" ") || product.name);
    const requestedPlatforms = uniqueStrings(input.platforms || [], 20).map((entry) => entry.toLowerCase());
    const platforms = DEFAULT_PLATFORMS.filter((platform) =>
      !requestedPlatforms.length
      || requestedPlatforms.includes(platform.id)
      || requestedPlatforms.includes(platform.name.toLowerCase())
    );
    const candidateUrls = uniqueStrings(input.candidateUrls || input.urls || [], 20);
    const generated = [];
    for (const platform of platforms) {
      const score = scorePlatform(platform, terms, product);
      generated.push(normalizeOpportunity({
        id: `opp-${product.id}-${platform.id}`,
        productId: product.id,
        platform: platform.id,
        platformName: platform.name,
        title: `${platform.name}: ${terms.slice(0, 3).join(" ") || product.name}`,
        url: platform.url.replace("{query}", query),
        searchQuery: decodeURIComponent(query),
        score,
        risk: platform.risk,
        audienceFit: `${platform.name} is useful for ${platform.strengths.join(", ")}.`,
        postingGuidance: platform.risk === "high"
          ? "Read rules first, answer existing questions before posting, and avoid posting the same copy in multiple communities."
          : "Use a helpful post with a clear disclosure, ask for feedback, and tailor the example to the audience.",
        angle: `Show how ${product.name} helps ${product.audience || "the target audience"} with ${product.valueProposition || product.description || "a specific workflow"}.`
      }));
    }
    for (const url of candidateUrls) {
      generated.push(normalizeOpportunity({
        id: `opp-${product.id}-candidate-${slugify(url)}`,
        productId: product.id,
        platform: "web",
        platformName: "Web candidate",
        title: `Candidate community: ${url}`,
        url,
        searchQuery: product.name,
        score: 58,
        risk: "medium",
        audienceFit: "User supplied candidate that should be reviewed for rules, audience match, and recent activity.",
        postingGuidance: "Inspect recent posts and rules before publishing. Prefer a helpful answer or case study over a direct ad.",
        angle: `Use a concrete example from ${product.name}.`
      }));
    }
    for (const opportunity of generated) {
      const index = state.opportunities.findIndex((entry) => entry.id === opportunity.id);
      if (index >= 0) {
        state.opportunities[index] = { ...state.opportunities[index], ...opportunity, updatedAt: Date.now() };
      } else {
        state.opportunities.push(opportunity);
      }
    }
    await writeState(state);
    broadcast({ type: "social.opportunities.discovered", product, opportunities: generated });
    return { product, opportunities: generated.sort((left, right) => right.score - left.score) };
  }

  async function composePosts(input = {}) {
    const state = await readState();
    const product = state.products.find((entry) =>
      entry.id === String(input.productId || input.product || "").trim()
      || entry.name.toLowerCase().includes(String(input.product || "").trim().toLowerCase())
    );
    if (!product) {
      throw new Error("product is required before composing posts");
    }
    const opportunity = state.opportunities.find((entry) =>
      entry.id === String(input.opportunityId || "").trim()
    ) || state.opportunities.find((entry) => entry.productId === product.id);
    const count = Math.max(1, Math.min(5, Number(input.count || 3) || 3));
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const post = normalizePost({
        productId: product.id,
        opportunityId: opportunity?.id || "",
        platform: input.platform || opportunity?.platform || "",
        title: compactText(input.title || `${product.name} post for ${opportunity?.platformName || "social"}`, 220),
        body: buildPostBody({ product, opportunity, tone: input.tone, variant: index, platform: input.platform || opportunity?.platform || "" }),
        callToAction: input.callToAction || "Ask for feedback from people who have the problem.",
        status: "draft"
      });
      state.posts.push(post);
      created.push(post);
    }
    await writeState(state);
    broadcast({ type: "social.posts.composed", posts: created });
    return created;
  }

  async function recordMonitorSnapshot(input = {}) {
    const state = await readState();
    const postId = String(input.postId || "").trim();
    const post = state.posts.find((entry) => entry.id === postId) || null;
    if (!post) {
      throw new Error("post not found");
    }
    const seen = new Set(state.interactions.map((entry) => `${entry.postId}:${entry.author}:${entry.text}`.toLowerCase()));
    const recorded = [];
    for (const comment of Array.isArray(input.comments) ? input.comments : []) {
      const normalized = normalizeInteraction({
        ...comment,
        postId: post.id,
        productId: post.productId,
        platform: post.platform,
        externalUrl: comment.externalUrl || post.publishedUrl
      });
      const key = `${normalized.postId}:${normalized.author}:${normalized.text}`.toLowerCase();
      if (!normalized.text || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const product = state.products.find((entry) => entry.id === post.productId) || null;
      if (!normalized.replyDraft) {
        normalized.replyDraft = buildReplyDraft({ product, interaction: normalized });
      }
      state.interactions.push(normalized);
      recorded.push(normalized);
    }
    if (input.metrics && typeof input.metrics === "object") {
      const index = state.posts.findIndex((entry) => entry.id === post.id);
      state.posts[index] = normalizePost({
        ...post,
        metrics: {
          ...(post.metrics || {}),
          ...input.metrics
        },
        updatedAt: Date.now()
      });
    }
    await writeState(state);
    broadcast({ type: "social.post.monitored", postId: post.id, recordedCount: recorded.length });
    return { postId: post.id, recorded, recordedCount: recorded.length };
  }

  async function updatePost(postId = "", patch = {}) {
    const state = await readState();
    const id = String(postId || patch.id || "").trim();
    const index = state.posts.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error("post not found");
    }
    state.posts[index] = normalizePost({ ...state.posts[index], ...patch, id, updatedAt: Date.now() });
    await writeState(state);
    broadcast({ type: "social.post.updated", post: state.posts[index] });
    return state.posts[index];
  }

  async function recordInteraction(input = {}) {
    const state = await readState();
    const post = state.posts.find((entry) => entry.id === String(input.postId || "").trim()) || null;
    const product = state.products.find((entry) => entry.id === (input.productId || post?.productId)) || null;
    const interaction = normalizeInteraction({
      ...input,
      productId: input.productId || post?.productId || "",
      platform: input.platform || post?.platform || ""
    });
    if (!interaction.replyDraft) {
      interaction.replyDraft = buildReplyDraft({ product, interaction });
    }
    const index = state.interactions.findIndex((entry) => entry.id === interaction.id);
    if (index >= 0) {
      state.interactions[index] = interaction;
    } else {
      state.interactions.push(interaction);
    }
    await writeState(state);
    broadcast({ type: "social.interaction.recorded", interaction });
    return interaction;
  }

  async function updateInteraction(interactionId = "", patch = {}) {
    const state = await readState();
    const id = String(interactionId || patch.id || "").trim();
    const index = state.interactions.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error("interaction not found");
    }
    state.interactions[index] = normalizeInteraction({ ...state.interactions[index], ...patch, id, updatedAt: Date.now() });
    await writeState(state);
    broadcast({ type: "social.interaction.updated", interaction: state.interactions[index] });
    return state.interactions[index];
  }

  async function buildReport(input = {}) {
    const state = await readState();
    const productRef = String(input.productId || input.product || "").trim().toLowerCase();
    const products = productRef
      ? state.products.filter((product) => product.id.toLowerCase() === productRef || product.name.toLowerCase().includes(productRef))
      : state.products;
    const productIds = new Set(products.map((product) => product.id));
    const opportunities = state.opportunities.filter((entry) => !productIds.size || productIds.has(entry.productId));
    const posts = state.posts.filter((entry) => !productIds.size || productIds.has(entry.productId));
    const interactions = state.interactions.filter((entry) => !productIds.size || productIds.has(entry.productId));
    const summary = summarizeCampaign({ ...state, products, opportunities, posts, interactions });
    const topOpportunities = opportunities.slice().sort((left, right) => right.score - left.score).slice(0, 8);
    const pendingReplies = interactions.filter((entry) => entry.replyStatus === "needs-review").slice(0, 8);
    const lines = [
      `Social media manager report`,
      `Products: ${summary.products}; publishing targets: ${summary.publishingTargets}; opportunities: ${summary.opportunities}; posts: ${summary.posts}; published: ${summary.published}.`,
      `Interactions: ${summary.interactions}; replies needing review: ${summary.needsReview}.`,
      `Metrics: ${summary.metrics.views} views, ${summary.metrics.likes} likes, ${summary.metrics.comments} comments, ${summary.metrics.shares} shares, ${summary.metrics.clicks} clicks.`
    ];
    if (topOpportunities.length) {
      lines.push("Top opportunities:");
      for (const opportunity of topOpportunities) {
        lines.push(`- ${opportunity.platformName}: ${opportunity.title} (${opportunity.score}/100)`);
      }
    }
    if (pendingReplies.length) {
      lines.push("Replies needing review:");
      for (const interaction of pendingReplies) {
        lines.push(`- ${interaction.author || "Unknown"}: ${compactText(interaction.text, 90)}`);
      }
    }
    return { text: lines.join("\n"), summary, products, opportunities, posts, interactions };
  }

  return {
    buildReport,
    composePosts,
    discoverOpportunities,
    findPublishingTarget,
    findProduct,
    listState,
    recordMonitorSnapshot,
    readState,
    recordInteraction,
    savePublishingTarget,
    saveProduct,
    updateInteraction,
    updatePost,
    writeState
  };
}
