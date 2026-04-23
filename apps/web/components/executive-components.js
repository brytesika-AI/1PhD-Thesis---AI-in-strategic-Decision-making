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
  const strategy = textFrom(
    state.decision?.recommended_strategy
      || state.narrative?.recommended_action
      || state.recommended_strategy
      || state.blended_analysis?.recommended_strategy,
    "Complete the decision cycle before committing capital or operating changes."
  );
  const executive_verdict = {
    decision: decisionFrom(state),
    strategy,
    confidence: Number(confidenceFrom(state).toFixed(2)),
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
  state.executive_verdict = verdict;
  el("executiveVerdict").innerHTML = `
    <div class="verdict-card">
      <h2>Executive Verdict</h2>
      <div class="verdict-action">${safeHtml(verdict.decision)}</div>
      <div class="card-note">${safeHtml(verdict.strategy)}</div>
    </div>
    <div class="verdict-card">
      <h2>Risk</h2>
      <div class="metric-value">${safeHtml(verdict.risk_level)}</div>
      <div class="card-note">Current board-level exposure.</div>
    </div>
    <div class="verdict-card">
      <h2>Confidence</h2>
      <div class="metric-value">${numberPercent(verdict.confidence)}</div>
      <div class="card-note">Based on evidence, consensus, memory, and simulation.</div>
    </div>
    <div class="verdict-card">
      <h2>Approval</h2>
      <span class="status-pill ${verdict.approval_status.toLowerCase()}">${safeHtml(verdict.approval_status)}</span>
      <div class="card-note">Executive approval is required before closure.</div>
    </div>
    <div class="verdict-card">
      <h2>Owner</h2>
      <div class="metric-value" style="font-size: 22px;">${safeHtml(verdict.owner)}</div>
      <div class="card-note">Accountable decision authority.</div>
    </div>
  `;
}

function renderStrategicNarrative(state = {}) {
  const summary = textFrom(state.narrative?.executive_summary || state.decision?.rationale || state.consensus?.final_rationale, "Run decision preparation to generate a board-ready narrative.");
  const narrative = textFrom(state.narrative?.strategic_narrative, "The narrative will explain the situation, complication, recommended action, and operating guardrails once the decision cycle completes.");
  el("strategicNarrative").innerHTML = `
    <h2>Strategic Narrative</h2>
    <div class="summary-line">${safeHtml(summary)}</div>
    <div class="narrative-text">${safeHtml(narrative)}</div>
  `;
}

function renderDecisionOptions(state = {}) {
  const preferred = state.executive_verdict?.strategy || textFrom(state.blended_analysis?.recommended_strategy);
  const options = asArray(state.options || state.options_generated).slice(0, 3);
  const tradeoffs = state.blended_analysis?.key_tradeoffs || state.narrative?.tradeoffs || [];
  const avoid = asArray(state.objections || state.devil_advocate_findings?.objections).slice(0, 3);
  el("decisionOptions").innerHTML = `
    <h2>Decision Options</h2>
    <div class="grid-3">
      <article class="plain-card">
        <strong>Recommended Path</strong>
        <p>${safeHtml(preferred || "No recommended path has been prepared yet.")}</p>
      </article>
      <article class="plain-card">
        <strong>Alternatives Considered</strong>
        ${listItems(options.map((option) => option.name || option.description || option), "Alternatives will appear after option generation.")}
      </article>
      <article class="plain-card">
        <strong>Trade-offs</strong>
        ${listItems(tradeoffs.length ? tradeoffs : avoid, "Trade-offs will appear once the decision has been challenged.")}
      </article>
    </div>
  `;
}

function renderRiskSimulation(state = {}) {
  const twin = state.digital_twin || {};
  const simulation = state.simulation || {};
  const scenarios = asArray(simulation.simulation_summary);
  const best = textFrom(simulation.best_strategy || state.executive_verdict?.strategy, "Simulation has not selected a path yet.");
  const riskScore = Number.isFinite(Number(simulation.highest_risk_score)) ? simulation.highest_risk_score : twin.risk_state?.score;
  el("riskSimulation").innerHTML = `
    <h2>Simulation + Digital Twin</h2>
    <div class="risk-band">
      <article class="plain-card">
        <strong>Simulation Result</strong>
        <p>${safeHtml(best)}</p>
        <p style="margin-top: 10px;">${safeHtml(scenarios.length ? `${scenarios.length} scenarios tested. Highest risk score: ${riskScore ?? "pending"}.` : "Run simulation to compare likely outcomes before execution.")}</p>
      </article>
      <article class="plain-card">
        <strong>Current Operating State</strong>
        <p>${safeHtml(`Risk is ${riskLevelFrom(state)}${riskScore !== undefined ? ` with score ${riskScore}` : ""}.`)}</p>
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
  const technicalState = {
    case_id: state.case_id,
    status: state.status,
    current_stage: state.current_stage,
    loop: state.loop,
    verification_chain: state.verification_chain,
    approval_gates: state.approval_gates,
    policy_violations: state.policy_violations,
    system_errors: state.system_errors,
    audit_refs: state.audit_refs || state.audit_log_refs,
    audit_events: asArray(state.audit_events).slice(-40)
  };
  const payloads = [
    ["Executive Verdict Mapping", state.executive_verdict || buildExecutiveVerdict(state)],
    ["Decision State", technicalState],
    ["Evidence", state.evidence_bundle || {}],
    ["Framework Selection", state.framework_selection || {}],
    ["Simulation", state.simulation || {}],
    ["Memory", state.shared_memory || state.memory || {}]
  ];
  el("technicalDetails").innerHTML = payloads.map(([title, payload]) => `
    <article>
      <h2>${safeHtml(title)}</h2>
      <pre>${safeHtml(JSON.stringify(payload, null, 2))}</pre>
    </article>
  `).join("");
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
