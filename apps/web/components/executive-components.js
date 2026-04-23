const API_BASE = "https://ai-srf-governance-worker.bryte-sika.workers.dev";

const stages = [
  ["tracker", "Environmental Review"],
  ["induna", "Decision Questions"],
  ["auditor", "Evidence Review"],
  ["innovator", "Options"],
  ["challenger", "Risk Challenge"],
  ["architect", "Execution Plan"],
  ["guardian", "Monitoring"]
];

let activeUser = null;
let activeCase = null;
let lastState = null;
let technicalLoaded = false;

const el = (id) => document.getElementById(id);

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textFrom(value, fallback = "Not available yet.") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  return value.text || value.summary || value.description || value.name || fallback;
}

function numberPercent(value, fallback = "Pending") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return `${Math.round(number * 100)}%`;
}

function confidenceLabel(value, fallback = "Pending") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  if (number <= 1) return numberPercent(number, fallback);
  return `${Math.round(number)} / 100`;
}

function strategyTitle(strategy, fallback = "Complete the decision cycle before committing capital or operating changes.") {
  if (!strategy) return fallback;
  if (typeof strategy === "string") return strategy;
  return strategy.name || strategy.description || fallback;
}

function outcomeFrom(state = {}) {
  return state.outcome || state.decision?.outcome || null;
}

function riskLevelFrom(state = {}) {
  const level = state.simulation?.block_execution
    ? "HIGH"
    : state.digital_twin?.risk_state?.level || state.loop?.risk_state || state.risk_state || "ELEVATED";
  return String(level).toUpperCase();
}

