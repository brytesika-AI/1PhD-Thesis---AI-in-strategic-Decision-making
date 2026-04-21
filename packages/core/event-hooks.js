export class EventHooks {
  constructor({ auditLog, caseStore }) {
    this.auditLog = auditLog;
    this.caseStore = caseStore;
  }

  async emit(eventName, payload = {}) {
    if (eventName === "audit_event" && payload.case_id && payload.agent_id) {
      return this.auditLog.logEvent(payload);
    }
    if (eventName === "state_snapshot" && payload.case_state) {
      return this.caseStore.saveCase(payload.case_state);
    }
    if (eventName === "approval_gate") {
      return payload.approval_gate || null;
    }
    if (eventName === "monitoring_trigger_check") {
      return {
        status: "queued",
        monitoring_triggers: payload.monitoring_triggers || []
      };
    }
    return { status: "ignored", event: eventName };
  }
}
