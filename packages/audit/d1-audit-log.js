export class D1AuditLog {
  constructor(db) {
    this.db = db;
  }

  async logEvent(event) {
    const eventId = event.event_id || crypto.randomUUID();
    const record = {
      event_id: eventId,
      event_type: event.event_type || "agent_execution",
      timestamp: event.timestamp || new Date().toISOString(),
      case_id: event.case_id,
      agent_id: event.agent_id,
      input_summary: event.input_summary || "",
      output_summary: event.output_summary || "",
      tools_used: event.tools_used || [],
      model_used: event.model_used || "",
      policy_checks: event.policy_checks || [],
      human_approval: Boolean(event.human_approval),
      user_id: event.user_id || event.raw_payload?.user_id || null,
      action: event.action || event.event_type || "audit_event",
      raw_payload: {
        ...(event.raw_payload || {}),
        user_id: event.user_id || event.raw_payload?.user_id || null,
        action: event.action || event.event_type || "audit_event",
        agent: event.agent_id,
        timestamp: event.timestamp || new Date().toISOString()
      }
    };

    await this.db
      .prepare(
        `INSERT INTO audit_events
          (event_id, event_type, timestamp, case_id, agent_id, input_summary,
           output_summary, tools_used, model_used, policy_checks, human_approval, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.event_id,
        record.event_type,
        record.timestamp,
        record.case_id,
        record.agent_id,
        record.input_summary,
        record.output_summary,
        JSON.stringify(record.tools_used),
        record.model_used,
        JSON.stringify(record.policy_checks),
        record.human_approval ? 1 : 0,
        JSON.stringify(record.raw_payload)
      )
      .run();
    return eventId;
  }

  async replayCase(caseId) {
    const result = await this.db
      .prepare("SELECT * FROM audit_events WHERE case_id = ? ORDER BY timestamp ASC")
      .bind(caseId)
      .all();
    return (result.results || []).map((row) => ({
      ...row,
      tools_used: JSON.parse(row.tools_used || "[]"),
      policy_checks: JSON.parse(row.policy_checks || "[]"),
      raw_payload: JSON.parse(row.raw_payload || "{}"),
      user_id: JSON.parse(row.raw_payload || "{}").user_id || null,
      action: JSON.parse(row.raw_payload || "{}").action || row.event_type,
      human_approval: Boolean(row.human_approval)
    }));
  }

  async replaySummary(caseId) {
    const events = await this.replayCase(caseId);
    return {
      case_id: caseId,
      event_count: events.length,
      agents: events.map((event) => event.agent_id),
      tools_used: [...new Set(events.flatMap((event) => event.tools_used || []))].sort(),
      events
    };
  }
}
