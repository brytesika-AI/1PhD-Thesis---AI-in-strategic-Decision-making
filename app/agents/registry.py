import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "agents.yaml"
PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


class AgentRegistry:
    """Loads and manages declarative agent configurations."""

    def __init__(self, config_path: Path = CONFIG_PATH):
        self.config_path = config_path
        self.agents: Dict[str, Any] = {}
        self.load_config()

    def load_config(self) -> None:
        """Parse the YAML configuration."""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Agent configuration file not found: {self.config_path}")

        with open(self.config_path, "r", encoding="utf-8") as file:
            if self.config_path.suffix.lower() == ".json":
                data = json.load(file) or {}
            else:
                data = yaml.safe_load(file) or {}
            self.agents = data.get("agents", {})
        self._validate_config()

    def _validate_config(self) -> None:
        required = {
            "id",
            "display_name",
            "role",
            "system_prompt_path",
            "allowed_tools",
            "output_schema",
            "handoff_rules",
            "requires_human_approval",
            "max_context_chars",
            "monitoring_triggers",
        }
        for agent_id, config in self.agents.items():
            missing = required.difference(config)
            if missing:
                missing_fields = ", ".join(sorted(missing))
                raise ValueError(f"Agent {agent_id} is missing required fields: {missing_fields}")

    def get_agent(self, agent_id: str) -> Dict[str, Any]:
        """Get the configuration of a specific agent."""
        return self.agents.get(agent_id, {})

    def list_agents(self) -> List[Dict[str, Any]]:
        """Return agents in the declared AI-SRF pipeline order."""
        ordered_ids = ["tracker", "induna", "auditor", "innovator", "challenger", "architect", "guardian"]
        return [self.agents[agent_id] for agent_id in ordered_ids if agent_id in self.agents]

    def next_agent_id(self, agent_id: str) -> Optional[str]:
        """Return the governed handoff target for an agent."""
        handoff = self.get_agent(agent_id).get("handoff_rules", {})
        return handoff.get("next")

    def get_system_prompt(self, agent_id: str) -> str:
        """Load the system prompt markdown file for a given agent."""
        agent_conf = self.get_agent(agent_id)
        if not agent_conf:
            return ""
        
        prompt_path = Path(__file__).parent.parent.parent / agent_conf.get("system_prompt_path", "")
        if not prompt_path.exists():
            raise FileNotFoundError(f"Prompt file not found: {prompt_path}")

        with open(prompt_path, "r", encoding="utf-8") as file:
            return file.read()
