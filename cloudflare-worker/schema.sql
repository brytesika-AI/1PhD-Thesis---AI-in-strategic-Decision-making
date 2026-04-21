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
