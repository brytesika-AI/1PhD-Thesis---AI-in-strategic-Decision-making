from app.skills.five_whys import FiveWhysSkill
from app.skills.implementation_plan_builder import ImplementationPlanBuilderSkill
from app.skills.policy_compliance_scan import PolicyComplianceScanSkill
from app.skills.resilience_scoring import ResilienceScoringSkill
from app.skills.root_cause_analysis import RootCauseAnalysisSkill
from app.skills.scenario_planning import ScenarioPlanningSkill
from app.skills.swot_analysis import SwotAnalysisSkill

SKILLS_REGISTRY = {
    "swot_analysis": SwotAnalysisSkill(),
    "five_whys": FiveWhysSkill(),
    "root_cause_analysis": RootCauseAnalysisSkill(),
    "policy_compliance_scan": PolicyComplianceScanSkill(),
    "scenario_planning": ScenarioPlanningSkill(),
    "resilience_scoring": ResilienceScoringSkill(),
    "implementation_plan_builder": ImplementationPlanBuilderSkill(),
}

__all__ = ["SKILLS_REGISTRY"]
