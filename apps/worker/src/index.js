import { D1AuditLog } from "../../../packages/audit/d1-audit-log.js";
import { OrchestrationGateway } from "../../../packages/core/orchestration-gateway.js";
import { DecisionLoop } from "../../../packages/loop/decision-loop.js";
import { D1MemoryStore } from "../../../packages/memory/d1-memory-store.js";
import { PolicyEngine } from "../../../packages/policy/policy-engine.js";
import { listAgents, listAllAgents, listControlAgents, validateAgentRegistry } from "../../../packages/shared/agent-registry.js";
import { listToolDefinitions } from "../../../packages/skills/index.js";
import { D1CaseStore, emptyCaseState } from "../../../packages/state/d1-case-store.js";
import { agentRegistry } from "./config/agents.js";

const WORKER_ORIGIN = "https://ai-srf-governance-worker.bryte-sika.workers.dev";
const STATIC_PAGES_ORIGINS = new Set([
  "https://436ee841.ai-srf-cloudflare.pages.dev",
  "https://947aba3a.ai-srf-cloudflare.pages.dev",
  "https://65f08d50.ai-srf-cloudflare.pages.dev"
]);

function allowedCorsOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return WORKER_ORIGIN;
  if (origin === "null") return "null";
  try {
    const url = new URL(origin);
    if (STATIC_PAGES_ORIGINS.has(origin)) return origin;
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

function jsonResponse(request, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(request), "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
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
  if (!user) return { allowed: false, status: 401, error: "Unauthorized" };
  if (!roles.includes(user.role)) return { allowed: false, status: 403, error: "Forbidden" };
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
    memoryStore: new D1MemoryStore(env.DB)
  });
}

function decisionLoop(env) {
  const registryDocument = validateAgentRegistry(agentRegistry);
  return new DecisionLoop({
    registryDocument,
    caseStore: new D1CaseStore(env.DB),
    auditLog: new D1AuditLog(env.DB),
    ai: env.AI,
    cache: env.CONFIG_CACHE
  });
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

async function runDecisionCommand({ env, user, body, command, suffix = "", maxIterations = 10 }) {
  const caseId = body.case_id || crypto.randomUUID();
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

  const result = await decisionLoop(env).run({
    caseId,
    userGoal,
    maxIterations: body.max_iterations || maxIterations,
    riskState: body.risk_state || "ELEVATED",
    sector: body.sector || "financial_services",
    user,
    entryStage: body.entry_stage || existingCase?.current_stage || 1
  });
  return { caseId, result };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
          return jsonResponse(request, { error: "Invalid login credentials." }, 401);
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
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
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

      if (url.pathname === "/api/policy/check" && request.method === "POST") {
        const authz = requireRole(user, ["admin"]);
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
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
        const result = await gateway(env).executeStage({
          caseId,
          stage: body.stage || 1,
          userGoal: body.user_goal || body.input || "",
          riskState: body.risk_state || "ELEVATED",
          sector: body.sector || "general",
          user
        });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/loop" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
        const body = await readJson(request);
        const caseId = body.case_id || crypto.randomUUID();
        const result = await decisionLoop(env).run({
          caseId,
          userGoal: body.user_goal || body.input || "",
          maxIterations: body.max_iterations || 12,
          riskState: body.risk_state || "ELEVATED",
          sector: body.sector || "general",
          user
        });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/decision/run" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
        const body = await readJson(request);
        console.log("Decision loop triggered", body.case_id || "(new case)");
        const { caseId, result } = await runDecisionCommand({
          env,
          user,
          body,
          command: "run_full_decision_cycle",
          maxIterations: 10
        });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/decision/stress-test" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
        const body = await readJson(request);
        const { caseId, result } = await runDecisionCommand({
          env,
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
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
        const body = await readJson(request);
        const { caseId, result } = await runDecisionCommand({
          env,
          user,
          body,
          command: "challenge_assumptions",
          suffix: "Challenge assumptions and route weak assumptions through forensic re-evaluation.",
          maxIterations: 8
        });
        return jsonResponse(request, { case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/decision/reopen" && request.method === "POST") {
        const authz = requireRole(user, ["analyst", "admin"]);
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
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
        if (!caseState) return jsonResponse(request, { error: "Case not found." }, 404);
        const replay = await new D1AuditLog(env.DB).replaySummary(caseId);
        return jsonResponse(request, { case: caseState, replay });
      }

      const caseEventsMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/events$/);
      if (caseEventsMatch && request.method === "GET") {
        const caseId = decodeURIComponent(caseEventsMatch[1]);
        const caseState = await new D1CaseStore(env.DB).getCase(caseId, { organizationId: user.organization_id });
        if (!caseState) return jsonResponse(request, { error: "Case not found." }, 404);
        const events = await new D1AuditLog(env.DB).replayCase(caseId);
        if (request.headers.get("accept")?.includes("text/event-stream")) {
          return eventStreamResponse(request, events);
        }
        return jsonResponse(request, { case_id: caseId, events });
      }

      const approvalMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === "POST") {
        const authz = requireRole(user, ["executive", "admin"]);
        if (!authz.allowed) return jsonResponse(request, { error: authz.error }, authz.status);
        const body = await readJson(request);
        const result = await gateway(env).decideApproval({
          caseId: decodeURIComponent(approvalMatch[1]),
          approvalId: decodeURIComponent(approvalMatch[2]),
          approved: Boolean(body.approved),
          reviewer: user.email,
          notes: body.notes || ""
        });
        return jsonResponse(request, result, result.status || 200);
      }

      const monitoringMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/monitoring$/);
      if (monitoringMatch && request.method === "POST") {
        const body = await readJson(request);
        const result = await gateway(env).evaluateMonitoring({
          caseId: decodeURIComponent(monitoringMatch[1]),
          failedAssumptions: body.failed_assumptions || [],
          trigger: body.trigger || "assumption_failure"
        });
        return jsonResponse(request, result, result.status || 200);
      }

      return jsonResponse(request, { error: "Not found" }, 404);
    } catch (error) {
      ctx.waitUntil(Promise.resolve(console.error(JSON.stringify({
        event: "worker_error",
        message: error.message,
        path: url.pathname
      }))));
      return jsonResponse(request, { error: error.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(env.CONFIG_CACHE?.put("last_monitoring_tick", new Date().toISOString()));
  }
};