function confidenceFrom(state = {}) {
  const values = [
    state.narrative?.confidence,
    state.blended_analysis?.confidence,
    state.consensus?.confidence,
    state.organizational_intelligence?.confidence,
    state.simulation?.simulation_summary?.[0]?.outcome?.success_probability
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return Math.min(0.95, Math.max(0.35, values.reduce((total, value) => total + value, 0) / values.length));
}

function latestApprovalGate(state = {}) {
  return [...asArray(state.approval_gates)].reverse().find((gate) => gate.status === "pending")
    || [...asArray(state.approval_gates)].reverse().find((gate) => gate.status === "approved" || gate.status === "rejected")
    || null;
}

function approvalStatusFrom(state = {}) {
  const gate = latestApprovalGate(state);
  if (gate?.status === "approved") return "APPROVED";
  if (gate?.status === "rejected") return "REJECTED";
  return "PENDING";
}

function decisionFrom(state = {}) {
  if (state.simulation?.block_execution) return "DELAY";
  if (state.status === "critical_failure" || state.loop?.stop_reason === "critical_tool_failure") return "REJECT";
  if (state.status === "escalation_required" || state.loop?.stop_reason === "human_approval_required") return "DELAY";
  if (state.decision?.recommended_strategy || state.recommended_strategy || state.blended_analysis?.recommended_strategy) return "PROCEED";
  return "DELAY";
}

function buildExecutiveVerdict(state = {}) {
  const gate = latestApprovalGate(state);
  const outcome = outcomeFrom(state);
  const strategy = textFrom(
    strategyTitle(outcome?.recommended_strategy, "")
      || strategyTitle(state.decision?.recommended_strategy, "")
      || state.narrative?.recommended_action
      || state.recommended_strategy
      || state.blended_analysis?.recommended_strategy,
    "Complete the decision cycle before committing capital or operating changes."
  );
  const executive_verdict = {
    decision: decisionFrom(state),
    strategy,
    confidence: Number((outcome?.confidence ?? confidenceFrom(state)).toFixed ? (outcome?.confidence ?? confidenceFrom(state)).toFixed(2) : outcome?.confidence ?? confidenceFrom(state)),
    risk_level: riskLevelFrom(state),
    approval_required: true,
    approval_status: approvalStatusFrom(state),
    owner: state.organization_name || activeUser?.organization_name || activeUser?.email || "Board decision owner"
  };
  return { ...executive_verdict, approval_gate: gate };
}

function canRun() {
  return activeUser?.role === "analyst" || activeUser?.role === "admin";
}

function canApprove() {
  return activeUser?.role === "executive" || activeUser?.role === "admin";
}

function applyRoleGates() {
  const allowed = canRun();
  for (const id of ["runGovernedCycle", "runSimulation", "stressTest", "challengeAssumptions", "reopenCase"]) {
    el(id).disabled = !allowed;
  }
  el("runGovernedCycle").title = allowed ? "Prepare the decision for executive approval." : "Only analysts and admins can prepare a decision.";
}

function safeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function listItems(items, fallback) {
  const values = asArray(items).map((item) => textFrom(item, "")).filter(Boolean).slice(0, 4);
  if (!values.length) return `<p>${safeHtml(fallback)}</p>`;
  return `<ul class="clean">${values.map((item) => `<li>${safeHtml(item)}</li>`).join("")}</ul>`;
}

function renderExecutiveVerdict(state = {}) {
  const verdict = buildExecutiveVerdict(state);
  const outcome = outcomeFrom(state);
  const alternatives = asArray(outcome?.ranked_strategies).slice(1, 3).map((item) => strategyTitle(item.strategy, ""));
  state.executive_verdict = verdict;
  el("executiveVerdict").innerHTML = `
    <div class="verdict-card">
      <h2>Best Validated Strategy</h2>
      <div class="verdict-action">${safeHtml(verdict.decision)}</div>
      <div class="card-note">${safeHtml(verdict.strategy)}</div>
    </div>
    <div class="verdict-card">
      <h2>Why</h2>
      <div class="card-note">${safeHtml(outcome?.validation_summary || state.decision?.rationale || "Validation summary will appear after the outcome engine runs.")}</div>
    </div>
    <div class="verdict-card">
      <h2>Confidence</h2>
      <div class="metric-value">${confidenceLabel(verdict.confidence)}</div>
      <div class="card-note">Outcome-engine confidence in the validated decision.</div>
    </div>
    <div class="verdict-card">
      <h2>Alternatives</h2>
      ${listItems(alternatives, "Top alternatives will appear after at least three strategies are validated.")}
    </div>
    <div class="verdict-card">
      <h2>System Learning Insight</h2>
      <div class="card-note">${safeHtml(outcome?.system_learning_insight || state.system_learning_insight || "Outcome feedback has not produced a private learning signal yet.")}</div>
    </div>
    <div class="verdict-card">
      <h2>Global Intelligence Insight</h2>
      <div class="card-note">${safeHtml(outcome?.global_intelligence_insight || state.global_intelligence_insight || "No anonymized cross-organization insight has influenced this decision yet.")}</div>
    </div>
  `;
}

function renderStrategicNarrative(state = {}) {
  const outcome = outcomeFrom(state);
  const summary = textFrom(outcome?.validation_summary || state.decision?.rationale || state.narrative?.executive_summary, "Run decision preparation to generate a validated strategic recommendation.");
  const narrative = textFrom(strategyTitle(outcome?.recommended_strategy, "") || state.narrative?.strategic_narrative, "The outcome engine will return the best validated decision once the full loop completes.");
  el("strategicNarrative").innerHTML = `
    <h2>Validated Decision</h2>
    <div class="summary-line">${safeHtml(summary)}</div>
    <div class="narrative-text">${safeHtml(narrative)}</div>
  `;
}

function renderDecisionOptions(state = {}) {
  const outcome = outcomeFrom(state);
  const preferred = strategyTitle(outcome?.recommended_strategy, state.executive_verdict?.strategy || textFrom(state.blended_analysis?.recommended_strategy));
  const options = asArray(outcome?.ranked_strategies).slice(1, 3).map((item) => item.strategy).filter(Boolean);
  el("decisionOptions").innerHTML = `
    <h2>Outcome Engine</h2>
    <div class="grid-3">
      <article class="plain-card">
        <strong>Best Validated Strategy</strong>
        <p>${safeHtml(preferred || "No recommended path has been prepared yet.")}</p>
      </article>
      <article class="plain-card">
        <strong>Alternatives</strong>
        ${listItems(options.map((option) => option.name || option.description || option), "Alternatives will appear after validation.")}
      </article>
      <article class="plain-card">
        <strong>Decision Ownership</strong>
        <p>${safeHtml("The system has selected the validated decision, learned from prior outcomes, and applied anonymized global intelligence where available.")}</p>
      </article>
    </div>
  `;
}

function renderRiskSimulation(state = {}) {
  const twin = state.digital_twin || {};
  const outcome = outcomeFrom(state);
  const best = strategyTitle(outcome?.recommended_strategy, state.executive_verdict?.strategy || "Simulation has not selected a path yet.");
  el("riskSimulation").innerHTML = `
    <h2>Simulation + Digital Twin</h2>
    <div class="risk-band">
      <article class="plain-card">
        <strong>Validated Result</strong>
        <p>${safeHtml(best)}</p>
        <p style="margin-top: 10px;">${safeHtml(outcome ? `${outcome.strategies_tested} strategies generated, simulated, validated, scored, and ranked.` : "Run the decision cycle to generate, simulate, validate, score, and rank strategies.")}</p>
      </article>
      <article class="plain-card">
        <strong>Current Operating State</strong>
        <p>${safeHtml(`Risk is ${riskLevelFrom(state)}.`)}</p>
        <p style="margin-top: 10px;">${safeHtml(twin.last_updated ? `Last updated ${twin.last_updated}.` : "Digital twin state has not been loaded yet.")}</p>
      </article>
    </div>
  `;
}

function renderGovernanceControls(state = {}) {
  const verdict = state.executive_verdict || buildExecutiveVerdict(state);
  const hasPendingGate = verdict.approval_gate?.status === "pending";
  const approvalDisabled = !canApprove() || !hasPendingGate;
  const statusText = hasPendingGate
    ? "A pending approval gate is ready for executive decision."
    : verdict.approval_status === "APPROVED"
      ? "This recommendation has been approved."
      : "No server approval gate is currently open; the presentation remains pending until approval is issued.";
  el("governanceControls").innerHTML = `
    <h2>Governance Controls</h2>
    <div class="grid-3">
      <article class="plain-card">
        <strong>Approval Status</strong>
        <p>${safeHtml(statusText)}</p>
      </article>
      <article class="plain-card">
        <strong>Decision Rights</strong>
        <p>${safeHtml(canApprove() ? "You can approve or reject pending recommendations." : "Your role can review this recommendation but cannot approve it.")}</p>
      </article>
      <article class="plain-card">
        <strong>Audit Position</strong>
        <p>${safeHtml(asArray(state.audit_refs || state.audit_log_refs).length ? "A replayable audit trail is available in technical details." : "Audit trace will appear after the decision runs.")}</p>
      </article>
    </div>
    <div class="commands" style="grid-template-columns: repeat(2, minmax(160px, 240px));">
      <button class="approval approve" id="approveDecision" type="button" ${approvalDisabled ? "disabled" : ""}>Approve</button>
      <button class="approval reject" id="rejectDecision" type="button" ${approvalDisabled ? "disabled" : ""}>Reject</button>
    </div>
  `;
  el("approveDecision").addEventListener("click", () => decideApproval(true));
  el("rejectDecision").addEventListener("click", () => decideApproval(false));
}

function renderTechnicalDrawer(state = {}) {
  if (!technicalLoaded) return;
  const outcome = outcomeFrom(state);
  el("technicalDetails").innerHTML = `
    <article>
      <h2>Outcome Engine Status</h2>
      <p>${safeHtml(outcome ? "The decision has been generated, simulated, validated, scored, and ranked." : "Outcome validation has not completed yet.")}</p>
    </article>
  `;
}

function renderState(state = {}) {
  renderExecutiveVerdict(state);
  renderStrategicNarrative(state);
  renderDecisionOptions(state);
  renderRiskSimulation(state);
  renderGovernanceControls(state);
  renderTechnicalDrawer(state);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`HTTP ${response.status}: API returned non-JSON.`);
  }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function loadMe() {
  try {
    const result = await fetchJson("/api/auth/me", { method: "GET" });
    activeUser = result.user;
    el("userName").textContent = `${activeUser.email} (${activeUser.role})`;
    el("orgName").textContent = activeUser.organization_name || activeUser.organization_id;
    el("loginScreen").classList.add("hidden");
    el("appShell").classList.remove("hidden");
    applyRoleGates();
    const twin = await fetchJson("/api/digital-twin", { method: "GET" }).catch(() => null);
    lastState = { ...(lastState || {}), digital_twin: twin?.digital_twin || null };
    renderState(lastState);
  } catch {
    el("loginScreen").classList.remove("hidden");
    el("appShell").classList.add("hidden");
  }
}

