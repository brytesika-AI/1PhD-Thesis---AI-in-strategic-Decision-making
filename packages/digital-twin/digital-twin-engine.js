import { D1AuditLog } from "../audit/d1-audit-log.js";

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function nowIso() {
  return new Date().toISOString();
}

function ensureOrganizationId(organizationId) {
  const value = String(organizationId || "").trim();
  if (!value) throw new Error("organization_id is required for digital twin updates.");
  return value;
}

async function safeFetchJson(url, fallback, { timeoutMs = 2500 } = {}) {
  if (!url || typeof fetch !== "function") return fallback;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

export async function fetch_load_shedding_data(env = {}, { organizationId } = {}) {
  const fallback = {
    source: "mock",
    organization_id: organizationId,
    country: "ZA",
    provider: "Eskom",
    stage: Number(env.MOCK_LOAD_SHEDDING_STAGE || 2),
    status: "active",
    confidence: 0.72,
    observed_at: nowIso()
  };
  const data = await safeFetchJson(env.LOAD_SHEDDING_API_URL, fallback);
  return {
    ...fallback,
    ...data,
    stage: Number(data.stage ?? fallback.stage),
    observed_at: data.observed_at || data.timestamp || fallback.observed_at
  };
}

export async function fetch_market_data(env = {}, { organizationId } = {}) {
  const fallback = {
    source: "mock",
    organization_id: organizationId,
    sector: "financial_services",
    volatility_index: Number(env.MOCK_MARKET_VOLATILITY || 0.42),
    zar_usd: Number(env.MOCK_ZAR_USD || 18.4),
    liquidity_signal: "stable",
    confidence: 0.68,
    observed_at: nowIso()
  };
  const data = await safeFetchJson(env.MARKET_DATA_API_URL, fallback);
  return {
    ...fallback,
    ...data,
    volatility_index: Number(data.volatility_index ?? fallback.volatility_index),
    zar_usd: Number(data.zar_usd ?? fallback.zar_usd),
    observed_at: data.observed_at || data.timestamp || fallback.observed_at
  };
}

export async function fetch_system_metrics(env = {}, { organizationId } = {}) {
  const fallback = {
    source: "mock",
    organization_id: organizationId,
    uptime_pct: Number(env.MOCK_UPTIME_PCT || 99.2),
    cpu_load_pct: Number(env.MOCK_CPU_LOAD_PCT || 58),
    queue_depth: Number(env.MOCK_QUEUE_DEPTH || 12),
    incident_count: Number(env.MOCK_INCIDENT_COUNT || 0),
    confidence: 0.76,
    observed_at: nowIso()
  };
  const data = await safeFetchJson(env.SYSTEM_METRICS_API_URL, fallback);
  return {
    ...fallback,
    ...data,
    uptime_pct: Number(data.uptime_pct ?? fallback.uptime_pct),
    cpu_load_pct: Number(data.cpu_load_pct ?? fallback.cpu_load_pct),
    queue_depth: Number(data.queue_depth ?? fallback.queue_depth),
    incident_count: Number(data.incident_count ?? fallback.incident_count),
    observed_at: data.observed_at || data.timestamp || fallback.observed_at
  };
}

export async function fetch_regulatory_updates(env = {}, { organizationId } = {}) {
  const fallback = {
    source: "mock",
    organization_id: organizationId,
    jurisdiction: "ZA",
    updates: [
      { topic: "POPIA", severity: "medium", summary: "Privacy evidence trail remains required." },
      { topic: "King IV", severity: "medium", summary: "Board accountability and auditability remain active controls." }
    ],
    confidence: 0.7,
    observed_at: nowIso()
  };
  const data = await safeFetchJson(env.REGULATORY_UPDATES_API_URL, fallback);
  return {
    ...fallback,
    ...data,
    updates: Array.isArray(data.updates) ? data.updates : fallback.updates,
    observed_at: data.observed_at || data.timestamp || fallback.observed_at
  };
}

function regulatoryScore(updates = []) {
  return updates.reduce((score, update) => {
    if (update.severity === "critical") return score + 0.25;
    if (update.severity === "high") return score + 0.18;
    if (update.severity === "medium") return score + 0.08;
    return score + 0.03;
  }, 0);
}

export function computeRiskState({ loadShedding = {}, market = {}, system = {}, regulatory = {}, decisionState = {} }) {
  const signals = [];
  const loadStage = Number(loadShedding.stage || 0);
  if (loadStage >= 1) signals.push({ name: "load_shedding", value: loadStage, severity: loadStage >= 5 ? "critical" : loadStage >= 3 ? "high" : "medium" });
  if (Number(system.cpu_load_pct || 0) >= 75) signals.push({ name: "system_load", value: system.cpu_load_pct, severity: Number(system.cpu_load_pct) >= 90 ? "critical" : "high" });
  if (Number(system.incident_count || 0) > 0) signals.push({ name: "incidents", value: system.incident_count, severity: "high" });
  if (Number(market.volatility_index || 0) >= 0.5) signals.push({ name: "market_volatility", value: market.volatility_index, severity: "medium" });
  for (const update of regulatory.updates || []) {
    if (["high", "critical"].includes(update.severity)) {
      signals.push({ name: `regulatory_${update.topic || "update"}`, value: update.summary || update.severity, severity: update.severity });
    }
  }

  const score = clamp(
    loadStage * 0.1 +
      Number(system.cpu_load_pct || 0) / 500 +
      Number(system.incident_count || 0) * 0.08 +
      Number(market.volatility_index || 0) * 0.18 +
      regulatoryScore(regulatory.updates || []) +
      (decisionState?.last_outcome === "failure" ? 0.12 : 0)
  );
  const level = score >= 0.75 ? "critical" : score >= 0.55 ? "high" : score >= 0.32 ? "medium" : "low";
  return {
    level,
    score: Number(score.toFixed(2)),
    signals,
    computed_at: nowIso()
  };
}

function buildTwinState({ organizationId, inputs, previous = {}, decisionState = null }) {
  const previousState = previous || {};
  const environmentState = {
    load_shedding: inputs.loadShedding,
    market: inputs.market,
    regulatory: inputs.regulatory
  };
  const operationalState = {
    system_metrics: inputs.system,
    service_health: Number(inputs.system.uptime_pct || 0) >= 99 ? "stable" : "watch",
    capacity_pressure: Number(inputs.system.cpu_load_pct || 0) >= 75 || Number(inputs.system.queue_depth || 0) >= 100 ? "elevated" : "normal"
  };
  const nextDecisionState = {
    ...(previousState.decision_state || {}),
    ...(decisionState || {})
  };
  const riskState = computeRiskState({
    loadShedding: inputs.loadShedding,
    market: inputs.market,
    system: inputs.system,
    regulatory: inputs.regulatory,
    decisionState: nextDecisionState
  });
  return {
    organization_id: organizationId,
    timestamp: nowIso(),
    environment_state: environmentState,
    operational_state: operationalState,
    risk_state: riskState,
    decision_state: nextDecisionState,
    last_updated: nowIso()
  };
}

async function listOrganizationIds(env = {}, explicitOrganizationId = null) {
  if (explicitOrganizationId) return [ensureOrganizationId(explicitOrganizationId)];
  if (!env.DB) return [env.DEFAULT_ORGANIZATION_ID || "default-org"];
  try {
    const result = await env.DB
      .prepare("SELECT DISTINCT organization_id FROM users WHERE organization_id IS NOT NULL ORDER BY organization_id")
      .all();
    const ids = (result.results || []).map((row) => row.organization_id).filter(Boolean);
    return ids.length ? ids : [env.DEFAULT_ORGANIZATION_ID || "default-org"];
  } catch {
    return [env.DEFAULT_ORGANIZATION_ID || "default-org"];
  }
}

export async function getLatestTwinState(env = {}, { organizationId } = {}) {
  const scopedOrg = ensureOrganizationId(organizationId || env.DEFAULT_ORGANIZATION_ID || "default-org");
  if (!env.DB) return null;
  const row = await env.DB
    .prepare(
      `SELECT organization_id, timestamp, environment_state, operational_state, risk_state, decision_state, last_updated
       FROM digital_twin_state
       WHERE organization_id = ?
       ORDER BY last_updated DESC
       LIMIT 1`
    )
    .bind(scopedOrg)
    .first();
  if (!row) return null;
  return {
    organization_id: row.organization_id,
    timestamp: row.timestamp,
    environment_state: parseJson(row.environment_state, {}),
    operational_state: parseJson(row.operational_state, {}),
    risk_state: parseJson(row.risk_state, {}),
    decision_state: parseJson(row.decision_state, {}),
    last_updated: row.last_updated
  };
}

export async function persistTwinState(env = {}, twinState) {
  const organizationId = ensureOrganizationId(twinState?.organization_id);
  await env.DB
    .prepare(
      `INSERT INTO digital_twin_state
        (organization_id, timestamp, environment_state, operational_state, risk_state, decision_state, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      organizationId,
      twinState.timestamp,
      JSON.stringify(twinState.environment_state || {}),
      JSON.stringify(twinState.operational_state || {}),
      JSON.stringify(twinState.risk_state || {}),
      JSON.stringify(twinState.decision_state || {}),
      twinState.last_updated
    )
    .run();
  return twinState;
}

async function auditTwinUpdate(env = {}, twinState, action = "digital_twin_updated") {
  if (!env.DB) return null;
  return new D1AuditLog(env.DB).logEvent({
    event_type: action,
    case_id: `digital-twin:${twinState.organization_id}`,
    agent_id: "digital_twin_engine",
    input_summary: "Digital twin state update.",
    output_summary: `Risk level: ${twinState.risk_state?.level || "unknown"}`,
    tools_used: [
      "fetch_load_shedding_data",
      "fetch_market_data",
      "fetch_system_metrics",
      "fetch_regulatory_updates"
    ],
    model_used: "digital-twin-engine",
    raw_payload: {
      organization_id: twinState.organization_id,
      risk_state: twinState.risk_state,
      last_updated: twinState.last_updated
    }
  });
}

export async function updateDigitalTwin(env = {}, options = {}) {
  const organizationIds = await listOrganizationIds(env, options.organizationId);
  const updated = [];
  for (const organizationId of organizationIds) {
    const previous = await getLatestTwinState(env, { organizationId });
    const [loadShedding, market, system, regulatory] = await Promise.all([
      fetch_load_shedding_data(env, { organizationId }),
      fetch_market_data(env, { organizationId }),
      fetch_system_metrics(env, { organizationId }),
      fetch_regulatory_updates(env, { organizationId })
    ]);
    const twinState = buildTwinState({
      organizationId,
      previous,
      inputs: { loadShedding, market, system, regulatory },
      decisionState: options.decisionState || null
    });
    await persistTwinState(env, twinState);
    await auditTwinUpdate(env, twinState);
    updated.push(twinState);
  }
  return { updated };
}

export function simulateDigitalTwinScenario(twinState = {}, scenario = {}) {
  const simulated = JSON.parse(JSON.stringify(twinState || {}));
  const loadShedding = simulated.environment_state?.load_shedding || {};
  const market = simulated.environment_state?.market || {};
  const regulatory = simulated.environment_state?.regulatory || {};
  const systemMetrics = simulated.operational_state?.system_metrics || {};
  loadShedding.stage = Math.max(0, Number(loadShedding.stage || 0) + Number(scenario.load_shedding_stage_delta || 0));
  systemMetrics.cpu_load_pct = Math.min(100, Number(systemMetrics.cpu_load_pct || 0) + Number(scenario.system_load_delta || 0));
  systemMetrics.queue_depth = Math.max(0, Number(systemMetrics.queue_depth || 0) + Number(scenario.queue_depth_delta || 0));
  simulated.environment_state = { ...(simulated.environment_state || {}), load_shedding: loadShedding };
  simulated.operational_state = {
    ...(simulated.operational_state || {}),
    system_metrics: systemMetrics,
    simulated: true,
    scenario
  };
  simulated.risk_state = computeRiskState({
    loadShedding,
    market,
    system: systemMetrics,
    regulatory,
    decisionState: simulated.decision_state || {}
  });
  simulated.last_updated = nowIso();
  return simulated;
}

export async function updateTwinWithDecisionOutcome(env = {}, { organizationId, caseState = {}, outcome = "success" } = {}) {
  const scopedOrg = ensureOrganizationId(organizationId || caseState.organization_id || env.DEFAULT_ORGANIZATION_ID || "default-org");
  const previous = await getLatestTwinState(env, { organizationId: scopedOrg });
  const baseline = previous || (await updateDigitalTwin(env, { organizationId: scopedOrg })).updated[0];
  const decisionState = {
    ...(baseline.decision_state || {}),
    last_case_id: caseState.case_id || null,
    last_outcome: outcome,
    last_stop_reason: caseState.loop?.stop_reason || null,
    last_consensus_level: caseState.consensus?.level || "unknown",
    updated_from_decision_at: nowIso()
  };
  const twinState = {
    ...baseline,
    timestamp: nowIso(),
    decision_state: decisionState,
    operational_state: {
      ...(baseline.operational_state || {}),
      last_decision_feedback: {
        case_id: caseState.case_id || null,
        outcome,
        status: caseState.status,
        stop_reason: caseState.loop?.stop_reason || null
      }
    },
    risk_state: computeRiskState({
      loadShedding: baseline.environment_state?.load_shedding || {},
      market: baseline.environment_state?.market || {},
      system: baseline.operational_state?.system_metrics || {},
      regulatory: baseline.environment_state?.regulatory || {},
      decisionState
    }),
    last_updated: nowIso()
  };
  await persistTwinState(env, twinState);
  await auditTwinUpdate(env, twinState, "digital_twin_feedback_updated");
  return twinState;
}
