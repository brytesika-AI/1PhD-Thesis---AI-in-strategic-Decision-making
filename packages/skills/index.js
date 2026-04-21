function textFrom(input) {
  return String(input?.text || input?.goal || input?.context?.user_goal || "").slice(0, 1200);
}

export const toolSchemas = {
  swot_analysis: {
    name: "swot_analysis",
    description: "Structured SWOT analysis for a strategic option.",
    input_schema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } } }
  },
  five_whys: {
    name: "five_whys",
    description: "Five Whys diagnostic chain.",
    input_schema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } } }
  },
  root_cause_analysis: {
    name: "root_cause_analysis",
    description: "Root-cause analysis of decision risk.",
    input_schema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } } }
  },
  policy_compliance_scan: {
    name: "policy_compliance_scan",
    description: "King IV, POPIA, EEA, and governance compliance scan.",
    input_schema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } } }
  },
  scenario_planning: {
    name: "scenario_planning",
    description: "Generate alternative strategic scenarios.",
    input_schema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } } }
  },
  resilience_scoring: {
    name: "resilience_scoring",
    description: "Compute bounded resilience score.",
    input_schema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } } }
  },
  implementation_plan_builder: {
    name: "implementation_plan_builder",
    description: "Build governed implementation roadmap.",
    input_schema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } } }
  }
};

export const skills = {
  swot_analysis: {
    schema: toolSchemas.swot_analysis,
    execute(input = {}) {
    const text = textFrom(input);
    return {
      status: "success",
      strengths: ["Existing governance sequence is explicit."],
      weaknesses: ["Evidence confidence must remain visible."],
      opportunities: ["Use staged approvals to reduce decision risk."],
      threats: ["Unapproved external data can contaminate strategic judgment."],
      source_excerpt: text.slice(0, 180)
    };
    }
  },

  five_whys: {
    schema: toolSchemas.five_whys,
    execute(input = {}) {
    const text = textFrom(input);
    return {
      status: "success",
      chain: [
        "Why is this decision urgent?",
        "Why is the current evidence insufficient?",
        "Why would the board accept the residual risk?",
        "Why is this option resilient under infrastructure stress?",
        "Why is now the right governance window?"
      ],
      source_excerpt: text.slice(0, 180)
    };
    }
  },

  root_cause_analysis: {
    schema: toolSchemas.root_cause_analysis,
    execute(input = {}) {
    return {
      status: "success",
      causes: [
        "Strategic ambiguity",
        "Evidence fragmentation",
        "Weak handoff accountability"
      ],
      recommended_probe: "Separate operational symptoms from board-level decision constraints."
    };
    }
  },

  policy_compliance_scan: {
    schema: toolSchemas.policy_compliance_scan,
    execute(input = {}) {
    return {
      status: "success",
      frameworks: ["King IV", "POPIA Act 4 of 2013", "Employment Equity Act"],
      flags: [],
      verdict: "review_required"
    };
    }
  },

  scenario_planning: {
    schema: toolSchemas.scenario_planning,
    execute(input = {}) {
    return {
      status: "success",
      scenarios: [
        { name: "Base case", posture: "Proceed with approval gates." },
        { name: "Infrastructure stress", posture: "Reduce dependency on brittle external services." },
        { name: "Regulatory scrutiny", posture: "Increase evidence traceability and board sign-off." }
      ]
    };
    }
  },

  resilience_scoring: {
    schema: toolSchemas.resilience_scoring,
    execute(input = {}) {
    return {
      status: "success",
      score: 0.72,
      dimensions: {
        evidence_quality: 0.7,
        governance_fit: 0.82,
        execution_resilience: 0.65
      }
    };
    }
  },

  implementation_plan_builder: {
    schema: toolSchemas.implementation_plan_builder,
    execute(input = {}) {
    return {
      status: "success",
      plan: {
        phase_1: "Confirm decision rights, approval gates, and evidence baseline.",
        phase_2: "Run constrained option generation and forensic review.",
        phase_3: "Launch monitored implementation with board-visible ROR indicators."
      }
    };
    }
  }
};

export function invokeSkill(toolName, input = {}) {
  const skill = skills[toolName];
  if (!skill) {
    return { status: "error", message: `Skill ${toolName} not found.` };
  }
  return skill.execute(input);
}

export function listToolDefinitions() {
  return Object.values(toolSchemas);
}

export async function executeToolWithHooks({ agentId, toolName, input = {}, policy, eventBus, caseId }) {
  const policyCheck = policy.buildToolPolicyCheck(agentId, toolName);
  await eventBus?.emit("tool_execution_start", {
    case_id: caseId,
    agent_id: agentId,
    input_summary: `Tool requested: ${toolName}`,
    output_summary: policyCheck.reason,
    tools_used: [toolName],
    policy_checks: [policyCheck],
    raw_payload: { tool_name: toolName, input_schema: toolSchemas[toolName]?.input_schema || null }
  });

  if (!policyCheck.allowed) {
    await eventBus?.emit("policy_violation_detected", {
      case_id: caseId,
      agent_id: "policy_sentinel",
      input_summary: `Blocked tool: ${toolName}`,
      output_summary: policyCheck.reason,
      tools_used: [],
      policy_checks: [policyCheck],
      raw_payload: policyCheck
    });
    return { status: "blocked", policy_check: policyCheck };
  }

  const result = invokeSkill(toolName, input);
  await eventBus?.emit("tool_execution_end", {
    case_id: caseId,
    agent_id: agentId,
    input_summary: `Tool completed: ${toolName}`,
    output_summary: JSON.stringify(result).slice(0, 240),
    tools_used: [toolName],
    policy_checks: [policyCheck],
    raw_payload: result
  });
  return { ...result, policy_check: policyCheck };
}
