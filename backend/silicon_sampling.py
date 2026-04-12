import random
from typing import List, Dict, Any
from backend.stage_engine import fallback_stage_output
from backend.storage import save_stage_payload, upsert_run

class SyntheticPersona:
    def __init__(self, persona_id, tier, literacy, constraint):
        self.persona_id = persona_id
        self.tier = tier
        self.literacy = literacy
        self.constraint = constraint

def generate_personas(count=9) -> List[SyntheticPersona]:
    tiers = ['board_level', 'executive', 'senior_management']
    literacy = ['low', 'medium', 'high']
    constraints = ['energy', 'logistics', 'connectivity', 'regulatory']
    return [SyntheticPersona(f"persona_{i+1}", tiers[i%3], literacy[(i//3)%3], constraints[i%4]) for i in range(count)]

def run_silicon_sampling(sector="generic", count=9, seed=42):
    random.seed(seed)
    personas = generate_personas(count)
    results = []
    
    for persona in personas:
        run_id = f"silicon-{seed}-{persona.persona_id}"
        upsert_run(run_id, sector, "ELEVATED", 6)
        
        # Run through stages (simulated)
        for stage in range(1, 7):
            payload = fallback_stage_output(stage, "Simulation", "Simulation", "ELEVATED", sector, [])
            save_stage_payload(run_id, stage, f"Agent_{stage}", payload)
            
        results.append({"run_id": run_id, "persona": persona.__dict__})
        
    return {"status": "completed", "runs": results}
