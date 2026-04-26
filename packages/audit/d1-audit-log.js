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
    const page = await this.replayCasePage(caseId, { limit: 50, cursor: null });
    return page.events;
  }

  compactEvent(row) {
    const rawPayload = JSON.parse(row.raw_payload || "{}");
    return {
      event_id: row.event_id,
      event_type: row.event_type,
      timestamp: row.timestamp,
      case_id: row.case_id,
      agent_id: row.agent_id,
      input_summary: String(row.input_summary || "").slice(0, 500),
      output_summary: String(row.output_summary || "").slice(0, 700),
      tools_used: JSON.parse(row.tools_used || "[]").slice(0, 12),
      policy_checks: JSON.parse(row.policy_checks || "[]").slice(0, 8),
      raw_payload: compactPayload(rawPayload),
      user_id: rawPayload.user_id || null,
      action: rawPayload.action || row.event_type,
      human_approval: Boolean(row.human_approval)
    };
  }

  async replayCasePage(caseId, { limit = 50, cursor = null } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit || 50), 1), 100);
    const result = cursor
      ? await this.db
        .prepare("SELECT * FROM audit_events WHERE case_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?")
        .bind(caseId, cursor, boundedLimit + 1)
        .all()
      : await this.db
        .prepare("SELECT * FROM audit_events WHERE case_id = ? ORDER BY timestamp ASC LIMIT ?")
        .bind(caseId, boundedLimit + 1)
        .all();
    const rows = result.results || [];
    const page = rows.slice(0, boundedLimit).map((row) => this.compactEvent(row));
    return {
      events: page,
      next_cursor: rows.length > boundedLimit ? page.at(-1)?.timestamp || null : null,
      limit: boundedLimit
    };
  }

  async replayCaseFull(caseId) {
    const result = await this.db
      .prepare("SELECT * FROM audit_events WHERE case_id = ? ORDER BY timestamp ASC")
      .bind(caseId)
      .all();
    return (result.results || []).map((row) => this.compactEvent(row));
  }

  async replaySummary(caseId, { limit = 50, cursor = null } = {}) {
    const page = await this.replayCasePage(caseId, { limit, cursor });
    const events = page.events;
    return {
      case_id: caseId,
      event_count: events.length,
      agents: events.map((event) => event.agent_id),
      tools_used: [...new Set(events.flatMap((event) => event.tools_used || []))].sort(),
      events,
      next_cursor: page.next_cursor,
      limit: page.limit
    };
  }
}

function compactPayload(value, maxChars = 900) {
  try {
    const text = JSON.stringify(value || {});
    if (text.length <= maxChars) return value || {};
    return { truncated: true, preview: text.slice(0, maxChars) };
  } catch (error) {
    return { unserializable: true, message: error.message };
  }
}
