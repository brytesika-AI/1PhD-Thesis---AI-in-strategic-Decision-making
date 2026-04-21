CREATE TABLE IF NOT EXISTS decision_cases (
    case_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    current_stage INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    user_goal TEXT,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    case_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    input_summary TEXT,
    output_summary TEXT,
    tools_used TEXT NOT NULL DEFAULT '[]',
    model_used TEXT,
    policy_checks TEXT NOT NULL DEFAULT '[]',
    human_approval INTEGER NOT NULL DEFAULT 0,
    raw_payload TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_events_case_time
ON audit_events(case_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_decision_cases_updated
ON decision_cases(updated_at);

CREATE TABLE IF NOT EXISTS decision_queue_items (
    queue_id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    queue_name TEXT NOT NULL,
    agent_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_decision_queue_case_status
ON decision_queue_items(case_id, status, queue_name);
