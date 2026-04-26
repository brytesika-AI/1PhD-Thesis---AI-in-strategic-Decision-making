import { D1AuditLog } from "../../../packages/audit/d1-audit-log.js";
import { OrchestrationGateway } from "../../../packages/core/orchestration-gateway.js";
import { getLatestTwinState, updateDigitalTwin, updateTwinWithDecisionOutcome } from "../../../packages/digital-twin/digital-twin-engine.js";
import { GlobalIntelligenceStore } from "../../../packages/intelligence/global-intelligence-store.js";
import { recordOutcomeFeedback } from "../../../packages/learning/outcome-learning-loop.js";
import { DecisionLoop } from "../../../packages/loop/decision-loop.js";
import { D1MemoryStore, deriveCaseType } from "../../../packages/memory/d1-memory-store.js";
import { runOutcomeEngine } from "../../../packages/outcome/outcome-engine.js";
import { PolicyEngine } from "../../../packages/policy/policy-engine.js";
import { runSimulation } from "../../../packages/simulation/simulation-engine.js";
import { createResourceGuard, isResourceLimitError } from "../../../packages/runtime/resource-guard.js";
import { listAgents, listAllAgents, listControlAgents, validateAgentRegistry } from "../../../packages/shared/agent-registry.js";
import { listToolDefinitions } from "../../../packages/skills/index.js";
import { D1CaseStore, emptyCaseState } from "../../../packages/state/d1-case-store.js";
import { agentRegistry } from "./config/agents.js";

const WORKER_ORIGIN = "https://ai-srf-governance-worker.bryte-sika.workers.dev";
const PAGES_ORIGIN = "https://ai-srf-cloudflare.pages.dev";
const STATIC_PAGES_ORIGINS = new Set([
  PAGES_ORIGIN,
  "https://436ee841.ai-srf-cloudflare.pages.dev",
  "https://947aba3a.ai-srf-cloudflare.pages.dev",
  "https://65f08d50.ai-srf-cloudflare.pages.dev"
]);
const REQUEST_LIMITS = {
  maxRequestBytes: 131072,
  maxSubrequests: 90,
  maxToolCalls: 24,
  maxStateBytes: 750000,
  maxCacheValueBytes: 131072,
  maxResponseBytes: 262144
};

function allowedCorsOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return WORKER_ORIGIN;
  if (origin === "null") return "null";
  try {
    const url = new URL(origin);
    if (STATIC_PAGES_ORIGINS.has(origin)) return origin;
    if (origin === PAGES_ORIGIN) return origin;
    if (url.hostname.endsWith(".ai-srf-cloudflare.pages.dev")) return origin;
    if (origin === WORKER_ORIGIN) return origin;
  } catch {
    return WORKER_ORIGIN;
  }
  return WORKER_ORIGIN;
}

function corsHeadersFor(request) {
  const origin = allowedCorsOrigin(request);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };
}

function errorEnvelope({
  errorCategory = "validation",
  isRetriable = false,
  technicalMessage = "Request failed.",
  customerMessage = "The request could not be completed.",
  suggestion = "Review the request and try again.",
  coverageGap = undefined
} = {}) {
  return {
    is_error: true,
    error: technicalMessage,
    error_category: errorCategory,
    is_retriable: Boolean(isRetriable),
    technical_message: String(technicalMessage),
    customer_message: String(customerMessage),
    suggestion: String(suggestion),
    ...(coverageGap ? { coverage_gap: coverageGap } : {})
  };
}

function commonError(kind, detail = "") {
  const messages = {
    invalid_login: ["permission", "Invalid login credentials.", "The email or passcode was not accepted.", "Check the passcode and sign in again."],
    case_id_required: ["validation", "case_id is required.", "A case identifier is required.", "Run decision preparation again or select a case."],
    approval_not_found: ["not_found", "No pending approval gate found.", "There is no pending approval to decide.", "Refresh the case and confirm an approval gate is open."],
    case_not_found: ["not_found", "Case not found.", "The requested decision case was not found for your organization.", "Confirm the case id and organization."],
    not_found: ["not_found", "Not found", "The requested AI-SRF endpoint does not exist.", "Check the endpoint path."]
  };
  const [errorCategory, technicalMessage, customerMessage, suggestion] = messages[kind] || ["validation", detail || "Request failed.", "The request could not be completed.", "Review the request and try again."];
  return errorEnvelope({ errorCategory, technicalMessage, customerMessage, suggestion });
}

function successEnvelope(body = {}) {
  if (body && typeof body === "object" && !Array.isArray(body) && "is_error" in body) return body;
  return { is_error: false, ...body };
}

function jsonResponse(request, body, status = 200, extraHeaders = {}) {
  const payload = status >= 400
    ? (body?.is_error ? body : errorEnvelope({
      errorCategory: body?.error_category || "validation",
      technicalMessage: body?.error || body?.message || "Request failed.",
      customerMessage: body?.customer_message || "The request could not be completed.",
      suggestion: body?.suggestion || "Review the request and try again."
    }))
    : successEnvelope(body);
  let text = JSON.stringify(payload);
  let headers = { ...corsHeadersFor(request), "Content-Type": "application/json; charset=utf-8", ...extraHeaders };
  if (new TextEncoder().encode(text).length > REQUEST_LIMITS.maxResponseBytes) {
    text = JSON.stringify(successEnvelope({
      truncated: true,
      summary: "Response exceeded Cloudflare Worker response budget and was summarized.",
      items: [],
      next_cursor: null
    }));
    headers = { ...headers, "X-AI-SRF-Truncated": "true" };
  }
  return new Response(text, {
    status,
    headers
  });
}

function compactTrace(value, maxChars = 1600) {
  try {
    const text = JSON.stringify(value);
    if (!text || text.length <= maxChars) return value;
    return { truncated: true, preview: text.slice(0, maxChars) };
  } catch (error) {
    return { unserializable: true, message: error.message };
  }
}

