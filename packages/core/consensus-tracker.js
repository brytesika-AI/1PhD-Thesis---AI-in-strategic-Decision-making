export class ConsensusTracker {
  update(caseState, { agentId, output = {}, confidence = null }) {
    const consensus = caseState.consensus || {
      agreements: [],
      disagreements: [],
      unresolved_tensions: [],
      confidence_by_agent: {},
      level: "unknown",
      final_rationale: ""
    };

    if (output.agreement) consensus.agreements.push({ agent_id: agentId, text: output.agreement });
    if (output.disagreement) consensus.disagreements.push({ agent_id: agentId, text: output.disagreement });
    if (output.unresolved_tension) {
      consensus.unresolved_tensions.push({ agent_id: agentId, text: output.unresolved_tension });
    }
    if (typeof confidence === "number") {
      consensus.confidence_by_agent[agentId] = confidence;
    } else if (typeof output.confidence === "number") {
      consensus.confidence_by_agent[agentId] = output.confidence;
    }

    const confidenceValues = Object.values(consensus.confidence_by_agent);
    const avgConfidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;
    const hasOpenTensions = consensus.unresolved_tensions.length > 0 || (caseState.objections || []).some((item) => item.status !== "answered");

    consensus.level = hasOpenTensions ? "contested" : avgConfidence >= 0.78 ? "high" : avgConfidence >= 0.6 ? "medium" : "low";
    consensus.final_rationale = hasOpenTensions
      ? "Consensus is contested; unresolved tensions must remain visible."
      : "Consensus is sufficient for governed progression.";
    caseState.consensus = consensus;
    return consensus;
  }

  confirmBeforeDecision(caseState) {
    const chain = caseState.verification_chain || {};
    const consensus = caseState.consensus || {};
    const openObjections = (caseState.objections || []).filter((item) => item.status !== "answered");
    return {
      allowed: Boolean(
        chain.devil_advocate_validated &&
        chain.policy_sentinel_validated &&
        chain.consensus_tracker_confirmed &&
        openObjections.length === 0 &&
        consensus.level !== "contested"
      ),
      open_objections: openObjections,
      consensus_level: consensus.level || "unknown",
      verification_chain: chain
    };
  }
}
