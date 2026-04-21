from datetime import datetime, timezone
from typing import Any, Dict, Tuple


class PolicyEngine:
    """Enforces AI_SRF governance boundaries."""

    def __init__(self, agents_config: dict):
        self.agents_config = agents_config
        self.blocked_tools = {"web_scrape", "shell", "filesystem_write", "email_send", "external_post"}
        self.approval_required_tools = {"external_search", "uploaded_file_ingest", "implementation_plan_builder"}

    def validate_tool_access(self, agent_id: str, tool_name: str) -> Tuple[bool, str]:
        """Check if an agent is allowed to use a specific tool. Blocked by default."""
        agent_conf = self.agents_config.get(agent_id)
        if not agent_conf:
            return False, f"Agent {agent_id} not found in governance config."

        if tool_name in self.blocked_tools:
            return False, f"Tool {tool_name} is globally blocked by default."

        allowed = agent_conf.get("allowed_tools", [])
        if tool_name not in allowed:
            return False, f"Tool {tool_name} is BLOCKED for {agent_id} by policy."

        return True, "Allowed"

    def requires_approval(self, agent_id: str) -> bool:
        """Check if this agent's actions require human approval."""
        agent_conf = self.agents_config.get(agent_id, {})
        return agent_conf.get("requires_human_approval", True)

    def tool_requires_approval(self, tool_name: str) -> bool:
        """Return whether a tool action needs an explicit human gate."""
        return tool_name in self.approval_required_tools

    def validate_external_data_access(self, url_or_path: str) -> bool:
        """Enforces restrictions on external data scraping."""
        blocked_domains = ["facebook.com", "tiktok.com", "instagram.com"]
        for domain in blocked_domains:
            if domain in url_or_path.lower():
                return False
        return True

    def safe_handle_upload(self, file_name: str, content: bytes) -> bool:
        """Apply basic local-file safety controls before any document enters a case."""
        blocked_extensions = (".exe", ".bat", ".cmd", ".ps1", ".sh", ".js", ".vbs")
        if file_name.lower().endswith(blocked_extensions):
            return False
        max_bytes = 25 * 1024 * 1024
        if len(content) > max_bytes:
            return False
        return True

    def build_tool_policy_check(self, agent_id: str, tool_name: str) -> Dict[str, Any]:
        """Return a durable policy record for audit logs."""
        allowed, reason = self.validate_tool_access(agent_id, tool_name)
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": agent_id,
            "tool_name": tool_name,
            "allowed": allowed,
            "reason": reason,
            "requires_human_approval": self.tool_requires_approval(tool_name),
        }
