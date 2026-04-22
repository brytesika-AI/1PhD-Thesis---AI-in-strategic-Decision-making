function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function sentenceList(items = [], limit = 3) {
  return asArray(items)
    .map((item) => item.text || item.summary || item.implication || item)
    .filter(Boolean)
    .slice(0, limit);
}

function confidenceFrom(state = {}) {
  const values = [
    state.blended_analysis?.confidence,
    state.simulation?.simulation_summary?.[0]?.outcome?.success_probability,
    state.organizational_intelligence?.confidence,
    state.consensus?.confidence
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const confidence = values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0.72;
  return Number(Math.min(0.95, Math.max(0.45, confidence)).toFixed(2));
}

function modeDetail(mode = "board") {
  if (mode === "technical") {
    return {
      audience: "technical",
      detail: "deeper explanation",
      maxInsights: 5
    };
  }
  if (mode === "executive") {
    return {
      audience: "executive",
      detail: "slightly detailed",
      maxInsights: 4
    };
  }
  return {
    audience: "board",
    detail: "concise, high-level",
    maxInsights: 3
  };
}

export function buildStrategicNarrativePrompt(state = {}) {
  return `
You are a senior McKinsey partner presenting to a board.

Produce a strategic narrative using:

1. Start with the recommendation
2. Use Situation-Complication-Resolution
3. Use 3 MECE arguments
4. Be concise, executive-level

Inputs:
${JSON.stringify(state)}

Return JSON only.
`;
}

export function generateStrategicNarrative(state = {}, mode = state.narrative_mode || "board") {
  const audience = modeDetail(mode);
  const blended = state.blended_analysis || state.blended_frameworks || {};
  const simulation = state.simulation || state.simulation_results || {};
  const twin = state.digital_twin || state.digital_twin_state || {};
  const riskState = state.risk_state || state.loop?.risk_state || twin.risk_state?.level || "elevated";
  const recommendedStrategy = compact(
    state.decision?.recommended_strategy ||
      state.recommended_strategy ||
      simulation.best_strategy ||
      blended.recommended_strategy,
    "Proceed with a staged governed strategy under active monitoring."
  );
  const topRisks = sentenceList(blended.top_risks || simulation.simulation_summary?.flatMap((item) => item.outcome?.key_failures || []), audience.maxInsights);
  const topOpportunities = sentenceList(blended.top_opportunities, audience.maxInsights);
  const tradeoffs = sentenceList(blended.key_tradeoffs, audience.maxInsights);
  const twinLevel = twin.risk_state?.level || riskState;
  const simulationSignal = simulation.highest_risk_score !== undefined
    ? `Simulation tested ${asArray(simulation.simulation_summary).length} scenarios; highest risk score was ${simulation.highest_risk_score}.`
    : "Simulation evidence is not yet available.";
  const contributors = asArray(blended.framework_contributors).length
    ? asArray(blended.framework_contributors).join(", ")
    : "structured strategic frameworks";

  const executiveSummary = [
    `Recommendation: ${recommendedStrategy}`,
    `The current operating context is ${twinLevel}, with the digital twin showing board-relevant environment and operational signals.`,
    `${simulationSignal}`,
    `The decision should move forward only through the controls, milestones, and tradeoffs surfaced by ${contributors}.`
  ].slice(0, mode === "board" ? 4 : 5).join(" ");

  const situation = `Situation: AI_SRF has evaluated the decision using ${contributors}, organizational memory, and the current digital twin state.`;
  const complication = `Complication: the principal risks are ${topRisks.length ? topRisks.join("; ") : "execution uncertainty, compliance exposure, and operational resilience pressure"}.`;
  const resolution = `Resolution: ${recommendedStrategy}`;
  const justification = `Justification: the blended analysis highlights ${topOpportunities.length ? topOpportunities.join("; ") : "controlled strategic upside"}, while simulation and risk scoring define the execution guardrails.`;
  const outlook = `Future outlook: the decision should remain adaptive as monitoring signals, simulation outcomes, and organizational learning update the risk posture.`;

  return {
    executive_summary: executiveSummary,
    strategic_narrative: [situation, complication, resolution, justification, outlook].join(" "),
    key_insights: [
      `Framework blend: ${contributors}.`,
      `Digital twin risk level: ${twinLevel}.`,
      simulationSignal,
      `Audience mode: ${audience.audience} (${audience.detail}).`
    ].slice(0, audience.maxInsights + 1),
    risks: topRisks,
    tradeoffs,
    recommended_action: recommendedStrategy,
    implementation_story: `The decision unfolds as a governed sequence: confirm approval gates, execute the first milestone, monitor digital twin risk signals, and adjust when simulation or operational feedback crosses thresholds. Key milestones are evidence confirmation, controlled rollout, resilience validation, and board-visible monitoring. Risks are managed through explicit tradeoffs, Devil's Advocate challenge points, and post-decision feedback into memory and the digital twin.`,
    confidence: confidenceFrom(state)
  };
}
