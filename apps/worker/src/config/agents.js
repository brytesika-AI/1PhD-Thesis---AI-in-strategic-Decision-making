export const agentRegistry = {
  agents: {
    tracker: {
      id: "tracker",
      display_name: "The Tracker",
      role: "Environmental Monitor",
      system_prompt_path: "prompts/tracker.md",
      allowed_tools: ["gather_evidence"],
      output_schema: "TrackerSchema",
      handoff_rules: { next: "induna" },
      requires_human_approval: false,
      max_context_chars: 8000,
      monitoring_triggers: []
    },
    induna: {
      id: "induna",
      display_name: "The Induna",
      role: "Socratic Partner",
      system_prompt_path: "prompts/induna.md",
      allowed_tools: ["extract_assumptions"],
      output_schema: "IndunaSchema",
      handoff_rules: { next: "auditor" },
      requires_human_approval: false,
      max_context_chars: 8000,
      monitoring_triggers: []
    },
    auditor: {
      id: "auditor",
      display_name: "The Auditor",
      role: "Forensic Analyst",
      system_prompt_path: "prompts/auditor.md",
      allowed_tools: ["root_cause_analysis"],
      output_schema: "AuditorSchema",
      handoff_rules: { next: "innovator" },
      requires_human_approval: true,
      max_context_chars: 12000,
      monitoring_triggers: ["Compliance Verdict Failed"]
    },
    innovator: {
      id: "innovator",
      display_name: "The Innovator",
      role: "Creative Catalyst",
      system_prompt_path: "prompts/innovator.md",
      allowed_tools: ["generate_options"],
      output_schema: "InnovatorSchema",
      handoff_rules: { next: "challenger" },
      requires_human_approval: true,
      max_context_chars: 12000,
      monitoring_triggers: []
    },
    challenger: {
      id: "challenger",
      display_name: "The Challenger",
      role: "Devil's Advocate",
      system_prompt_path: "prompts/challenger.md",
      allowed_tools: ["generate_objections"],
      output_schema: "ChallengerSchema",
      handoff_rules: { next: "architect" },
      requires_human_approval: true,
      max_context_chars: 16000,
      monitoring_triggers: ["Stress Test Failed"]
    },
    architect: {
      id: "architect",
      display_name: "The Architect",
      role: "Implementation Scaffolding",
      system_prompt_path: "prompts/architect.md",
      allowed_tools: ["build_implementation_plan"],
      output_schema: "ArchitectSchema",
      handoff_rules: { next: "guardian" },
      requires_human_approval: true,
      max_context_chars: 16000,
      monitoring_triggers: []
    },
    guardian: {
      id: "guardian",
      display_name: "The Guardian",
      role: "Monitoring Agent",
      system_prompt_path: "prompts/guardian.md",
      allowed_tools: ["generate_monitoring_rules"],
      output_schema: "GuardianSchema",
      handoff_rules: { next: null },
      requires_human_approval: false,
      max_context_chars: 16000,
      monitoring_triggers: ["System Card Generation"]
    },
    decision_governor: {
      id: "decision_governor",
      display_name: "Decision Governor",
      role: "Orchestration and Control",
      system_prompt_path: "prompts/decision_governor.md",
      allowed_tools: ["validate_policy", "validate_consensus", "extract_memory", "reflect_on_decision"],
      output_schema: "DecisionGovernorSchema",
      handoff_rules: { next: null },
      requires_human_approval: false,
      max_context_chars: 16000,
      monitoring_triggers: ["Loop Stall", "Contradiction Detected", "Escalation Required"]
    },
    consensus_tracker: {
      id: "consensus_tracker",
      display_name: "Consensus Tracker",
      role: "Agreement and Tension State",
      system_prompt_path: "prompts/consensus_tracker.md",
      allowed_tools: ["validate_consensus"],
      output_schema: "ConsensusTrackerSchema",
      handoff_rules: { next: null },
      requires_human_approval: false,
      max_context_chars: 12000,
      monitoring_triggers: ["Unresolved Tension"]
    },
    policy_sentinel: {
      id: "policy_sentinel",
      display_name: "Policy Sentinel",
      role: "Governance Enforcement",
      system_prompt_path: "prompts/policy_sentinel.md",
      allowed_tools: ["validate_policy"],
      output_schema: "PolicySentinelSchema",
      handoff_rules: { next: null },
      requires_human_approval: false,
      max_context_chars: 12000,
      monitoring_triggers: ["Policy Violation Detected"]
    }
  }
};
