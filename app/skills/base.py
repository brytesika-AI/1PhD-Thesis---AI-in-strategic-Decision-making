from typing import Any, Dict

class BaseSkill:
    """Base interface for all governance skills."""

    @property
    def name(self) -> str:
        raise NotImplementedError

    @property
    def description(self) -> str:
        raise NotImplementedError

    def execute(self, **kwargs) -> Dict[str, Any]:
        """Execute the skill with the given parameters and return structured result."""
        raise NotImplementedError
