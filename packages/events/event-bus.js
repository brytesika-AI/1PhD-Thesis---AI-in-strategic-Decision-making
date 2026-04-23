export const EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "stage_start",
  "stage_end",
  "state_update",
  "state_updated",
  "consensus_update",
  "tool_called",
  "tool_result",
  "tool_execution_start",
  "tool_execution_end",
  "objection_raised",
  "rebuttal_added",
  "consensus_updated",
  "policy_violation_detected",
  "case_closed",
  "case_reopened",
  "case_created",
  "memory_retrieved",
  "memory_written",
  "reflection_completed",
  "learning_extracted",
  "framework_selected",
  "simulation_completed",
  "narrative_generated",
  "monitoring_retrigger",
  "queue_enqueued",
  "queue_dequeued",
  "loop_stopped",
  "resource_telemetry",
  "human_escalation_required",
  "system_error"
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
      user_id: payload.user_id || payload.raw_payload?.user_id || null,
      action: payload.action || eventType,
      raw_payload: payload.raw_payload || payload
    });
  }
}
