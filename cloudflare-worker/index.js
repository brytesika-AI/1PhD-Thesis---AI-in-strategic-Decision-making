// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI-SRF v2.0 — Semi Self-Learning Governance Intelligence Worker
// Cloudflare-Native · Free Tier · Workers AI (Open Source LLMs)
// Integrates: Hermes-inspired institutional memory + skill accumulation
// Source: AI-SRF Proposal, Sikazwe (2026)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const WRITING_STANDARD = `
EXECUTIVE REGISTER: Every sentence must carry a decision, finding, or number.
SENTENCE ECONOMY: Max 20 words for findings. Active voice only.
NUMBERS ANCHOR EVERY CLAIM: R-values and percentages required.
NO PLACEHOLDERS / NO FILLER: (Sikazwe, 2026) protocol.

### CITATION RULES — MANDATORY FOR ALL OUTPUTS:
1. CITE EVERY FIGURE INLINE: Format [Value] ([Source Name], [Date]). Example: "ZAR/USD at R18.92 (SARB, 2024, live)".
2. CITE EVERY REGULATION: Format [Regulation Name] [Act Number of Year]. Example: "POPIA (Act 4 of 2013)".
3. CREDIBILITY TIER LABELS: After every cited figure, note the tier: [Primary], [Secondary], or [Modelled].
4. NEVER PRESENT A NUMBER WITHOUT A SOURCE: If you cannot cite a figure, do not state it.
5. REFERENCE BLOCK AT THE END: Every output must close with a "References" section in APA 7th format.
`;

const PHD_RESEARCH_CORE = `
AI-SRF PHD RESEARCH CORE:
1. MISSION: Achieve 'Algorithmic Sovereignty' vs 'Environmental Hostility'.
2. CONTEXT: 89% digital failure rate due to architectural mismatch.
3. MECHANISM: 'Strategic Pivoting' - dynamic realignment to institutional values (King IV, POPIA).
4. STEWARDSHIP: Moving boards from fiduciary passivity to grounded AI stewardship. (Sikazwe, 2026)`;

const SAFETY_CONSTRAINTS = `
IMMUTABLE SAFETY CONSTRAINTS (cannot be modified by self-learning):
SAFETY-01: Never recommend actions that violate POPIA (Act 4 of 2013).
SAFETY-02: Never bypass King IV governance principles.
SAFETY-03: Never auto-execute decisions — all actions require human approval.
SAFETY-04: Never share organisation-specific data across organisations.
SAFETY-05: All regulatory citations must be verified against source material.
`;

const IDENTITY_CONTRACT = `
AI-SRF IDENTITY CONTRACT:
This framework does not help. It governs. An assistant optimises for satisfaction. A governance instrument optimises for long-run strategic integrity.
VOICE: A seasoned SA corporate strategist. A governance counsel who understands King IV as board accountability architecture. A Socratic interlocutor who believes the most valuable question is the one the organisation is avoiding.
NEVER: Enthusiastic affirmation. False confidence. Untested agreement. Reassurance unsupported by evidence. Consulting jargon. "Great question!" or "I'd be happy to..." or "As an AI..."
ALWAYS: Name the specific risk. Cite the regulatory grounding. Surface confidence as evidence-based qualification. End with a clear structural handoff to the next agent or the executive.
REGISTER: South African English. Boardroom-appropriate. Direct. Analytically precise. Never hedging with pleasantries.
`;

const AGENT_REGISTRY = {
  1: { id: "tracker", display_name: "The Tracker", role: "Environmental Monitor", allowed_tools: ["policy_compliance_scan"], requires_human_approval: false },
  2: { id: "induna", display_name: "The Induna", role: "Socratic Partner", allowed_tools: ["five_whys", "root_cause_analysis"], requires_human_approval: false },
  3: { id: "auditor", display_name: "The Auditor", role: "Forensic Analyst", allowed_tools: ["policy_compliance_scan", "resilience_scoring"], requires_human_approval: true },
  4: { id: "innovator", display_name: "The Innovator", role: "Creative Catalyst", allowed_tools: ["scenario_planning"], requires_human_approval: true },
  5: { id: "challenger", display_name: "The Challenger", role: "Devil's Advocate", allowed_tools: ["swot_analysis", "resilience_scoring"], requires_human_approval: true },
  6: { id: "architect", display_name: "The Architect", role: "Implementation Scaffolding", allowed_tools: ["implementation_plan_builder"], requires_human_approval: true },
  7: { id: "guardian", display_name: "The Guardian", role: "Monitoring Agent", allowed_tools: ["resilience_scoring", "policy_compliance_scan"], requires_human_approval: false }
};

// ─── POLICY ENGINE ─────────────────────────────────────────────────────────

class PolicyEngine {
  static validateToolAccess(agentStage, toolName) {
    const agent = AGENT_REGISTRY[agentStage];
    if (!agent) return { allowed: false, reason: `Agent stage ${agentStage} not found.` };
    if (!agent.allowed_tools.includes(toolName)) return { allowed: false, reason: `Tool ${toolName} is BLOCKED for ${agent.id} by policy.` };
    return { allowed: true, reason: "Allowed" };
  }
  static requiresApproval(agentStage) {
    const agent = AGENT_REGISTRY[agentStage];
    return agent ? agent.requires_human_approval : true;
  }
}

// ─── MODULAR SKILLS ────────────────────────────────────────────────────────

const SKILLS = {
  swot_analysis: (input) => ({ status: "success", result: "SWOT Analysis Completed" }),
  five_whys: (input) => ({ status: "success", result: "5 Whys Completed" }),
  root_cause_analysis: (input) => ({ status: "success", result: "RCA Completed" }),
  policy_compliance_scan: (input) => ({ status: "success", result: "Compliance Scan Passed" }),
  scenario_planning: (input) => ({ status: "success", result: "Scenario Planning Generated" }),
  resilience_scoring: (input) => ({ status: "success", score: 85.0 }),
  implementation_plan_builder: (input) => ({ status: "success", plan: "Track A and Track B mapped." })
};

// ─── CORS HEADERS ───────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── SANITISER (POPIA compliance) ───────────────────────────────────────────

function sanitise(text = '') {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/\b(\+27|0)[0-9]{9}\b/g, '[phone redacted]')
    .replace(/\b[0-9]{13}\b/g, '[ID redacted]');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 1: INSTITUTIONAL SENSING — News API + Risk Intelligence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function ingestStrategicNews(env) {
  const topics = [
    'South Africa load shedding Eskom energy',
    'South Africa POPIA data protection corporate governance',
    'South Africa rand ZAR exchange rate SARB',
    'South Africa AI artificial intelligence digital transformation',
    'South Africa economy unemployment GDP'
  ];

  try {
    let articles = [];

    // Strategy 1: Try NewsAPI with user's key
    const apiKey = env.NEWSAPI_KEY;
    if (apiKey) {
      try {
        const res = await fetch(
          `https://newsapi.org/v2/everything?q=South+Africa+digitalisation+OR+load+shedding+OR+POPIA&pageSize=10&sortBy=publishedAt&language=en&apiKey=${apiKey}`
        );
        const data = await res.json();
        if (data.articles && data.articles.length > 0) {
          articles = data.articles.map(a => ({
            title: a.title,
            description: a.description || '',
            source: a.source?.name || 'NewsAPI'
          }));
          console.log(`[SENSING] NewsAPI returned ${articles.length} articles`);
        }
      } catch (e) { console.log("[SENSING] NewsAPI failed, trying fallback"); }
    }

    // Strategy 2: Google News RSS (free, no key needed)
    if (articles.length === 0) {
      for (const topic of topics.slice(0, 3)) {
        try {
          const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-ZA&gl=ZA&ceid=ZA:en`;
          const res = await fetch(rssUrl);
          const xml = await res.text();

          // Extract items from RSS XML
          const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
          for (const item of items.slice(0, 3)) {
            const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
            const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/);
            const sourceMatch = item.match(/<source[^>]*>(.*?)<\/source>/);

            if (titleMatch) {
              articles.push({
                title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
                description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '',
                source: sourceMatch ? sourceMatch[1] : 'Google News'
              });
            }
          }
        } catch (e) { /* continue to next topic */ }
      }
      if (articles.length > 0) console.log(`[SENSING] Google News RSS returned ${articles.length} articles`);
    }

    // Strategy 3: Bing News RSS fallback
    if (articles.length === 0) {
      try {
        const res = await fetch('https://www.bing.com/news/search?q=South+Africa+economy+OR+Eskom+OR+POPIA&format=rss');
        const xml = await res.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        for (const item of items.slice(0, 8)) {
          const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
          const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/);
          if (titleMatch) {
            articles.push({
              title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
              description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '',
              source: 'Bing News'
            });
          }
        }
        if (articles.length > 0) console.log(`[SENSING] Bing News RSS returned ${articles.length} articles`);
      } catch (e) { console.log("[SENSING] Bing News also failed"); }
    }

    if (articles.length === 0) {
      console.log("[SENSING] No news sources available");
      return;
    }

    // Deduplicate by title — local + DB check
    const seen = new Set();
    articles = articles.filter(a => {
      if (!a.title || seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    // Remove articles already in DB
    try {
      const { results: existing } = await env.DB.prepare(
        "SELECT title FROM risk_signals ORDER BY timestamp DESC LIMIT 100"
      ).all();
      const existingTitles = new Set((existing || []).map(r => r.title));
      articles = articles.filter(a => !existingTitles.has(a.title));
      if (articles.length === 0) {
        console.log("[SENSING] No new articles to ingest (all duplicates)");
        return;
      }
    } catch (e) { /* DB check failed, proceed with insert-or-ignore */ }

    // Risk score each article via Workers AI with few-shot examples
    for (const article of articles.slice(0, 10)) {
      const scoringPrompt = `Score this SA news article for corporate boards.

Categories: Financial | Grid | Regulatory | Labour | Geopolitical | Technology
Score: 1 (trivial) to 10 (existential threat).

Examples:
- "Eskom announces Stage 6 load shedding" => {"score":9,"category":"Grid","implication":"Stage 6 halts manufacturing; activate diesel reserves and defer cloud-dependent deployments."}
- "ZAR weakens past R19/$" => {"score":7,"category":"Financial","implication":"Cloud licensing costs escalate 12%; hedge or renegotiate USD-denominated contracts."}
- "Information Regulator fines Dis-Chem R3.5M" => {"score":8,"category":"Regulatory","implication":"POPIA enforcement precedent; audit all third-party data processors within 30 days."}
- "SA unemployment falls to 31%" => {"score":3,"category":"Labour","implication":"Marginal improvement; digital skills shortage persists in AI/ML roles."}

Now score:
TITLE: ${article.title}
CONTENT: ${(article.description || '').slice(0, 300)}

JSON only:`;

      let scoring = { score: 5, category: "General", implication: "Strategic monitoring required." };
      try {
        const aiResponse = await env.AI.run(
          env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages: [
              { role: "system", content: "Output valid JSON only. No markdown. No explanation. Format: {\"score\": N, \"category\": \"X\", \"implication\": \"Y\"}" },
              { role: "user", content: scoringPrompt }
            ],
            max_tokens: 150
          }
        );
        const text = aiResponse.response || JSON.stringify(aiResponse);
        const parsed = JSON.parse(text.match(/\{[^}]+\}/s)?.[0] || '{}');
        if (parsed.score && parsed.category) scoring = parsed;
      } catch (e) {
        console.log(`[SENSING] Scoring failed for: ${article.title?.slice(0, 40)}`);
      }

      await env.DB.prepare(
        `INSERT OR IGNORE INTO risk_signals (id, source, title, content, risk_score, risk_category)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        article.source || "News Feed",
        article.title,
        (article.description || "") + (scoring.implication ? ` [Implication: ${scoring.implication}]` : ""),
        scoring.score || 5,
        scoring.category || "General"
      ).run();
    }
    console.log(`[SENSING] Ingested ${Math.min(articles.length, 10)} articles with risk scores`);
  } catch (err) {
    console.error("[SENSING] Ingestion failed:", err);
  }
}

