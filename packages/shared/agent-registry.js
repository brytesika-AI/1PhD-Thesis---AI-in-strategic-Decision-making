export const PIPELINE_ORDER = [
  "tracker",
  "induna",
  "auditor",
  "innovator",
  "challenger",
  "architect",
  "guardian"
];

export const CONTROL_AGENTS = [
  "decision_governor",
  "consensus_tracker",
  "policy_sentinel"
];

export const REQUIRED_AGENT_IDS = [...PIPELINE_ORDER, ...CONTROL_AGENTS];

const REQUIRED_FIELDS = [
  "id",
  "display_name",
  "role",
  "system_prompt_path",
  "allowed_tools",
  "output_schema",
  "handoff_rules",
  "requires_human_approval",
  "max_context_chars",
  "monitoring_triggers"
];

export function validateAgentRegistry(registryDocument) {
  const agents = registryDocument?.agents || {};
  const missingAgents = REQUIRED_AGENT_IDS.filter((agentId) => !agents[agentId]);
  if (missingAgents.length > 0) {
    throw new Error(`Agent registry missing required agents: ${missingAgents.join(", ")}`);
  }

  for (const agentId of REQUIRED_AGENT_IDS) {
    const agent = agents[agentId];
    const missingFields = REQUIRED_FIELDS.filter((field) => !(field in agent));
    if (missingFields.length > 0) {
      throw new Error(`Agent ${agentId} missing fields: ${missingFields.join(", ")}`);
    }
    if (agent.id !== agentId) {
      throw new Error(`Agent key ${agentId} does not match id ${agent.id}`);
    }
  }
  return registryDocument;
}

export function listAgents(registryDocument) {
  const registry = validateAgentRegistry(registryDocument);
  return PIPELINE_ORDER.map((agentId) => registry.agents[agentId]);
}

export function listAllAgents(registryDocument) {
  const registry = validateAgentRegistry(registryDocument);
  return REQUIRED_AGENT_IDS.map((agentId) => registry.agents[agentId]);
}

export function listControlAgents(registryDocument) {
  const registry = validateAgentRegistry(registryDocument);
  return CONTROL_AGENTS.map((agentId) => registry.agents[agentId]);
}

export function getAgent(registryDocument, agentId) {
  const registry = validateAgentRegistry(registryDocument);
  return registry.agents[agentId] || null;
}

export function getAgentForStage(registryDocument, stage) {
  const agentId = PIPELINE_ORDER[Number(stage) - 1];
  return agentId ? getAgent(registryDocument, agentId) : null;
}

export function nextAgentId(registryDocument, agentId) {
  const agent = getAgent(registryDocument, agentId);
  return agent?.handoff_rules?.next || null;
}
