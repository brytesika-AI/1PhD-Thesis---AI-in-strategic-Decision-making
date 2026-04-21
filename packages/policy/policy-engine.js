const BLOCKED_TOOLS = new Set([
  "shell",
  "filesystem_write",
  "email_send",
  "external_post",
  "unreviewed_web_scrape"
]);

const APPROVAL_REQUIRED_TOOLS = new Set([
  "external_search",
  "uploaded_file_ingest",
  "implementation_plan_builder"
]);

const BLOCKED_EXTERNAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "tiktok.com"
];

export class PolicyEngine {
  constructor(registryDocument) {
    this.registryDocument = registryDocument;
  }

  validateToolAccess(agentId, toolName) {
    const agent = this.registryDocument?.agents?.[agentId];
    if (!agent) {
      return { allowed: false, reason: `Agent ${agentId} not found in registry.` };
    }
    if (BLOCKED_TOOLS.has(toolName)) {
      return { allowed: false, reason: `Tool ${toolName} is globally blocked by default.` };
    }
    if (!agent.allowed_tools.includes(toolName)) {
      return { allowed: false, reason: `Tool ${toolName} is blocked for ${agentId}.` };
    }
    return { allowed: true, reason: "Allowed" };
  }

  buildToolPolicyCheck(agentId, toolName) {
    const access = this.validateToolAccess(agentId, toolName);
    return {
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      tool_name: toolName,
      allowed: access.allowed,
      reason: access.reason,
      requires_human_approval: APPROVAL_REQUIRED_TOOLS.has(toolName)
    };
  }

  requiresApproval(agentId) {
    return Boolean(this.registryDocument?.agents?.[agentId]?.requires_human_approval ?? true);
  }

  validateExternalDataAccess(urlOrPath = "") {
    const value = String(urlOrPath).toLowerCase();
    return !BLOCKED_EXTERNAL_HOSTS.some((host) => value.includes(host));
  }

  validateUploadMetadata(fileName = "", byteLength = 0) {
    const lowerName = String(fileName).toLowerCase();
    const blockedExtensions = [".exe", ".bat", ".cmd", ".ps1", ".sh", ".js", ".vbs"];
    if (blockedExtensions.some((ext) => lowerName.endsWith(ext))) {
      return { allowed: false, reason: "Executable upload type blocked." };
    }
    if (Number(byteLength) > 25 * 1024 * 1024) {
      return { allowed: false, reason: "Upload exceeds 25 MB governance limit." };
    }
    return { allowed: true, reason: "Upload metadata accepted." };
  }
}
