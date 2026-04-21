export class DebateEngine {
  constructor({ maxRounds = 3 } = {}) {
    this.maxRounds = maxRounds;
  }

  raiseObjection(caseState, { agentId, targetAgentId, claim, severity = "medium", confidence = 0.6 }) {
    const objection = {
      id: crypto.randomUUID(),
      round: this.currentRound(caseState) + 1,
      agent_id: agentId,
      target_agent_id: targetAgentId,
      claim,
      severity,
      confidence,
      status: "open",
      created_at: new Date().toISOString()
    };
    caseState.objections = [...(caseState.objections || []), objection];
    caseState.unresolved_tensions = [...(caseState.unresolved_tensions || []), claim];
    return objection;
  }

  addRebuttal(caseState, { agentId, objectionId, response, confidence = 0.6 }) {
    const rebuttal = {
      id: crypto.randomUUID(),
      objection_id: objectionId,
      agent_id: agentId,
      response,
      confidence,
      created_at: new Date().toISOString()
    };
    caseState.rebuttals = [...(caseState.rebuttals || []), rebuttal];
    const objection = (caseState.objections || []).find((item) => item.id === objectionId);
    if (objection) objection.status = confidence >= 0.72 ? "answered" : "contested";
    return rebuttal;
  }

  currentRound(caseState) {
    return Math.max(0, ...(caseState.objections || []).map((item) => Number(item.round || 0)));
  }

  canContinue(caseState) {
    return this.currentRound(caseState) < this.maxRounds;
  }
}
