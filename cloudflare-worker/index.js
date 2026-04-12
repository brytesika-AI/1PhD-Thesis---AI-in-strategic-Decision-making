// ─── RAG & LEARNING UTILITIES ──────────────────────────────────────────────

async function queryPhDRag(query, env) {
  try {
    const embedding = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [query] });
    const vector = embedding.data[0];
    const results = await env.VECTORIZE.query(vector, { topK: 3 });
    
    if (!results.matches || results.matches.length === 0) return "";
    
    let context = "\n## PhD PROPOSAL KNOWLEDGE BASE — CITE THIS\nSource: (AI-SRF Proposal, Sikazwe, 2026)\n" + "─".repeat(40) + "\n";
    for (const match of results.matches) {
      const text = await env.PHD_CHUNKS.get(match.id);
      if (text) context += `[Research Passage]: ${text}\n\n`;
    }
    return context + "─".repeat(40) + "\n";
  } catch (err) { return ""; }
}

async function getImprovementRules(agentName, env) {
  try {
    const raw = await env.LEARNING_MEMORY.get("aisrf:improvement_rules");
    if (!raw) return "";
    const rules = JSON.parse(raw);
    const relevant = rules.filter(r => r.targetAgents === "ALL" || r.targetAgents.includes(agentName));
    if (relevant.length === 0) return "";
    return "\n## SELF-IMPROVEMENT RULES (FROM PRIOR SESSIONS)\n" + relevant.map((r, i) => `Rule ${i+1}: ${r.improvementRule}`).join("\n") + "\n";
  } catch (err) { return ""; }
}

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      const url = new URL(request.url);

      // ── API: Anonymous Executive Rating ──
      if (url.pathname === '/api/rating' && request.method === 'POST') {
        const { sector, jobTitle, stars, feedback } = await request.json();
        const key = `rating:${Date.now()}:${crypto.randomUUID()}`;
        if (env.RATINGS) {
          await env.RATINGS.put(key, JSON.stringify({ sector, jobTitle, stars, feedback, ts: Date.now() }));
        }
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      }

      // ── API: Continuous Learning (Override Capture) ──
      if (url.pathname === '/api/learning/override' && request.method === 'POST') {
        const { stage, agent, originalVerdict, executiveReason } = await request.json();
        const key = `override:${Date.now()}:${crypto.randomUUID()}`;
        if (env.LEARNING_MEMORY) {
          await env.LEARNING_MEMORY.put(key, JSON.stringify({ stage, agent, originalVerdict, executiveReason, ts: Date.now() }));
        }
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      }

      // ── STATUS PAGE ──
      if (url.pathname === '/' && request.method === 'GET') {
        const ror = "Live Return on Resilience Active";
        const statusHtml = `
        <html>
          <body style="background:#0D1117;color:#D4A017;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;border:1px solid #D4A017;padding:40px;border-radius:2px;">
              <h1 style="letter-spacing:2px;margin-bottom:10px;">AI-SRF PROXY — V3.0</h1>
              <p style="color:#8B8E94;text-transform:uppercase;font-size:0.8rem;letter-spacing:1px;">Executive Strategic Resilience Framework</p>
              <div style="height:1px;background:#D4A017;width:50px;margin:20px auto;"></div>
              <p style="color:#D4A017;font-weight:bold;">${ror}</p>
              <p style="color:#8B8E94;font-size:0.7rem;">(Sikazwe, 2026) | Algorithmic Sovereignty Engine</p>
            </div>
          </body>
        </html>`;
        return new Response(statusHtml, { headers: { 'Content-Type': 'text/html' } });
      }

      // ── INFERENCE PROXY ──
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

      const { system, messages, stream = true } = await request.json();

      const WRITING_STANDARD = `
EXECUTIVE REGISTER: Every sentence must carry a decision, finding, or number.
SENTENCE ECONOMY: Max 20 words for findings. Active voice only.
NUMBERS ANCHOR EVERY CLAIM: R-values and percentages required.
NO PLACEHOLDERS / NO FILLER: (Sikazwe, 2026) protocol.`;

      const sanitise = (text = '') =>
        text
          .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
          .replace(/\b(\+27|0)[0-9]{9}\b/g, '[phone redacted]')
          .replace(/\b[0-9]{13}\b/g, '[ID redacted]');

      const agentMatch = system.match(/You are ([\w\s]+) —/);
      const agentName = agentMatch ? agentMatch[1] : "The Guard";

      // ── RAG & LEARNING INJECTION ──
      const userText = messages && messages.length > 0 ? messages[messages.length-1].content : "";
      const ragContext = await queryPhDRag(userText.slice(0, 500) || "AI-SRF Strategy", env);
      const improvementRules = await getImprovementRules(agentName, env);

      const PHD_RESEARCH_CORE = `
AI-SRF PHD RESEARCH CORE:
1. MISSION: Achieve 'Algorithmic Sovereignty' vs 'Environmental Hostility'.
2. CONTEXT: 89% digital failure rate due to architectural mismatch.
3. MECHANISM: 'Strategic Pivoting' - dynamic realignment to institutional values (King IV, POPIA).
4. STEWARDSHIP: Moving boards from fiduciary passivity to grounded AI stewardship. (Sikazwe, 2026)`;

      const cleanSystem = WRITING_STANDARD + "\n\n" + sanitise(system || '') + "\n\n" + PHD_RESEARCH_CORE + "\n" + ragContext + "\n" + improvementRules + "\n\nGOVERNANCE: Cite (AI-SRF Proposal, Sikazwe, 2026) for all construct activations.";
      const cleanMessages = (messages || []).map(m => ({ ...m, content: sanitise(m.content) }));

      const model = env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

      if (stream) {
        const aiStream = await env.AI.run(model, {
          messages: [{ role: 'system', content: cleanSystem }, ...cleanMessages],
          stream: true,
          max_tokens: 2800
        });
        return new Response(aiStream, { headers: { ...cors, 'Content-Type': 'text/event-stream' } });
      } else {
        const result = await env.AI.run(model, {
          messages: [{ role: 'system', content: cleanSystem }, ...cleanMessages],
          max_tokens: 2800
        });
        return new Response(JSON.stringify(result), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
};