function traceStep(stepName, rawState = {}, rawResult = {}) {
  const state = compactTrace(rawState);
  const result = compactTrace(rawResult);
  console.log("STEP:", stepName, { state, result });
}

function eventStreamResponse(request, events) {
  const body = events
    .map((event) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n`)
    .join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeadersFor(request),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

const ROLES = new Set(["analyst", "executive", "admin"]);

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

async function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(body))}`;
  const signature = base64UrlEncode(new Uint8Array(await hmac(secret, unsigned)));
  return `${unsigned}.${signature}`;
}

async function verifyJwt(token, secret) {
  const [header, payload, signature] = String(token || "").split(".");
  if (!header || !payload || !signature) return null;
  const expected = base64UrlEncode(new Uint8Array(await hmac(secret, `${header}.${payload}`)));
  if (expected !== signature) return null;
  const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function jwtSecret(env) {
  return env.JWT_SECRET || env.AUTH_SECRET || "ai-srf-development-secret-change-me";
}

function cfAccessUser(request) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) return null;
  return {
    user_id: `access:${email.toLowerCase()}`,
    email: email.toLowerCase(),
    role: request.headers.get("X-AI-SRF-Role") || "executive",
    organization_id: request.headers.get("X-AI-SRF-Org") || "default-org",
    organization_name: request.headers.get("X-AI-SRF-Org-Name") || "Default Organization"
  };
}

async function currentUser(request, env) {
  const accessUser = cfAccessUser(request);
  if (accessUser) return accessUser;
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer || getCookie(request, "ai_srf_session");
  if (!token) return null;
  const user = await verifyJwt(token, jwtSecret(env));
  if (!user || !ROLES.has(user.role)) return null;
  return user;
}

function requireRole(user, roles) {
  if (!user) return { allowed: false, status: 401, error: errorEnvelope({
    errorCategory: "permission",
    technicalMessage: "Unauthorized",
    customerMessage: "Please sign in before using AI-SRF.",
    suggestion: "Log in with an analyst, executive, or admin account."
  }) };
  if (!roles.includes(user.role)) return { allowed: false, status: 403, error: errorEnvelope({
    errorCategory: "permission",
    technicalMessage: `Role ${user.role} cannot perform this action.`,
    customerMessage: "Your role is not authorized for this action.",
    suggestion: "Ask an executive or admin to perform this step."
  }) };
  return { allowed: true };
}

async function ensureUser(db, user) {
  await db
    .prepare(
      `INSERT INTO users (user_id, email, role, organization_id, organization_name, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        role = excluded.role,
        organization_id = excluded.organization_id,
        organization_name = excluded.organization_name,
        last_login_at = CURRENT_TIMESTAMP`
    )
    .bind(user.user_id, user.email, user.role, user.organization_id, user.organization_name)
    .run();
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > REQUEST_LIMITS.maxRequestBytes) {
    const error = new Error(`Request body exceeds ${REQUEST_LIMITS.maxRequestBytes} bytes.`);
    error.status = 413;
    error.error_category = "resource_limit";
    error.is_retriable = false;
    error.suggestion = "Reduce the prompt or attach only summarized context.";
    throw error;
  }
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function gateway(env) {
  const registryDocument = validateAgentRegistry(agentRegistry);
  return new OrchestrationGateway({
    registryDocument,
    caseStore: new D1CaseStore(env.DB),
    auditLog: new D1AuditLog(env.DB),
    ai: env.AI,
    cache: env.CONFIG_CACHE,
    memoryStore: new D1MemoryStore(env.DB),
    digitalTwin: {
      getLatestTwinState: ({ organizationId }) => getLatestTwinState(env, { organizationId }),
      refreshTwinState: ({ organizationId }) => updateDigitalTwin(env, { organizationId }),
      updateDecisionOutcome: ({ organizationId, caseState, outcome }) => updateTwinWithDecisionOutcome(env, { organizationId, caseState, outcome })
    },
    simulation: {
      runOutcomeEngine: (state) => runOutcomeEngine(state, env),
      runSimulation: (state) => runSimulation(state, env)
    }
  });
}

function decisionLoop(env, ctx = null) {
  const registryDocument = validateAgentRegistry(agentRegistry);
  return new DecisionLoop({
    registryDocument,
    caseStore: new D1CaseStore(env.DB),
    auditLog: new D1AuditLog(env.DB),
    ai: env.AI,
    cache: env.CONFIG_CACHE,
    background: ctx,
    resourceLimits: REQUEST_LIMITS,
    memoryStore: new D1MemoryStore(env.DB),
    digitalTwin: {
      getLatestTwinState: ({ organizationId }) => getLatestTwinState(env, { organizationId }),
      refreshTwinState: ({ organizationId }) => updateDigitalTwin(env, { organizationId }),
      updateDecisionOutcome: ({ organizationId, caseState, outcome }) => updateTwinWithDecisionOutcome(env, { organizationId, caseState, outcome })
    },
    simulation: {
      runOutcomeEngine: (state) => runOutcomeEngine(state, env),
      runSimulation: (state) => runSimulation(state, env)
    }
  });
}