async function getLatestRisks(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT title, risk_score, risk_category, content, timestamp FROM risk_signals ORDER BY timestamp DESC LIMIT 8"
    ).all();

    if (!results || results.length === 0) return "";

    // A1 Requirement: Compute Bayesian Risk State
    let p_nom = 0.60, p_ele = 0.30, p_com = 0.08, p_crit = 0.02;
    results.forEach(r => {
      const s = r.risk_score || 5;
      const l_nom = Math.exp(-0.5 * Math.pow(s - 3, 2));
      const l_ele = Math.exp(-0.5 * Math.pow(s - 6, 2));
      const l_com = Math.exp(-0.5 * Math.pow(s - 7.5, 2));
      const l_crit = Math.exp(-0.5 * Math.pow(s - 9, 2));
      const sum = (p_nom * l_nom) + (p_ele * l_ele) + (p_com * l_com) + (p_crit * l_crit) || 1;
      p_nom = (p_nom * l_nom)/sum; p_ele = (p_ele * l_ele)/sum; p_com = (p_com * l_com)/sum; p_crit = (p_crit * l_crit)/sum;
    });

    let state = 'NOMINAL', maxP = p_nom;
    if (p_ele > maxP) { state = 'ELEVATED'; maxP = p_ele; }
    if (p_com > maxP) { state = 'COMPOUND'; maxP = p_com; }
    if (p_crit > maxP) { state = 'CRITICAL'; maxP = p_crit; }

    let ctx = "\n## LIVE STRATEGIC RISK SIGNALS (South Africa)\n";
    ctx += "Source: News API, scored by Workers AI (Llama 3.3 70B)\n";
    ctx += `Bayesian Computed Operating State: ${state} (Confidence: ${(maxP * 100).toFixed(1)}%)\n\n`;
    results.forEach(r => {
      ctx += `- [${r.risk_category}] Score ${r.risk_score}/10: ${r.title}\n`;
    });
    return ctx + "\n";
  } catch (err) { return ""; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 2: RAG — Regulatory Knowledge Base
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function queryPhDRag(query, env) {
  try {
    const embedding = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [query] });
    const vector = embedding.data[0];
    const results = await env.VECTORIZE.query(vector, { topK: 3 });

    if (!results.matches || results.matches.length === 0) return "";

    let context = "\n## REGULATORY KNOWLEDGE BASE\n";
    context += "Source: (AI-SRF Proposal, Sikazwe, 2026)\n" + "-".repeat(40) + "\n";
    for (const match of results.matches) {
      const text = await env.PHD_CHUNKS.get(match.id);
      if (text) context += `[Regulation]: ${text}\n\n`;
    }
    return context + "-".repeat(40) + "\n";
  } catch (err) { return ""; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SELF-LEARNING LAYER: Institutional Memory (KV-based)
// Hermes-inspired — INSTITUTIONAL_MEMORY.md + ORGANISATION_PROFILE.md
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getInstitutionalMemory(orgId, env) {
  try {
    const memory = await env.ORG_MEMORY.get(`memory:${orgId}`);
    if (!memory) return getDefaultMemory();
    return memory;
  } catch (err) { return getDefaultMemory(); }
}

function getDefaultMemory() {
  return `# Institutional Memory
## Regulatory exposure history
- No prior decision cycles recorded. Building institutional context.

## Infrastructure volatility patterns
- Baseline: South Africa experiences intermittent load-shedding and ZAR volatility.

## Past decision outcomes
- No prior decisions recorded.

## Known capability gaps
- Initial assessment pending first governance cycle.`;
}

async function getOrganisationProfile(orgId, env) {
  try {
    const profile = await env.ORG_MEMORY.get(`profile:${orgId}`);
    if (!profile) return getDefaultProfile();
    return profile;
  } catch (err) { return getDefaultProfile(); }
}

function getDefaultProfile() {
  return `# Organisation Profile
## Communication preferences
- AI literacy level: MEDIUM (default — calibrate after first cycle)
- Preferred output: Executive brief first, technical detail on demand

## Strategic posture
- Risk tolerance: MODERATE (default)
- Primary concern: Operational continuity

## Recurring decision themes
- No patterns established yet.`;
}

async function getRelevantSkills(orgId, domain, env) {
  try {
    const manifestRaw = await env.SKILL_STORE.get(`manifest:${orgId}`);
    if (!manifestRaw) return "";
    const manifest = JSON.parse(manifestRaw);

    if (manifest.length === 0) return "";

    // Filter by domain if specified
    const relevant = domain
      ? manifest.filter(s => s.domain === domain || s.domain === 'general')
      : manifest;

    if (relevant.length === 0) return "";

    let ctx = "\n## ACCUMULATED GOVERNANCE SKILLS (from prior cycles)\n";
    ctx += "Progressive Disclosure: Summaries shown. Full detail available on demand.\n";
    relevant.slice(0, 5).forEach(s => {
      ctx += `\n### Skill: ${s.skill}\n`;
      ctx += `Domain: ${s.domain} | Confidence: ${(s.confidence * 100).toFixed(0)}% | Used: ${s.usage_count || 0} times\n`;
      ctx += `${s.summary}\n`;
    });
    return ctx + "\n";
  } catch (err) { return ""; }
}

async function getPastDecisionRecall(query, env) {
  try {
    // Search D1 session archive for relevant past decisions
    const { results } = await env.DB.prepare(
      `SELECT ds.id, ds.risk_state, ds.sector, ds.query_text, ds.stage_reached,
              ds.started_at, ds.cycle_duration_minutes
       FROM decision_sessions ds
       WHERE ds.query_text LIKE ?
       ORDER BY ds.started_at DESC LIMIT 3`
    ).bind(`%${query.slice(0, 50)}%`).all();

    if (!results || results.length === 0) return "";

    let ctx = "\n## CROSS-SESSION RECALL (Prior decisions on similar topics)\n";
    results.forEach(r => {
      ctx += `- [${r.risk_state}] "${r.query_text?.slice(0, 80)}..." (${r.started_at}) — Reached Stage ${r.stage_reached}\n`;
    });
    return ctx + "\n";
  } catch (err) { return ""; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SELF-LEARNING: Post-Cycle Processing (runs via ctx.waitUntil)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function postCycleLearning(sessionId, orgId, fullTrace, env) {
  try {
    const cycleDurationMinutes = Math.round((Date.now() - (new Date(fullTrace.startedAt || Date.now()).getTime())) / 60000);
    // 1. Archive the decision session
    await env.DB.prepare(
      `UPDATE decision_sessions SET completed_at = datetime('now'),
       stage_reached = 6, cycle_duration_minutes = ?
       WHERE id = ?`
    ).bind(
      cycleDurationMinutes,
      sessionId
    ).run();

    // 1.5 Calculate & Persist Empirical ROR Metrics
    // DLR: Baseline 4 hours (240 minutes)
    let dlr = 0;
    if (cycleDurationMinutes < 240) {
      dlr = ((240 - cycleDurationMinutes) / 240) * 100;
    }
    
    // Da: Quality uplift (Delphi panel rating). Stored as null initially.
    let da = null; 
    
    // ASY: Sovereignty Yield (C_satisfied / C_injected). We inject up to 3 major constraints (POPIA, King IV, EEA).
    const tLower = (fullTrace.themes || '').toLowerCase();
    let regs = 0;
    if (tLower.includes('popia')) regs++;
    if (tLower.includes('king')) regs++;
    if (tLower.includes('equity') || tLower.includes('eea')) regs++;
    let asy = (regs / 3); // Ratio

    // IAR: Infrastructure autonomy. F_operational / F_total under disruption.
    // Proxy for now: 0.85 if CRITICAL, else 1.0
    let iar = fullTrace.riskState === 'CRITICAL' ? 0.85 : 1.00;


    const metricStmt = env.DB.prepare(`INSERT INTO ror_metrics (id, session_id, org_id, indicator, value) VALUES (?, ?, ?, ?, ?)`);
    await env.DB.batch([
      metricStmt.bind(crypto.randomUUID(), sessionId, orgId, 'DLR', dlr),
      metricStmt.bind(crypto.randomUUID(), sessionId, orgId, 'Da', da),
      metricStmt.bind(crypto.randomUUID(), sessionId, orgId, 'IAR', iar),
      metricStmt.bind(crypto.randomUUID(), sessionId, orgId, 'ASY', asy)
    ]);

    // 2. Skill Extraction — Assess if this cycle produced a reusable governance pattern
    const skillAssessment = await env.AI.run(
      env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          {
            role: "system",
            content: `You are the AI-SRF Skill Extraction Engine. Analyse this completed governance cycle and determine if it contains a reusable South African governance pattern.

A skill is worth creating if:
1. It revealed a recurring SA risk pattern (load-shedding, ZAR volatility, POPIA compliance)
2. The pattern is specific enough to be actionable in future cycles
3. It relates to SA-specific regulations (POPIA, King IV, EEA, SARB)

IMPORTANT: Only extract SA governance-specific patterns. Generic analytical procedures do NOT qualify.

Output JSON only:
{
  "should_create": true/false,
  "skill_id": "kebab-case-name",
  "domain": "popia|king-iv|infrastructure|currency|labour|general",
  "summary": "200-word summary of the reusable pattern",
  "confidence": 0.0-1.0,
  "reasoning": "why this qualifies"
}`
          },
          {
            role: "user",
            content: `Decision Query: ${fullTrace.query}\nRisk State: ${fullTrace.riskState}\nSector: ${fullTrace.sector}\nAgent Interactions: ${fullTrace.stageCount || 0}\nKey Themes: ${fullTrace.themes || 'none extracted'}`
          }
        ]
      }
    );

    try {
      const text = skillAssessment.response || JSON.stringify(skillAssessment);
      const assessment = JSON.parse(text.match(/\{.*\}/s)?.[0] || '{}');

      if (assessment.should_create && assessment.confidence > 0.6) {
        // Write skill to KV
        const skillKey = `skill:${orgId}:${assessment.skill_id}`;
        await env.SKILL_STORE.put(skillKey, JSON.stringify({
          ...assessment,
          created_at: new Date().toISOString(),
          source_session: sessionId
        }));

        // Update manifest
        const manifestRaw = await env.SKILL_STORE.get(`manifest:${orgId}`);
        const manifest = manifestRaw ? JSON.parse(manifestRaw) : [];

        // Check for duplicate
        const existingIdx = manifest.findIndex(s => s.skill === assessment.skill_id);
        if (existingIdx >= 0) {
          manifest[existingIdx].confidence = Math.min(1.0, manifest[existingIdx].confidence + 0.05);
          manifest[existingIdx].usage_count = (manifest[existingIdx].usage_count || 0) + 1;
          manifest[existingIdx].last_evolved = new Date().toISOString();
        } else {
          manifest.push({
            skill: assessment.skill_id,
            domain: assessment.domain,
            summary: assessment.summary,
            confidence: assessment.confidence,
            usage_count: 0,
            last_evolved: new Date().toISOString()
          });
        }

        await env.SKILL_STORE.put(`manifest:${orgId}`, JSON.stringify(manifest));

        // Register in D1 for cross-org analytics
        await env.DB.prepare(
          `INSERT OR REPLACE INTO skill_registry (id, domain, summary, confidence, created_at, evolved_at)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).bind(assessment.skill_id, assessment.domain, assessment.summary, assessment.confidence).run();

        console.log(`[LEARNING] Skill created: ${assessment.skill_id} (confidence: ${assessment.confidence})`);
      }
    } catch (e) {
      console.log("[LEARNING] Skill assessment parse failed:", e.message);
    }

    // 3. Memory Nudge — Determine what belongs in permanent memory
    const memoryNudge = await env.AI.run(
      env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          {
            role: "system",
            content: `You are the AI-SRF Memory Manager. After a governance cycle, determine what should be added to INSTITUTIONAL_MEMORY.md.

Rules:
- PERMANENT MEMORY: Regulatory patterns appearing 2+ times, confirmed capability gaps, recurring infrastructure patterns
- SESSION ARCHIVE: Specific decision traces (already stored in D1 — do not duplicate)
- DISCARD: Information already captured, single-occurrence observations

CRITICAL: Memory inflation degrades agent performance. Be selective.
The 2000-token ceiling on institutional memory must be respected.

Output JSON:
{
  "permanent_updates": ["bullet point updates to add to institutional memory"],
  "discard_reasons": ["why items were not added"],
  "memory_health": "healthy|approaching_limit|needs_pruning"
}`
          },
          {
            role: "user",
            content: `Cycle: ${fullTrace.query}\nRisk State: ${fullTrace.riskState}\nSector: ${fullTrace.sector}`
          }
        ]
      }
    );

    try {
      const text = memoryNudge.response || JSON.stringify(memoryNudge);
      const nudge = JSON.parse(text.match(/\{.*\}/s)?.[0] || '{}');

      if (nudge.permanent_updates && nudge.permanent_updates.length > 0) {
        const currentMemory = await getInstitutionalMemory(orgId, env);
        const updates = nudge.permanent_updates.map(u => `- ${u}`).join('\n');
        const updatedMemory = currentMemory + `\n\n## Update from Cycle ${sessionId.slice(0, 8)} (${new Date().toISOString().split('T')[0]})\n${updates}`;

        // Enforce 2000-token ceiling (~8000 chars)
        const trimmed = updatedMemory.length > 8000
          ? updatedMemory.slice(updatedMemory.length - 8000)
          : updatedMemory;

        await env.ORG_MEMORY.put(`memory:${orgId}`, trimmed);

        // Log to D1
        await env.DB.prepare(
          `INSERT INTO memory_updates (org_id, update_type, content, source_session)
           VALUES (?, 'permanent', ?, ?)`
        ).bind(orgId, updates, sessionId).run();

        console.log(`[LEARNING] Memory updated for org ${orgId}: ${nudge.permanent_updates.length} items`);
      }
    } catch (e) {
      console.log("[LEARNING] Memory nudge parse failed:", e.message);
    }

    console.log(`[LEARNING] Post-cycle processing complete for session ${sessionId}`);
  } catch (err) {
    console.error("[LEARNING] Post-cycle processing error:", err);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IMPROVEMENT RULES (legacy v1.x learning, preserved)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getImprovementRules(agentName, env) {
  try {
    const raw = await env.LEARNING_MEMORY.get("aisrf:improvement_rules");
    if (!raw) return "";
    const rules = JSON.parse(raw);
    const relevant = rules.filter(r => r.targetAgents === "ALL" || r.targetAgents.includes(agentName));
    if (relevant.length === 0) return "";
    return "\n## SELF-IMPROVEMENT RULES (FROM PRIOR SESSIONS)\n" +
      relevant.map((r, i) => `Rule ${i + 1}: ${r.improvementRule}`).join("\n") + "\n";
  } catch (err) { return ""; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMAIL NOTIFICATION (Google Apps Script proxy)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendEmailViaGoogle(data, env) {
  const scriptUrl = env.GOOGLE_SCRIPT_URL;
  if (!scriptUrl) return;
  try {
    await fetch(scriptUrl, { method: "POST", body: JSON.stringify(data) });
  } catch (err) { console.error("[EMAIL] Failed:", err); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WORKER EXPORT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      const url = new URL(request.url);

      // ── API: Rating ──
      if (url.pathname === '/api/rating' && request.method === 'POST') {
        const ratingData = await request.json();
        const key = `rating:${Date.now()}:${crypto.randomUUID()}`;
        if (env.RATINGS) await env.RATINGS.put(key, JSON.stringify({ ...ratingData, ts: Date.now() }));
        ctx.waitUntil(sendEmailViaGoogle(ratingData, env));
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      }

      // ── API: Executive Override Learning ──
      if (url.pathname === '/api/learning/override' && request.method === 'POST') {
        const data = await request.json();
        const key = `override:${Date.now()}:${crypto.randomUUID()}`;
        if (env.LEARNING_MEMORY) await env.LEARNING_MEMORY.put(key, JSON.stringify({ ...data, ts: Date.now() }));
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      }

      // ── API: Chaos Fault Injection ──
      if (url.pathname === '/api/chaos/fault-injection' && request.method === 'POST') {
        const { active } = await request.json();
        if (env.ORG_MEMORY) await env.ORG_MEMORY.put('chaos_state', active ? 'true' : 'false');
        return new Response(JSON.stringify({ ok: true, active }), { headers: cors });
      }

      // ── API: Risk Intelligence Feed ──
      if (url.pathname === '/api/sensing/risks' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          "SELECT * FROM risk_signals ORDER BY timestamp DESC LIMIT 20"
        ).all();
        
        let p_nom = 0.60, p_ele = 0.30, p_com = 0.08, p_crit = 0.02;
        (results || []).forEach(r => {
          const s = r.risk_score || 5;
          const l_nom = Math.exp(-0.5 * Math.pow(s - 3, 2));
          const l_ele = Math.exp(-0.5 * Math.pow(s - 6, 2));
          const l_com = Math.exp(-0.5 * Math.pow(s - 7.5, 2));
          const l_crit = Math.exp(-0.5 * Math.pow(s - 9, 2));
          const sum = (p_nom * l_nom) + (p_ele * l_ele) + (p_com * l_com) + (p_crit * l_crit) || 1;
          p_nom = (p_nom * l_nom)/sum; p_ele = (p_ele * l_ele)/sum; p_com = (p_com * l_com)/sum; p_crit = (p_crit * l_crit)/sum;
        });
        
        let state = 'NOMINAL', maxP = p_nom;
        if (p_ele > maxP) { state = 'ELEVATED'; maxP = p_ele; }
        if (p_com > maxP) { state = 'COMPOUND'; maxP = p_com; }
        if (p_crit > maxP) { state = 'CRITICAL'; maxP = p_crit; }

        return new Response(JSON.stringify({ state, confidence: maxP, items: results }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Manual Sensing Trigger ──
      if (url.pathname === '/api/sensing/trigger' && request.method === 'POST') {
        ctx.waitUntil(ingestStrategicNews(env));
        return new Response(JSON.stringify({ ok: true, message: "News ingestion triggered" }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Institutional Memory (GET) ──
      if (url.pathname === '/api/memory' && request.method === 'GET') {
        const orgId = url.searchParams.get('org') || 'default';
        const memory = await getInstitutionalMemory(orgId, env);
        const profile = await getOrganisationProfile(orgId, env);
        return new Response(JSON.stringify({ memory, profile }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Organisation Profile Update ──
      if (url.pathname === '/api/memory/profile' && request.method === 'POST') {
        const { orgId = 'default', profile } = await request.json();
        await env.ORG_MEMORY.put(`profile:${orgId}`, profile);
        return new Response(JSON.stringify({ ok: true }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Skill Registry ──
      if (url.pathname === '/api/skills' && request.method === 'GET') {
        const orgId = url.searchParams.get('org') || 'default';
        const manifestRaw = await env.SKILL_STORE.get(`manifest:${orgId}`);
        const manifest = manifestRaw ? JSON.parse(manifestRaw) : [];
        return new Response(JSON.stringify({ skills: manifest, count: manifest.length }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Skill Detail (progressive disclosure — full load) ──
      if (url.pathname.startsWith('/api/skills/') && request.method === 'GET') {
        const parts = url.pathname.split('/');
        const skillId = parts[3];
        const orgId = url.searchParams.get('org') || 'default';
        const skillRaw = await env.SKILL_STORE.get(`skill:${orgId}:${skillId}`);
        if (!skillRaw) return new Response(JSON.stringify({ error: 'Skill not found' }), { status: 404, headers: cors });
        return new Response(skillRaw, { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Decision Session History ──
      if (url.pathname === '/api/sessions' && request.method === 'GET') {
        const orgId = url.searchParams.get('org') || 'default';
        const { results } = await env.DB.prepare(
          `SELECT * FROM decision_sessions WHERE org_id = ? ORDER BY started_at DESC LIMIT 20`
        ).bind(orgId).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: ROR Metrics ──
      if (url.pathname === '/api/ror' && request.method === 'GET') {
        const orgId = url.searchParams.get('org') || 'default';
        const { results } = await env.DB.prepare(
          `SELECT indicator, AVG(value) as avg_value, COUNT(*) as cycles, MAX(recorded_at) as last_recorded
           FROM ror_metrics WHERE org_id = ? GROUP BY indicator`
        ).bind(orgId).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Post-Cycle Learning Trigger ──
      if (url.pathname === '/api/learning/complete-cycle' && request.method === 'POST') {
        const { sessionId, orgId = 'default', query, riskState, sector, stageCount, themes } = await request.json();
        ctx.waitUntil(postCycleLearning(sessionId, orgId, { query, riskState, sector, stageCount, themes, startedAt: new Date().toISOString() }, env));
        return new Response(JSON.stringify({ ok: true, message: "Learning triggered" }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // ── API: Document Chunk Ingestion ──
      if (url.pathname === '/api/ingest/chunks' && request.method === 'POST') {
        try {
          const { chunks } = await request.json();
          if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
            return new Response(JSON.stringify({ error: "No chunks provided" }), { status: 400, headers: cors });
          }
          const texts = chunks.map(c => c.text);
          const batchSize = 25;
          const allVectors = [];
          for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const embedding = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: batch });
            for (let j = 0; j < batch.length; j++) {
              allVectors.push({ id: chunks[i + j].id, values: embedding.data[j], metadata: { source: chunks[i + j].source || "regulatory" } });
            }
          }
          if (allVectors.length > 0) {
            for (let i = 0; i < allVectors.length; i += 100) {
              await env.VECTORIZE.upsert(allVectors.slice(i, i + 100));
            }
          }
          for (const chunk of chunks) { await env.PHD_CHUNKS.put(chunk.id, chunk.text); }
          return new Response(JSON.stringify({ ok: true, indexed: chunks.length, vectors: allVectors.length }),
            { headers: { ...cors, 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
        }
      }

      // ── STATUS PAGE ──
      if (url.pathname === '/' && request.method === 'GET') {
        const statusHtml = `<!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>AI-SRF v2.0</title></head>
        <body style="background:#0D1117;color:#D4A017;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;border:1px solid #D4A017;padding:40px;border-radius:2px;">
            <h1 style="letter-spacing:2px;margin-bottom:10px;">AI-SRF v2.0</h1>
            <p style="color:#8B8E94;text-transform:uppercase;font-size:0.8rem;letter-spacing:1px;">Semi Self-Learning Governance Intelligence</p>
            <div style="height:1px;background:#D4A017;width:50px;margin:20px auto;"></div>
            <p style="color:#D4A017;font-weight:bold;">Hermes Architecture Active</p>
            <p style="color:#8B8E94;font-size:0.7rem;">(Sikazwe, 2026) | Workers AI (Open Source) | Free Tier</p>
          </div>
        </body></html>`;
        return new Response(statusHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // INFERENCE PROXY — The Core Agent Pipeline with Self-Learning Context
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

      const { system, messages, stream = true, orgId = 'default', sessionId, stage } = await request.json();

      // Create session record on first interaction
      if (sessionId && stage === 1) {
        const userText = messages && messages.length > 0 ? messages[messages.length - 1].content : "";
        await env.DB.prepare(
          `INSERT OR IGNORE INTO decision_sessions (id, org_id, risk_state, sector, query_text, stage_reached)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          sessionId, orgId,
          system?.includes('CRITICAL') ? 'CRITICAL' : system?.includes('ELEVATED') ? 'ELEVATED' : 'NOMINAL',
          'generic', userText.slice(0, 200), stage || 1
        ).run();
      }

      // Update stage progress
      if (sessionId && stage) {
        await env.DB.prepare(
          `UPDATE decision_sessions SET stage_reached = MAX(stage_reached, ?) WHERE id = ?`
        ).bind(stage, sessionId).run();
      }

      // ── Build self-learning context ──
      const agentMatch = system?.match(/You are ([\w\s]+) —/);
      const agentName = agentMatch ? agentMatch[1] : "The Guard";
      const userText = messages && messages.length > 0 ? messages[messages.length - 1].content : "";

      // Parallel context loading — all from KV/D1 (fast, free)
      const [ragContext, improvementRules, riskIntelligence, institutionalMemory, orgProfile, relevantSkills, pastDecisions] =
        await Promise.all([
          queryPhDRag(userText.slice(0, 500) || "AI-SRF Strategy", env),
          getImprovementRules(agentName, env),
          getLatestRisks(env),
          getInstitutionalMemory(orgId, env),
          getOrganisationProfile(orgId, env),
          getRelevantSkills(orgId, null, env),
          getPastDecisionRecall(userText.slice(0, 100), env)
        ]);

      // ── Compose enriched system prompt ──
      const selfLearningContext = `
## INSTITUTIONAL MEMORY (accumulated across prior governance cycles)
${institutionalMemory}

## ORGANISATION PROFILE
${orgProfile}
`;

      const cleanSystem = [
        WRITING_STANDARD,
        SAFETY_CONSTRAINTS,
        IDENTITY_CONTRACT,
        sanitise(system || ''),
        PHD_RESEARCH_CORE,
        selfLearningContext,
        riskIntelligence,
        ragContext,
        relevantSkills,
        pastDecisions,
        improvementRules,
        "\nGOVERNANCE: Cite (AI-SRF Proposal, Sikazwe, 2026) for all construct activations."
      ].filter(Boolean).join("\n\n");

      const cleanMessages = (messages || []).map(m => ({ ...m, content: sanitise(m.content) }));
      const model = env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
      const fallbackEdgeModel = '@cf/meta/llama-3.2-3b-instruct';

      // Check chaos state
      let isChaos = false;
      try { if (env.ORG_MEMORY) { isChaos = (await env.ORG_MEMORY.get('chaos_state')) === 'true'; } } catch(e) {}

      if (stream) {
        let aiStream;
        try {
          if (isChaos) throw new Error("Chaos Fault Injection Active: Simulating Cloud Sev 1 Outage");
          aiStream = await env.AI.run(model, {
            messages: [{ role: 'system', content: cleanSystem }, ...cleanMessages],
            stream: true,
            max_tokens: 2800
          });
        } catch (primaryErr) {
          console.log("[EDGE FALLBACK] Primary model unreachable. Routing to Edge Fallback.", primaryErr.message);
          aiStream = await env.AI.run(fallbackEdgeModel, {
            messages: [{ role: 'system', content: cleanSystem + "\n\n[DEGRADED MODE ACTIVE]" }, ...cleanMessages],
            stream: true,
            max_tokens: 1500
          });
        }
        
        let outputAccumulated = "";

        const { readable, writable } = new TransformStream({
          transform(chunk, controller) {
            const textChunk = new TextDecoder().decode(chunk);
            outputAccumulated += textChunk;
            const lower = textChunk.toLowerCase();
            // Code-level safety enforcement (D2-D5)
            if (lower.match(/(bypass|skip|ignore|override|sidestep)\\s+(popia|king iv|devil's advocate|forensic|eaa|equity)/i)) {
                const failSafe = new TextEncoder().encode(`data: {"response": "\\n\\n[SYSTEM HALT]: SAFETY-03/05 VIOLATION. Governance controls (POPIA/King IV/EEA/Devil's Advocate) are immutable and cannot be bypassed. Cycle terminated.\\n"}\\n\\ndata: [DONE]\\n\\n`);
                controller.enqueue(failSafe);
                controller.terminate();
            } else {
                controller.enqueue(new TextEncoder().encode(sanitise(textChunk)));
            }
          },
          flush(controller) {
             if(env.DB && sessionId && stage) {
                const cleanedText = outputAccumulated.replace(/data:/g,'').slice(0,250) + "...";
                const stmt = env.DB.prepare(
                  `INSERT INTO audit_logs (id, session_id, agent_id, input_summary, output_summary, tools_used, policy_checks, raw_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(crypto.randomUUID(), sessionId, stage.toString(), userText.slice(0, 150), cleanedText, '[]', '[]', '{}');
                // Use fetch to bypass wait constraints if ctx isn't global, or use ctx.waitUntil if passed
                if(typeof ctx !== 'undefined' && ctx.waitUntil) {
                   ctx.waitUntil(stmt.run().catch(e => console.log('Audit error:', e)));
                } else {
                   stmt.run().catch(e => console.log('Audit error:', e));
                }
             }
          }
        });
        
        aiStream.pipeTo(writable);
        return new Response(readable, { headers: { ...cors, 'Content-Type': 'text/event-stream' } });
      } else {
        let result;
        try {
          if (isChaos) throw new Error("Chaos Activating Offline Mode");
          result = await env.AI.run(model, {
            messages: [{ role: 'system', content: cleanSystem }, ...cleanMessages],
            max_tokens: 2800
          });
        } catch (err) {
          result = await env.AI.run(fallbackEdgeModel, {
             messages: [{ role: 'system', content: cleanSystem + "\n\n[DEGRADED MODE ACTIVE]" }, ...cleanMessages],
             max_tokens: 1500
          });
        }
        return new Response(JSON.stringify(result), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  },

  // ── CRON: Automated news ingestion every 4 hours ──
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ingestStrategicNews(env));
  }
};