function commandPayload(extra = {}) {
  const caseId = activeCase || crypto.randomUUID();
  activeCase = caseId;
  return {
    case_id: caseId,
    entry_stage: Number(el("stage").value),
    user_goal: el("goal").value,
    risk_state: "ELEVATED",
    sector: "financial_services",
    ...extra
  };
}

async function loadEvents(caseId) {
  if (!technicalLoaded || !caseId) return;
  const result = await fetchJson(`/api/cases/${encodeURIComponent(caseId)}/events`, { method: "GET" });
  lastState = {
    ...(lastState || {}),
    audit_events: result.events || []
  };
  renderTechnicalDrawer(lastState);
}

async function executeCommand(endpoint, buttonId, label, extra = {}) {
  const button = el(buttonId);
  if (!canRun()) return;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span>${safeHtml(label)}`;
  try {
    const result = await fetchJson(endpoint, {
      method: "POST",
      body: JSON.stringify(commandPayload(extra))
    });
    lastState = result.case_state || result.result?.case_state || lastState || {};
    lastState.executive_verdict = buildExecutiveVerdict(lastState);
    renderState(lastState);
    await loadEvents(activeCase);
  } catch (error) {
    lastState = {
      ...(lastState || {}),
      narrative: {
        executive_summary: "Execution failed before a reliable decision could be prepared.",
        strategic_narrative: error.message
      }
    };
    renderState(lastState);
  } finally {
    button.textContent = label;
    applyRoleGates();
  }
}

async function runGovernedDecisionCycle() {
  const caseId = activeCase || crypto.randomUUID();
  activeCase = caseId;
  await executeCommand("/api/decision/run", "runGovernedCycle", "Run Decision Preparation", {
    case_id: caseId,
    max_iterations: 10
  });
}

async function decideApproval(approved) {
  const gate = latestApprovalGate(lastState || {});
  if (!activeCase || gate?.status !== "pending") return;
  try {
    const desiredPath = approved ? "/api/decision/approve" : "/api/decision/reject";
    const body = { case_id: activeCase, approval_id: gate.approval_id, approved };
    let result = null;
    try {
      result = await fetchJson(desiredPath, { method: "POST", body: JSON.stringify(body) });
    } catch {
      result = await fetchJson(`/api/cases/${encodeURIComponent(activeCase)}/approvals/${encodeURIComponent(gate.approval_id)}`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          notes: approved ? "Approved from executive command center." : "Rejected from executive command center."
        })
      });
    }
    lastState = result.case_state || lastState;
    lastState.executive_verdict = buildExecutiveVerdict(lastState);
    renderState(lastState);
    await loadEvents(activeCase);
  } catch (error) {
    lastState = {
      ...(lastState || {}),
      narrative: {
        ...(lastState?.narrative || {}),
        executive_summary: "Approval decision could not be recorded.",
        strategic_narrative: error.message
      }
    };
    renderState(lastState);
  }
}

function initializeStages() {
  for (const [, label] of stages) {
    const option = document.createElement("option");
    option.value = String(el("stage").children.length + 1);
    option.textContent = label;
    el("stage").appendChild(option);
  }
}

el("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    email: el("email").value,
    role: el("role").value,
    organization_id: el("organizationId").value,
    organization_name: el("organizationName").value,
    passcode: el("passcode").value
  };
  await fetchJson("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
  await loadMe();
});

el("logoutButton").addEventListener("click", async () => {
  await fetchJson("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
  activeUser = null;
  activeCase = null;
  lastState = null;
  technicalLoaded = false;
  el("loginScreen").classList.remove("hidden");
  el("appShell").classList.add("hidden");
});

el("runGovernedCycle").addEventListener("click", runGovernedDecisionCycle);
el("runSimulation").addEventListener("click", () => executeCommand("/api/decision/simulate", "runSimulation", "Simulate", { max_iterations: 12, simulation_mode_enabled: true }));
el("stressTest").addEventListener("click", () => executeCommand("/api/decision/stress-test", "stressTest", "Stress Test", { max_iterations: 8 }));
el("challengeAssumptions").addEventListener("click", () => executeCommand("/api/decision/challenge-assumptions", "challengeAssumptions", "Challenge", { max_iterations: 8 }));
el("reopenCase").addEventListener("click", () => executeCommand("/api/decision/reopen", "reopenCase", "Re-open"));
el("technicalDrawer").addEventListener("toggle", async () => {
  if (el("technicalDrawer").open && !technicalLoaded) {
    technicalLoaded = true;
    renderTechnicalDrawer(lastState || {});
    await loadEvents(activeCase);
  }
});

initializeStages();
renderState({});
loadMe();