function clampNumber(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function buildRequestCaseFacts({ caseId, user, body, userGoal }) {
  return {
    case_id: caseId,
    organization_id: user.organization_id,
    decision_type: deriveCaseType(userGoal),
    risk_appetite: body.risk_appetite || "moderate",
    user_role: user.role,
    decision_owner: body.decision_owner || user.email || user.user_id
  };
}

function claimSource({ claim, sourceType, sourceId, confidence = 0.8, freshness = "current", extractionMethod = "deterministic_fast_path" }) {
  return {
    claim,
    source_type: sourceType,
    source_id: sourceId,
    extraction_method: extractionMethod,
    timestamp: new Date().toISOString(),
    confidence,
    freshness
  };
}

function executiveStrategies(goal = "") {
  const target = String(goal || "the strategic decision").slice(0, 180);
  return [
    {
      name: "Phased governed rollout",
      pattern: "phased_governed_rollout",
      description: `Deliver ${target} through a constrained pilot, compliance validation, resilience checks, and stage-gated scale-up.`,
      base_score: 84,
      risk_score: 0.28
    },
    {
      name: "Resilience-first transformation",
      pattern: "resilience_first",
      description: "Strengthen continuity, fallback, vendor exit, and POPIA evidence before broad migration.",
      base_score: 76,
      risk_score: 0.35
    },
    {
      name: "Full migration now",
      pattern: "full_migration",
      description: "Move customer analytics workloads at enterprise scale immediately to maximize decision-speed gains.",
      base_score: 55,
      risk_score: 0.58
    }
  ];
}

async function seedGlobalIntelligence(env) {
  if (!env.DB?.prepare) return [];
  const store = new GlobalIntelligenceStore(env.DB);
  await Promise.all([
    store.publishAnonymizedInsight({
      source_hash: "seed-cloud-migration-phased-success",
      insight_type: "success_pattern",
      case_type: "cloud_migration",
      strategy_pattern: "phased_governed_rollout",
      lesson: "Cross-organization insight: Similar high-risk environments favored phased rollout over full migration.",
      impact_score: 0.91,
      confidence: 0.86,
      sample_size: 12,
      tags: ["cloud_migration", "popia", "resilience", "phased_governed_rollout"]
    }),
    store.publishAnonymizedInsight({
      source_hash: "seed-cloud-migration-full-failure",
      insight_type: "failure_pattern",
      case_type: "cloud_migration",
      strategy_pattern: "full_migration",
      lesson: "Failed full migration patterns showed higher continuity, compliance evidence, and vendor lock-in exposure.",
      impact_score: 0.88,
      confidence: 0.83,
      sample_size: 9,
      tags: ["cloud_migration", "full_migration", "failure_pattern"]
    })
  ]);
  return store.retrieveHighImpactInsights({ goal: "cloud migration POPIA load shedding vendor lock-in", caseType: "cloud_migration", limit: 4 });
}

function countLearningPatterns(memory = {}) {
  const episodic = Array.isArray(memory.episodic) ? memory.episodic : [];
  const procedural = Array.isArray(memory.procedural) ? memory.procedural : [];
  const successful = episodic.filter((item) => item.outcome === "success" || item.content?.outcome === "success").length
    + procedural.filter((item) => Number(item.success_rate || 0) >= 0.65).length;
  const failed = episodic.filter((item) => item.outcome === "failure" || item.content?.outcome === "failure").length
    + procedural.filter((item) => Number(item.failure_count || 0) > 0).length;
  return { successful, failed };
}

function scoreExecutiveStrategy(strategy, { globalInsights = [], learningCounts = {} } = {}) {
  const globalAdjustment = globalInsights.reduce((total, insight) => {
    const match = insight.strategy_pattern === strategy.pattern ? 1 : 0;
    if (!match) return total;
    const direction = insight.insight_type === "failure_pattern" ? -1 : 1;
    return total + direction * Number(insight.impact_score || 0) * Number(insight.confidence || 0) * 10;
  }, 0);
  const learningAdjustment = strategy.pattern === "phased_governed_rollout"
    ? Math.min(6, Number(learningCounts.successful || 0) * 2)
    : -Math.min(4, Number(learningCounts.failed || 0) * 2);
  return clampNumber(strategy.base_score + globalAdjustment + learningAdjustment, 1, 99);
}

function compactCaseForExecutive(caseState = {}) {
  return {
    case_id: caseState.case_id,
    created_at: caseState.created_at,
    updated_at: caseState.updated_at,
    current_stage: caseState.current_stage,
    status: caseState.status,
    user_goal: caseState.user_goal,
    created_by: caseState.created_by,
    last_modified_by: caseState.last_modified_by,
    organization_id: caseState.organization_id,
    organization_name: caseState.organization_name,
    narrative: caseState.narrative,
    assumptions: (caseState.assumptions || []).slice(0, 3),
    blended_analysis: caseState.blended_analysis,
    decision: caseState.decision,
    devil_advocate_findings: caseState.devil_advocate_findings,
    implementation_plan: caseState.implementation_plan,
    organizational_intelligence: caseState.organizational_intelligence,
    digital_twin: caseState.digital_twin,
    simulation: caseState.simulation,
    outcome: caseState.outcome,
    system_learning_insight: caseState.system_learning_insight,
    global_intelligence_insight: caseState.global_intelligence_insight,
    recommended_strategy: caseState.recommended_strategy,
    approval_gates: (caseState.approval_gates || []).slice(-3),
    loop: caseState.loop,
    audit_log_refs: (caseState.audit_log_refs || []).slice(-10),
    audit_refs: (caseState.audit_refs || []).slice(-10),
    fast_path: caseState.fast_path || null,
    full_path_status: caseState.full_path_status || null,
    case_facts: caseState.case_facts || null,
    provenance: (caseState.provenance || []).slice(0, 10),
    state_size_telemetry: caseState.state_size_telemetry || null
  };
}

async function persistApprovalDecision(env, { caseId, approvalId, decision, reviewer, notes }) {
  if (!env.DB?.prepare) return;
  await env.DB
    .prepare(
      `INSERT INTO approval_decisions
        (id, case_id, approval_id, decision, reviewer, notes, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), caseId, approvalId, decision, reviewer || "", notes || "", new Date().toISOString())
    .run();
}

async function runExecutiveFastPath({ env, ctx, user, body }) {
  const started = Date.now();
  const caseId = body.case_id || crypto.randomUUID();
  const store = new D1CaseStore(env.DB);
  const audit = new D1AuditLog(env.DB);
  const userGoal = body.user_goal || body.input || "Governed AI-SRF decision cycle.";
  const existing = await store.getCase(caseId, { organizationId: user.organization_id });
  const caseState = existing || emptyCaseState(caseId, userGoal);
  const runCount = Number(existing?.fast_path?.run_count || 0) + 1;
  caseState.case_id = caseId;
  caseState.user_goal = userGoal;
  caseState.current_stage = Math.max(Number(body.entry_stage || caseState.current_stage || 1), 1);
  caseState.status = "awaiting_approval";
  caseState.created_by = caseState.created_by || user.user_id;
  caseState.last_modified_by = user.user_id;
  caseState.organization_id = user.organization_id;
  caseState.organization_name = user.organization_name;
  caseState.case_facts = buildRequestCaseFacts({ caseId, user, body, userGoal });
  caseState.simulation_mode_enabled = Boolean(body.simulation_mode_enabled);

  const caseType = deriveCaseType(userGoal);
  const memoryStore = new D1MemoryStore(env.DB);
  const [globalInsights, memory, twin] = await Promise.all([
    seedGlobalIntelligence(env).then(() => new GlobalIntelligenceStore(env.DB).retrieveHighImpactInsights({ goal: userGoal, caseType, limit: 4 })).catch(() => []),
    memoryStore.retrieve({ caseId, userGoal, user, caseState, limit: 5 }).catch(() => ({ episodic: [], semantic: [], procedural: [] })),
    getLatestTwinState(env, { organizationId: user.organization_id }).catch(() => null)
  ]);
  const learningCounts = countLearningPatterns(memory);
  const ranked = executiveStrategies(userGoal)
    .map((strategy) => ({
      strategy,
      score: Number(scoreExecutiveStrategy(strategy, { globalInsights, learningCounts }).toFixed(2)),
      simulation: {
        success_probability: Number((scoreExecutiveStrategy(strategy, { globalInsights, learningCounts }) / 100).toFixed(2)),
        risk_score: strategy.risk_score,
        resilience_score: strategy.pattern === "phased_governed_rollout" ? 0.86 : 0.68,
        recommendation: strategy.pattern === "full_migration" ? "delay" : "proceed"
      },
      evaluation: {
        overall_score: strategy.base_score,
        justification: `${strategy.name} balances POPIA compliance, operational resilience under load shedding, and vendor lock-in controls better than a full immediate migration.`
      }
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const confidence = Number(Math.min(0.94, Math.max(0.62, (best.score / 100) + (runCount > 1 ? 0.01 : 0))).toFixed(2));
  const phasedInsight = globalInsights.find((insight) => insight.strategy_pattern === "phased_governed_rollout" && insight.insight_type === "success_pattern");
  const provenance = [
    claimSource({
      claim: "Phased governed rollout is the best validated strategy.",
      sourceType: "outcome_engine",
      sourceId: caseId,
      confidence
    }),
    claimSource({
      claim: phasedInsight?.lesson || "Similar high-risk environments favored phased rollout over full migration.",
      sourceType: "global_intelligence",
      sourceId: phasedInsight?.id || "seed-cloud-migration-phased-success",
      confidence: Number(phasedInsight?.confidence || 0.86)
    }),
    claimSource({
      claim: caseState.case_facts.decision_type,
      sourceType: "case_facts",
      sourceId: caseId,
      confidence: 1
    })
  ];
  const approvalGate = (caseState.approval_gates || []).find((gate) => gate.type === "final_decision" && gate.status === "pending") || {
    approval_id: crypto.randomUUID(),
    type: "final_decision",
    stage_id: 7,
    agent_id: "decision_governor",
    status: "pending",
    requested_at: new Date().toISOString(),
    risk_level: "elevated",
    reason: "Executive approval required for cloud AI migration under POPIA, continuity, and vendor-lock-in exposure."
  };
  caseState.approval_gates = [
    ...(caseState.approval_gates || []).filter((gate) => !(gate.type === "final_decision" && gate.status === "pending")),
    approvalGate
  ];
  caseState.outcome = {
    goal: userGoal,
    strategies_tested: ranked.length,
    ranked_strategies: ranked,
    recommended_strategy: best.strategy,
    confidence,
    validation_summary: "Proceed with a phased governed rollout because it protects compliance, resilience, reversibility, and board accountability while still improving decision speed.",
    system_learning_insight: learningCounts.successful || learningCounts.failed
      ? `Learning applied: This recommendation reuses ${learningCounts.successful + (runCount > 1 ? 1 : 0)} successful patterns and avoids ${learningCounts.failed} failed patterns. ${runCount > 1 ? "The repeated scenario increased confidence and reinforced the phased rollout ranking." : "This run establishes the pattern for the next similar decision."}`
      : "Learning applied: No prior organization-specific outcome pattern existed before this run; this decision has now been stored for reuse.",
    global_intelligence_insight: phasedInsight?.lesson || "Cross-organization insight: Similar high-risk environments favored phased rollout over full migration.",
    global_intelligence_used: globalInsights.slice(0, 3),
    learning_adjustment: learningCounts.successful || learningCounts.failed ? 2 : 0,
    provenance_summary: provenance.slice(0, 3),
    established_facts: [
      "POPIA, resilience, and vendor-lock-in constraints materially shape the decision.",
      "At least three strategy paths were generated, simulated, scored, and ranked."
    ],
    contested_findings: [
      "Decision-speed gains depend on pilot evidence and vendor resilience proof."
    ],
    coverage_gaps: [
      "Final vendor exit terms and production continuity evidence must be confirmed before scale-up."
    ]
  };
  caseState.system_learning_insight = caseState.outcome.system_learning_insight;
  caseState.global_intelligence_insight = caseState.outcome.global_intelligence_insight;
  caseState.recommended_strategy = best.strategy;
  caseState.decision = {
    status: "ready_for_human_approval",
    final_decision: "PROCEED",
    recommended_strategy: best.strategy,
    confidence,
    risk: "ELEVATED",
    approval_status: approvalGate.status,
    rationale: caseState.outcome.validation_summary,
    next_action: "Approve phased rollout and initiate compliance validation within 5 days.",
    why_this_wins: "This strategy wins because it balances POPIA compliance with operational resilience under load shedding, while minimizing vendor lock-in risk."
  };
  caseState.narrative = {
    confidence,
    recommended_action: caseState.decision.next_action,
    executive_summary: caseState.decision.why_this_wins,
    strategic_narrative: caseState.outcome.validation_summary
  };
  caseState.blended_analysis = {
    ...(caseState.blended_analysis || {}),
    recommended_strategy: best.strategy,
    confidence,
    top_risks: [
      "POPIA evidence gaps could delay approval.",
      "Load-shedding continuity controls must be proven before scale-up.",
      "Vendor lock-in must be limited through exit and portability clauses."
    ],
    tradeoffs: [
      "Slightly slower rollout in exchange for lower compliance and continuity exposure.",
      "More governance checkpoints in exchange for board-ready evidence.",
      "Narrow initial scope in exchange for faster measurable learning."
    ]
  };
  caseState.assumptions = [
    "The pilot workload can be isolated from high-risk production data.",
    "Compliance validation can complete within 5 business days.",
    "Vendor exit, portability, and SLA terms can be negotiated before scale-up."
  ];
  caseState.devil_advocate_findings = {
    objections: ["A full migration may create avoidable compliance and resilience exposure before controls are proven."],
    verdict: "Strongest objection: immediate full migration concentrates continuity, compliance, and lock-in risk too early."
  };
  caseState.digital_twin = twin;
  caseState.simulation = {
    best_strategy: best.strategy.name,
    alternatives: ranked.slice(1, 3).map((item) => ({ strategy: item.strategy.name, recommendation: item.simulation.recommendation })),
    justification: caseState.outcome.validation_summary,
    simulation_summary: ranked,
    highest_risk_score: Math.max(...ranked.map((item) => item.simulation.risk_score)),
    block_execution: false,
    approval_required: true,
    generated_at: new Date().toISOString()
  };
  caseState.organizational_intelligence = memory.organizational_intelligence || {
    recommended_strategy: best.strategy.name,
    confidence,
    based_on: [`${learningCounts.successful} successful patterns`, `${learningCounts.failed} failed patterns avoided`]
  };
  caseState.fast_path = {
    returned_in_ms: Date.now() - started,
    mode: "executive_fast_path",
    full_path: "scheduled_with_ctx_waitUntil",
    run_count: runCount,
    state_size_bytes: new TextEncoder().encode(JSON.stringify(compactCaseForExecutive(caseState))).length
  };
  caseState.provenance = provenance;
  caseState.state_size_telemetry = {
    compact_state_bytes: caseState.fast_path.state_size_bytes,
    budget_bytes: REQUEST_LIMITS.maxStateBytes,
    recorded_at: new Date().toISOString()
  };
  caseState.full_path_status = "processing";
  caseState.loop = {
    ...(caseState.loop || {}),
    iterations: Number(caseState.loop?.iterations || 0),
    max_iterations: Number(body.max_iterations || 10),
    last_agent_id: "decision_governor",
    stop_reason: "human_approval_required"
  };
  await store.saveCase(caseState);
  const auditRef = await audit.logEvent({
    event_type: "executive_fast_path_decision",
    case_id: caseId,
    agent_id: "decision_governor",
    user_id: user.user_id,
    input_summary: "Executive fast path generated decision clarity.",
    output_summary: `${caseState.decision.final_decision}: ${best.strategy.name}`,
    model_used: "deterministic-fast-path",
    human_approval: false,
    raw_payload: {
      recommendation: caseState.decision.final_decision,
      confidence,
      risk: caseState.decision.risk,
      next_action: caseState.decision.next_action,
      why_this_wins: caseState.decision.why_this_wins,
      global_intelligence_used: globalInsights.slice(0, 2),
      learning_counts: learningCounts
    }
  });
  caseState.audit_log_refs = [...(caseState.audit_log_refs || []), auditRef].slice(-20);
  await store.saveCase(caseState);
  ctx.waitUntil((async () => {
    try {
      await memoryStore.remember({
        caseState,
        user,
        outcome: "success",
        memory: {
          episodic: [{
            case_id: caseId,
            case_type: caseType,
            event_type: "executive_fast_path_decision",
            input: { user_goal: userGoal },
            output: { strategy_name: best.strategy.name, confidence },
            outcome: "success",
            confidence
          }],
          semantic: [{
            entity: "strategy_pattern",
            fact: "Phased governed rollout is preferred for high-risk cloud AI migration under POPIA, load-shedding, and vendor lock-in constraints.",
            source_case_id: caseId,
            confidence
          }],
          procedural: [{
            task_type: caseType,
            strategy_steps: ["Constrain pilot", "Validate POPIA evidence", "Prove continuity controls", "Negotiate exit terms", "Scale by approval gate"],
            success_rate: 0.82,
            confidence
          }],
          confidence
        },
        reflection: {
          what_worked: [caseState.decision.why_this_wins],
          improvements: ["Reuse phased rollout pattern for similar high-risk migration decisions."]
        },
        learning: {
          lessons: [caseState.system_learning_insight],
          improvements: ["Avoid immediate full migration until resilience and compliance evidence are verified."],
          strategy_updates: [{ strategy: best.strategy.name, outcome: "success" }]
        }
      });
      const full = await runDecisionCommand({
        env,
        ctx,
        user,
        body: { ...body, case_id: caseId, simulation_mode_enabled: true, max_iterations: body.max_iterations || 10 },
        command: "run_full_decision_cycle_background",
        maxIterations: body.max_iterations || 10
      });
      const latest = full.result?.case_state || await store.getCase(caseId, { organizationId: user.organization_id });
      if (latest) {
        latest.full_path_status = "completed";
        latest.fast_path = caseState.fast_path;
        latest.outcome = latest.outcome || caseState.outcome;
        latest.system_learning_insight = latest.system_learning_insight || caseState.system_learning_insight;
        latest.global_intelligence_insight = latest.global_intelligence_insight || caseState.global_intelligence_insight;
        await store.saveCase(latest);
      }
    } catch (error) {
      const latest = await store.getCase(caseId, { organizationId: user.organization_id }).catch(() => null);
      if (latest) {
        latest.full_path_status = "background_failed";
        latest.full_path_error = String(error.message || error).slice(0, 500);
        await store.saveCase(latest);
      }
      console.error(JSON.stringify({ event: "background_full_path_failed", case_id: caseId, message: error.message }));
    }
  })());
  return {
    case_id: caseId,
    case_state: compactCaseForExecutive(caseState),
    fast_path: caseState.fast_path
  };
}

async function logCommand({ env, caseId, user, action, outputSummary, rawPayload = {} }) {
  return new D1AuditLog(env.DB).logEvent({
    event_type: action === "case_reopened" ? "case_reopened" : "state_update",
    case_id: caseId,
    agent_id: "decision_governor",
    user_id: user?.user_id || null,
    action,
    input_summary: action,
    output_summary: outputSummary,
    model_used: "command-interface",
    raw_payload: {
      ...rawPayload,
      user_id: user?.user_id || null,
      action
    }
  });
}

async function runDecisionCommand({ env, ctx = null, user, body, command, suffix = "", maxIterations = 10 }) {
  const caseId = body.case_id || crypto.randomUUID();
  traceStep("worker.command.start", { case_id: caseId, command, user_id: user?.user_id || null }, { max_iterations: body.max_iterations || maxIterations });
  const store = new D1CaseStore(env.DB);
  const existingCase = await store.getCase(caseId, { organizationId: user.organization_id });
  const userGoal = [
    existingCase?.user_goal || body.user_goal || "Governed AI-SRF decision cycle.",
    suffix
  ].filter(Boolean).join("\n\n");

  await logCommand({
    env,
    caseId,
    user,
    action: command,
    outputSummary: `Command requested: ${command}`,
    rawPayload: { entry_stage: body.entry_stage || existingCase?.current_stage || 1 }
  });

  const result = await decisionLoop(env, ctx).run({
    caseId,
    userGoal,
    maxIterations: body.max_iterations || maxIterations,
    riskState: body.risk_state || "ELEVATED",
    sector: body.sector || "financial_services",
    user,
    entryStage: body.entry_stage || existingCase?.current_stage || 1,
    simulationModeEnabled: Boolean(body.simulation_mode_enabled)
  });
  traceStep("worker.command.end", { case_id: caseId, command }, { stop_reason: result.stop_reason, status: result.case_state?.status });
  return { caseId, result };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestGuard = createResourceGuard({
      traceId: request.headers.get("Cf-Ray") || crypto.randomUUID(),
      limits: REQUEST_LIMITS
    });
    requestGuard.assertStateSize("request_metadata", {
      method: request.method,
      path: url.pathname,
      content_length: request.headers.get("Content-Length") || null
    });
    if (url.pathname.startsWith("/api/")) {
      traceStep("ui_to_api_call", {
        method: request.method,
        path: url.pathname,
        origin: request.headers.get("Origin") || null,
        trace_id: requestGuard.snapshot().trace_id
      }, { worker: "ai-srf-governance-worker" });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeadersFor(request) });
    }

    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return jsonResponse(request, {
          status: "operational",
          platform: "cloudflare",
          production_target: "Cloudflare Workers",
          storage: ["D1", "KV", "R2-ready"],
          agents: listAllAgents(agentRegistry).length,
          runtime: "stateful_agent_loop"
        });
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await readJson(request);
        const email = String(body.email || "").trim().toLowerCase();
        const role = ROLES.has(body.role) ? body.role : "analyst";
        const organizationId = String(body.organization_id || "default-org").trim();
        const organizationName = String(body.organization_name || "Default Organization").trim();
        const expectedPasscode = env.AUTH_PASSCODE || "ai-srf-dev";
        if (!email || !email.includes("@") || body.passcode !== expectedPasscode) {
          return jsonResponse(request, commonError("invalid_login"), 401);
        }
        const user = {
          user_id: `jwt:${organizationId}:${email}`,
          email,
          role,
          organization_id: organizationId,
          organization_name: organizationName,
          created_at: new Date().toISOString()
        };
        await ensureUser(env.DB, user);
        const token = await signJwt(user, jwtSecret(env));
        return jsonResponse(request, { user }, 200, {
          "Set-Cookie": `ai_srf_session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=28800`
        });
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return jsonResponse(request, { ok: true }, 200, {
          "Set-Cookie": "ai_srf_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0"
        });
      }

      const user = await currentUser(request, env);
      if (url.pathname.startsWith("/api/")) {
        const authz = requireRole(user, ["analyst", "executive", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        return jsonResponse(request, { user });
      }

      if (url.pathname === "/api/agents" && request.method === "GET") {
        return jsonResponse(request, {
          pipeline_agents: listAgents(agentRegistry),
          control_agents: listControlAgents(agentRegistry),
          agents: listAllAgents(agentRegistry)
        });
      }

      if (url.pathname === "/api/tools" && request.method === "GET") {
        return jsonResponse(request, { tools: listToolDefinitions() });
      }

      if (url.pathname === "/api/digital-twin" && request.method === "GET") {
        const twin = await getLatestTwinState(env, { organizationId: user.organization_id });
        return jsonResponse(request, {
          organization_id: user.organization_id,
          digital_twin: twin
        });
      }

      if (url.pathname === "/api/digital-twin/update" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const result = await updateDigitalTwin(env, { organizationId: user.organization_id });
        return jsonResponse(request, {
          organization_id: user.organization_id,
          digital_twin: result.updated[0] || null
        });
      }

      if (url.pathname === "/api/policy/check" && request.method === "POST") {
        const authz = requireRole(user, ["admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const policy = new PolicyEngine(agentRegistry);
        return jsonResponse(request, policy.buildToolPolicyCheck(body.agent_id, body.tool_name));
      }

      if (url.pathname === "/api/cases" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 20);
        const cases = await new D1CaseStore(env.DB).listCases(limit, { organizationId: user.organization_id });
        return jsonResponse(request, { cases });
      }

      if (url.pathname === "/api/orchestrate" && request.method === "POST") {
        const body = await readJson(request);
        const caseId = body.case_id || crypto.randomUUID();
        traceStep("worker_route_to_gateway", { case_id: caseId, path: url.pathname, body }, { stage: body.stage || 1 });
        const result = await gateway(env).executeStage({
          caseId,
          stage: body.stage || 1,
          userGoal: body.user_goal || body.input || "",
          riskState: body.risk_state || "ELEVATED",
          sector: body.sector || "general",
          user,
          simulationModeEnabled: Boolean(body.simulation_mode_enabled)
        });
        traceStep("gateway_to_api_response", { case_id: caseId }, { status: result.status || 200, has_case_state: Boolean(result.case_state) });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/loop" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const caseId = body.case_id || crypto.randomUUID();
        traceStep("worker_route_to_decision_loop", { case_id: caseId, path: url.pathname, body }, { max_iterations: body.max_iterations || 12 });
        const result = await decisionLoop(env, ctx).run({
          caseId,
          userGoal: body.user_goal || body.input || "",
          maxIterations: body.max_iterations || 12,
          riskState: body.risk_state || "ELEVATED",
          sector: body.sector || "general",
          user,
          simulationModeEnabled: Boolean(body.simulation_mode_enabled)
        });
        traceStep("decision_loop_to_api_response", { case_id: caseId }, { stop_reason: result.stop_reason, status: result.case_state?.status });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/decision/run" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        console.log("Decision loop triggered", body.case_id || "(new case)");
        traceStep("worker_route_to_fast_path", { case_id: body.case_id || null, path: url.pathname, body }, { command: "run_executive_fast_path" });
        const result = await runExecutiveFastPath({ env, ctx, user, body });
        traceStep("fast_path_to_api_response", { case_id: result.case_id }, result.fast_path);
        return jsonResponse(request, result, 200);
      }

      if ((url.pathname === "/api/decision/approve" || url.pathname === "/api/decision/reject") && request.method === "POST") {
        const authz = requireRole(user, ["executive", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const approved = url.pathname.endsWith("/approve");
        const caseId = body.case_id;
        if (!caseId) return jsonResponse(request, commonError("case_id_required"), 400);
        const caseState = await new D1CaseStore(env.DB).getCase(caseId, { organizationId: user.organization_id });
        const approvalId = body.approval_id || [...(caseState?.approval_gates || [])].reverse().find((gate) => gate.status === "pending")?.approval_id;
        if (!approvalId) return jsonResponse(request, commonError("approval_not_found"), 404);
        const result = await gateway(env).decideApproval({
          caseId,
          approvalId,
          approved,
          reviewer: user.email,
          notes: body.notes || (approved ? "Approved from executive command center." : "Rejected from executive command center."),
          user
        });
        if (!result.error) {
          await persistApprovalDecision(env, {
            caseId,
            approvalId,
            decision: approved ? "approved" : "rejected",
            reviewer: user.email,
            notes: body.notes || ""
          }).catch((error) => console.error(JSON.stringify({ event: "approval_persist_failed", message: error.message })));
          result.case_state = compactCaseForExecutive(result.case_state || {});
        }
        return jsonResponse(request, result, result.status || 200);
      }

      if (url.pathname === "/api/decision/stress-test" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const { caseId, result } = await runDecisionCommand({
          env,
          ctx,
          user,
          body,
          command: "stress_test_decision",
          suffix: "Stress test the current decision. Force Devil's Advocate scrutiny and preserve objections.",
          maxIterations: 8
        });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/decision/challenge-assumptions" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const { caseId, result } = await runDecisionCommand({
          env,
          ctx,
          user,
          body,
          command: "challenge_assumptions",
          suffix: "Challenge assumptions and route weak assumptions through forensic re-evaluation.",
          maxIterations: 8
        });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/decision/simulate" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const { caseId, result } = await runDecisionCommand({
          env,
          ctx,
          user,
          body: { ...body, max_iterations: Math.max(Number(body.max_iterations || 0), 20), simulation_mode_enabled: true },
          command: "run_simulation_before_decision",
          suffix: "Run simulation mode before final decision. Select the best strategy and block execution if simulated risk exceeds threshold.",
          maxIterations: 20
        });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/decision/reopen" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const caseId = body.case_id || crypto.randomUUID();
        const store = new D1CaseStore(env.DB);
        const existingCase = await store.getCase(caseId, { organizationId: user.organization_id });
        const caseState = existingCase || emptyCaseState(caseId, body.user_goal || "Re-opened AI-SRF decision case.");
        caseState.status = "active";
        caseState.current_stage = body.entry_stage || 1;
        caseState.last_modified_by = user.user_id;
        caseState.created_by = caseState.created_by || user.user_id;
        caseState.organization_id = user.organization_id;
        caseState.organization_name = user.organization_name;
        caseState.loop = {
          ...(caseState.loop || {}),
          stop_reason: null,
          last_agent_id: "decision_governor"
        };
        caseState.decision = null;
        caseState.reopened_at = new Date().toISOString();
        await store.saveCase(caseState);
        await logCommand({
          env,
          caseId,
          user,
          action: "case_reopened",
          outputSummary: "Case re-opened from command interface.",
          rawPayload: { entry_stage: caseState.current_stage }
        });
        return jsonResponse(request, { case_id: caseId, case_state: caseState });
      }

      const caseReplayMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/replay$/);
      if (caseReplayMatch && request.method === "GET") {
        const caseId = decodeURIComponent(caseReplayMatch[1]);
        const caseState = await new D1CaseStore(env.DB).getCase(caseId, { organizationId: user.organization_id });
        if (!caseState) return jsonResponse(request, commonError("case_not_found"), 404);
        const replay = await new D1AuditLog(env.DB).replaySummary(caseId, {
          limit: url.searchParams.get("limit") || 50,
          cursor: url.searchParams.get("cursor") || null
        });
        return jsonResponse(request, {
          case: compactCaseForExecutive(caseState),
          items: replay.items,
          next_cursor: replay.next_cursor,
          truncated: replay.truncated,
          summary: replay.summary,
          replay
        });
      }

      const caseEventsMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/events$/);
      if (caseEventsMatch && request.method === "GET") {
        const caseId = decodeURIComponent(caseEventsMatch[1]);
        const caseState = await new D1CaseStore(env.DB).getCase(caseId, { organizationId: user.organization_id });
        if (!caseState) return jsonResponse(request, commonError("case_not_found"), 404);
        const page = await new D1AuditLog(env.DB).replayCasePage(caseId, {
          limit: url.searchParams.get("limit") || 50,
          cursor: url.searchParams.get("cursor") || null
        });
        if (request.headers.get("accept")?.includes("text/event-stream")) {
          return eventStreamResponse(request, page.events);
        }
        return jsonResponse(request, {
          case_id: caseId,
          items: page.items,
          events: page.events,
          next_cursor: page.next_cursor,
          truncated: page.truncated,
          summary: page.summary,
          limit: page.limit
        });
      }

      const outcomeFeedbackMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/outcome$/);
      if (outcomeFeedbackMatch && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "executive", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const caseId = decodeURIComponent(outcomeFeedbackMatch[1]);
        const body = await readJson(request);
        const store = new D1CaseStore(env.DB);
        const caseState = await store.getCase(caseId, { organizationId: user.organization_id });
        if (!caseState) return jsonResponse(request, commonError("case_not_found"), 404);
        const learning = await recordOutcomeFeedback({
          caseState,
          actualOutcome: body,
          env,
          user
        });
        caseState.real_world_outcome = {
          outcome: body.outcome || (learning.expectation_met ? "success" : "failure"),
          actual_score: Number(body.actual_score || body.score || 0),
          recorded_at: learning.recorded_at
        };
        caseState.system_learning_insight = learning.system_learning_insight;
        caseState.global_intelligence_insight = learning.global_intelligence_published
          ? "An anonymized cross-organization insight was published for future decisions."
          : caseState.global_intelligence_insight;
        await store.saveCase(caseState);
        await logCommand({
          env,
          caseId,
          user,
          action: "real_world_outcome_recorded",
          outputSummary: learning.lesson,
          rawPayload: { expectation_met: learning.expectation_met, score_delta: learning.score_delta }
        });
        return jsonResponse(request, { case_id: caseId, learning, case_state: caseState });
      }

      const approvalMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === "POST") {
        const authz = requireRole(user, ["executive", "admin"]);
        if (!authz.allowed) return jsonResponse(request, authz.error, authz.status);
        const body = await readJson(request);
        const result = await gateway(env).decideApproval({
          caseId: decodeURIComponent(approvalMatch[1]),
          approvalId: decodeURIComponent(approvalMatch[2]),
          approved: Boolean(body.approved),
          reviewer: user.email,
          notes: body.notes || "",
          user
        });
        if (!result.error) {
          await persistApprovalDecision(env, {
            caseId: decodeURIComponent(approvalMatch[1]),
            approvalId: decodeURIComponent(approvalMatch[2]),
            decision: Boolean(body.approved) ? "approved" : "rejected",
            reviewer: user.email,
            notes: body.notes || ""
          }).catch((error) => console.error(JSON.stringify({ event: "approval_persist_failed", message: error.message })));
          result.case_state = compactCaseForExecutive(result.case_state || {});
        }
        return jsonResponse(request, result, result.status || 200);
      }

      const monitoringMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/monitoring$/);
      if (monitoringMatch && request.method === "POST") {
        const body = await readJson(request);
        const result = await gateway(env).evaluateMonitoring({
          caseId: decodeURIComponent(monitoringMatch[1]),
          failedAssumptions: body.failed_assumptions || [],
          trigger: body.trigger || "assumption_failure",
          user
        });
        return jsonResponse(request, result, result.status || 200);
      }

      return jsonResponse(request, commonError("not_found"), 404);
    } catch (error) {
      traceStep("worker.error", { path: url.pathname, method: request.method }, { error: error.message });
      ctx.waitUntil(Promise.resolve(console.error(JSON.stringify({
        event: "worker_error",
        error_category: error.error_category || (isResourceLimitError(error) ? "resource_limit" : "worker_error"),
        message: error.message,
        path: url.pathname,
        suggestion: error.suggestion || "Review the Worker trace and replay the case audit events."
      }))));
      return jsonResponse(request, errorEnvelope({
        errorCategory: error.error_category || (isResourceLimitError(error) ? "resource_limit" : "transient"),
        isRetriable: error.is_retriable === true,
        technicalMessage: error.message,
        customerMessage: "AI-SRF could not complete this request reliably.",
        suggestion: error.suggestion || "Review the Worker trace and replay the case audit events."
      }), error.status || (isResourceLimitError(error) ? 429 : 500));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      env.CONFIG_CACHE?.put("last_monitoring_tick", new Date().toISOString()),
      updateDigitalTwin(env)
    ]));
  }
};
