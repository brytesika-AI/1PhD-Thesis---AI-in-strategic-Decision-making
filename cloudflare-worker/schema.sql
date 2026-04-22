CREATE TABLE IF NOT EXISTS risk_signals (
    id TEXT PRIMARY KEY,
    source TEXT,
    title TEXT,
    content TEXT,
    risk_score INTEGER,
    risk_category TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS decision_sessions (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    risk_state TEXT,
    sector TEXT,
    query_text TEXT,
    stage_reached INTEGER,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    cycle_duration_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS ror_metrics (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    org_id TEXT,
    indicator TEXT,
    value REAL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_registry (
    id TEXT PRIMARY KEY,
    domain TEXT,
    summary TEXT,
    confidence REAL,
    created_at DATETIME,
    evolved_at DATETIME
);

CREATE TABLE IF NOT EXISTS memory_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT,
    update_type TEXT,
    content TEXT,
    source_session TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI-SRF GOVERNANCE V4 Additions --
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    agent_id TEXT,
    input_summary TEXT,
    output_summary TEXT,
    tools_used TEXT,
    policy_checks TEXT,
    raw_payload TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_state_data (
    session_id TEXT PRIMARY KEY,
    current_stage INTEGER,
    status TEXT,
    evidence_bundle TEXT,
    strategic_options TEXT,
    stress_tests TEXT,
    implementation_plan TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cloudflare-first production gateway tables.
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

CREATE TABLE IF NOT EXISTS organization_memory (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    memory_type TEXT NOT NULL CHECK(memory_type IN ('episodic', 'semantic', 'procedural')),
    content TEXT NOT NULL DEFAULT '{}',
    tags TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0,
    success_rate REAL NOT NULL DEFAULT 0.5,
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organization_memory_scope_type
ON organization_memory(organization_id, memory_type, updated_at);

CREATE INDEX IF NOT EXISTS idx_organization_memory_rank
ON organization_memory(organization_id, memory_type, success_rate, updated_at);

CREATE TABLE IF NOT EXISTS agent_learning_log (
    id TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL,
    lesson TEXT NOT NULL,
    improvement TEXT,
    impact TEXT,
    organization_id TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_learning_log_scope_time
ON agent_learning_log(organization_id, agent_name, timestamp);

CREATE TABLE IF NOT EXISTS digital_twin_state (
    organization_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    environment_state TEXT NOT NULL DEFAULT '{}',
    operational_state TEXT NOT NULL DEFAULT '{}',
    risk_state TEXT NOT NULL DEFAULT '{}',
    decision_state TEXT NOT NULL DEFAULT '{}',
    last_updated TEXT NOT NULL,
    PRIMARY KEY (organization_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_digital_twin_state_latest
ON digital_twin_state(organization_id, last_updated);
