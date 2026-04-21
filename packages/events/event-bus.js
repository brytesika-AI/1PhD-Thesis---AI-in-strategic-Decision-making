export const EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "stage_start",
  "stage_end",
  "tool_execution_start",
  "tool_execution_end",
  "objection_raised",
  "rebuttal_added",
  "consensus_updated",
  "policy_violation_detected",
  "case_closed",
  "case_reopened",
  "case_created",
  "monitoring_retrigger",
  "queue_enqueued",
  "queue_dequeued",
  "loop_stopped"
]);

export class EventBus {
  constructor({ auditLog }) {
    this.auditLog = auditLog;
  }

  async emit(eventType, payload = {}) {
    if (!EVENT_TYPES.has(eventType)) {
      throw new Error(`Unknown AI-SRF event type: ${eventType}`);
    }
    return this.auditLog.logEvent({
      event_type: eventType,
      case_id: payload.case_id,
      agent_id: payload.agent_id || "decision_governor",
      input_summary: payload.input_summary || eventType,
      output_summary: payload.output_summary || "",
      tools_used: payload.tools_used || [],
      model_used: payload.model_used || "event-system",
      policy_checks: payload.policy_checks || [],
      human_approval: Boolean(payload.human_approval),
      raw_payload: payload.raw_payload || payload
    });
  }
}
