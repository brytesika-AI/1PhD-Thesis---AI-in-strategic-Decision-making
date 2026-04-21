import { D1AuditLog } from "../../../packages/audit/d1-audit-log.js";
import { OrchestrationGateway } from "../../../packages/core/orchestration-gateway.js";
import { DecisionLoop } from "../../../packages/loop/decision-loop.js";
import { PolicyEngine } from "../../../packages/policy/policy-engine.js";
import { listAgents, listAllAgents, listControlAgents, validateAgentRegistry } from "../../../packages/shared/agent-registry.js";
import { listToolDefinitions } from "../../../packages/skills/index.js";
import { D1CaseStore } from "../../../packages/state/d1-case-store.js";
import { agentRegistry } from "./config/agents.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
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
    ai: env.AI
  });
}

function decisionLoop(env) {
  const registryDocument = validateAgentRegistry(agentRegistry);
  return new DecisionLoop({
    registryDocument,
    caseStore: new D1CaseStore(env.DB),
    auditLog: new D1AuditLog(env.DB),
    ai: env.AI
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return jsonResponse({
          status: "operational",
          platform: "cloudflare",
          production_target: "Cloudflare Workers",
          storage: ["D1", "KV", "R2-ready"],
          agents: listAllAgents(agentRegistry).length,
          runtime: "stateful_agent_loop"
        });
      }

      if (url.pathname === "/api/agents" && request.method === "GET") {
        return jsonResponse({
          pipeline_agents: listAgents(agentRegistry),
          control_agents: listControlAgents(agentRegistry),
          agents: listAllAgents(agentRegistry)
        });
      }

      if (url.pathname === "/api/tools" && request.method === "GET") {
        return jsonResponse({ tools: listToolDefinitions() });
      }

      if (url.pathname === "/api/policy/check" && request.method === "POST") {
        const body = await readJson(request);
        const policy = new PolicyEngine(agentRegistry);
        return jsonResponse(policy.buildToolPolicyCheck(body.agent_id, body.tool_name));
      }

      if (url.pathname === "/api/cases" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 20);
        const cases = await new D1CaseStore(env.DB).listCases(limit);
        return jsonResponse({ cases });
      }

      if (url.pathname === "/api/orchestrate" && request.method === "POST") {
        const body = await readJson(request);
        const caseId = body.case_id || crypto.randomUUID();
        const result = await gateway(env).executeStage({
          caseId,
          stage: body.stage || 1,
          userGoal: body.user_goal || body.input || "",
          riskState: body.risk_state || "ELEVATED",
          sector: body.sector || "general"
        });
        return jsonResponse({ case_id: caseId, ...result }, result.status || 200);
      }

      if (url.pathname === "/api/loop" && request.method === "POST") {
        const body = await readJson(request);
        const caseId = body.case_id || crypto.randomUUID();
        const result = await decisionLoop(env).run({
          caseId,
          userGoal: body.user_goal || body.input || "",
          maxIterations: body.max_iterations || 12,
          riskState: body.risk_state || "ELEVATED",
          sector: body.sector || "general"
        });
        return jsonResponse({ case_id: caseId, ...result }, result.status || 200);
      }

      const caseReplayMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/replay$/);
      if (caseReplayMatch && request.method === "GET") {
        const caseId = decodeURIComponent(caseReplayMatch[1]);
        const caseState = await new D1CaseStore(env.DB).getCase(caseId);
        const replay = await new D1AuditLog(env.DB).replaySummary(caseId);
        return jsonResponse({ case: caseState, replay });
      }

      const approvalMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === "POST") {
        const body = await readJson(request);
        const result = await gateway(env).decideApproval({
          caseId: decodeURIComponent(approvalMatch[1]),
          approvalId: decodeURIComponent(approvalMatch[2]),
          approved: Boolean(body.approved),
          reviewer: body.reviewer || "human",
          notes: body.notes || ""
        });
        return jsonResponse(result, result.status || 200);
      }

      const monitoringMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/monitoring$/);
      if (monitoringMatch && request.method === "POST") {
        const body = await readJson(request);
        const result = await gateway(env).evaluateMonitoring({
          caseId: decodeURIComponent(monitoringMatch[1]),
          failedAssumptions: body.failed_assumptions || [],
          trigger: body.trigger || "assumption_failure"
        });
        return jsonResponse(result, result.status || 200);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      ctx.waitUntil(Promise.resolve(console.error(JSON.stringify({
        event: "worker_error",
        message: error.message,
        path: url.pathname
      }))));
      return jsonResponse({ error: error.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(env.CONFIG_CACHE?.put("last_monitoring_tick", new Date().toISOString()));
  }
};
