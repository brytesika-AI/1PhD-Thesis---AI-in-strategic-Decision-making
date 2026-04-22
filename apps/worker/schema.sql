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

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('analyst', 'executive', 'admin')),
    organization_id TEXT NOT NULL,
    organization_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_org
ON users(organization_id, email);

CREATE TABLE IF NOT EXISTS episodic_memory (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    user_id TEXT,
    organization_id TEXT,
    case_type TEXT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    output TEXT NOT NULL DEFAULT '{}',
    outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure')),
    confidence REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_episodic_memory_org_case_type_time
ON episodic_memory(organization_id, case_type, timestamp);

CREATE TABLE IF NOT EXISTS semantic_memory (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    organization_id TEXT,
    entity TEXT NOT NULL,
    fact TEXT NOT NULL,
    source_case_id TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_memory_org_entity
ON semantic_memory(organization_id, entity, created_at);

CREATE TABLE IF NOT EXISTS procedural_memory (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    organization_id TEXT,
    task_type TEXT NOT NULL,
    strategy_steps TEXT NOT NULL DEFAULT '[]',
    success_rate REAL NOT NULL DEFAULT 0.5,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_used TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_procedural_memory_org_task
ON procedural_memory(organization_id, task_type);

CREATE INDEX IF NOT EXISTS idx_procedural_memory_org_quality
ON procedural_memory(organization_id, success_rate, failure_count, last_used);
