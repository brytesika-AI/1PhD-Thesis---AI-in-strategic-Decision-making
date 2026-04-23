import { D1MemoryStore, deriveCaseType } from "../memory/d1-memory-store.js";
import { runTool } from "../skills/index.js";

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function strategyName(option = {}) {
  return option.name || option.strategy || option.description || option.id || "Governed simulation strategy";
}

export function applyScenario(state = {}, scenario = {}) {
  const simulatedState = deepClone(state);
  simulatedState.simulation_context = {
    scenario: scenario.name || "unnamed_scenario",
    conditions: scenario.conditions || {},
    applied_at: new Date().toISOString()
  };
  simulatedState.digital_twin = applyScenarioToTwin(simulatedState.digital_twin, scenario);
  simulatedState.frameworks = applyScenarioToFrameworks(simulatedState.frameworks, scenario);
  if (simulatedState.blended_analysis) {
    simulatedState.blended_analysis = {
      ...simulatedState.blended_analysis,
      scenario_adjusted: true,
      scenario_name: scenario.name,
      top_risks: [
        ...(simulatedState.blended_analysis.top_risks || []),
        ...(Number(scenario.conditions?.risk_delta || 0) > 0
          ? [{ text: `Scenario ${scenario.name} increases blended strategy risk`, priority: 0.78, confidence: 0.7 }]
          : [])
      ]
    };
  }
  simulatedState.analysis = {
    ...(simulatedState.analysis || {}),
    industry: simulatedState.frameworks?.porter || simulatedState.analysis?.industry || null,
    internal: simulatedState.frameworks?.swot || simulatedState.analysis?.internal || null,
    environment: simulatedState.frameworks?.pestle || simulatedState.analysis?.environment || null,
    value_chain: simulatedState.frameworks?.value_chain || simulatedState.analysis?.value_chain || null,
    scenarios: simulatedState.frameworks?.scenario_planning || simulatedState.analysis?.scenarios || null
  };
  simulatedState.risk_state = simulatedState.digital_twin?.risk_state?.level || simulatedState.loop?.risk_state || "ELEVATED";
  return simulatedState;
}

function applyScenarioToFrameworks(frameworks = {}, scenario = {}) {
  const copy = deepClone(frameworks || {});
  const conditions = scenario.conditions || {};
  if (copy.scenario_planning) {
    copy.scenario_planning.active_simulation = {
      name: scenario.name,
      conditions
    };
  }
  if (copy.pestle) {
    copy.pestle.scenario_adjustments = [
      `Load shedding delta: ${conditions.load_shedding_stage_delta || 0}`,
      `System load delta: ${conditions.system_load_delta || 0}`,
      `Market volatility delta: ${conditions.market_volatility_delta || 0}`
    ];
  }
  if (copy.swot && Number(conditions.risk_delta || 0) > 0) {
    copy.swot.threats = [
      ...(copy.swot.threats || []),
      `Scenario ${scenario.name} increases execution risk by ${conditions.risk_delta}`
    ];
  }
  return copy;
}

function applyScenarioToTwin(twin = null, scenario = {}) {
  if (!twin) return null;
  const copy = deepClone(twin);
  const conditions = scenario.conditions || {};
  const loadShedding = copy.environment_state?.load_shedding || {};
  const market = copy.environment_state?.market || {};
  const systemMetrics = copy.operational_state?.system_metrics || {};
  loadShedding.stage = Math.max(0, Number(loadShedding.stage || 0) + Number(conditions.load_shedding_stage_delta || 0));
  market.volatility_index = clamp(Number(market.volatility_index || 0) + Number(conditions.market_volatility_delta || 0));
  systemMetrics.cpu_load_pct = Math.min(100, Math.max(0, Number(systemMetrics.cpu_load_pct || 0) + Number(conditions.system_load_delta || 0)));
  systemMetrics.queue_depth = Math.max(0, Number(systemMetrics.queue_depth || 0) + Number(conditions.queue_depth_delta || 0));
  copy.environment_state = { ...(copy.environment_state || {}), load_shedding: loadShedding, market };
  copy.operational_state = { ...(copy.operational_state || {}), system_metrics: systemMetrics, simulated: true };
  const score = clamp(
    Number(copy.risk_state?.score || 0.35) +
      Number(conditions.risk_delta || 0) +
      Number(conditions.load_shedding_stage_delta || 0) * 0.08 +
      Number(conditions.system_load_delta || 0) / 400 +
      Number(conditions.market_volatility_delta || 0) * 0.25
  );
  copy.risk_state = {
    ...(copy.risk_state || {}),
    level: score >= 0.75 ? "critical" : score >= 0.55 ? "high" : score >= 0.32 ? "medium" : "low",
    score: Number(score.toFixed(2)),
    simulated: true,
    scenario: scenario.name
  };
  copy.last_updated = new Date().toISOString();
  return copy;
}

function compareSimulations(simulationSummary = []) {
  const ranked = [...simulationSummary].sort((left, right) => {
    const leftScore = Number(left.outcome?.success_probability || 0) - Number(left.outcome?.risk_score || 0) + Number(left.outcome?.resilience || 0);
    const rightScore = Number(right.outcome?.success_probability || 0) - Number(right.outcome?.risk_score || 0) + Number(right.outcome?.resilience || 0);
    return rightScore - leftScore;
  });
  const best = ranked[0] || {};
  return {
    best_strategy: best.strategy || best.options?.[0]?.name || "Modify strategy before execution.",
    alternatives: ranked.slice(1).map((item) => ({
      scenario: item.scenario,
      strategy: item.strategy,
      risk_score: item.outcome?.risk_score,
      success_probability: item.outcome?.success_probability,
      recommendation: item.outcome?.recommendation
    })),
    justification: best.outcome
      ? `Selected ${best.strategy} because it has success probability ${best.outcome.success_probability} and risk score ${best.outcome.risk_score}.`
      : "No simulation produced a viable strategy.",
    simulation_summary: ranked
  };
}

function average(values = []) {
  const usable = values.map(Number).filter((value) => Number.isFinite(value));
  if (!usable.length) return 0;
  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

function estimateCostScore(strategy = {}, simulationSummary = []) {
  const text = `${strategy.name || ""} ${strategy.description || ""} ${strategy.approach || ""} ${strategy.risk || ""}`.toLowerCase();
  const base = text.includes("pilot") || text.includes("focused") || text.includes("constrained") ? 0.35 : 0.55;
  const riskLift = average(simulationSummary.map((item) => item.outcome?.risk_score)) * 0.2;
  return Number(clamp(base + riskLift).toFixed(2));
}

function structuredStrategySimulation(state = {}, simulationSummary = [], compared = {}) {
  const proposed = state.proposed_strategy || {};
  const successProbability = average(simulationSummary.map((item) => item.outcome?.success_probability));
  const riskScore = average(simulationSummary.map((item) => item.outcome?.risk_score));
  const resilienceScore = average(simulationSummary.map((item) => item.outcome?.resilience ?? item.outcome?.resilience_score));
  const recommendation = riskScore >= 0.72
    ? "reject"
    : riskScore >= 0.55
      ? "modify"
      : "proceed";
  return {
    success_probability: Number(clamp(successProbability).toFixed(2)),
    risk_score: Number(clamp(riskScore).toFixed(2)),
    cost_score: estimateCostScore(proposed, simulationSummary),
    resilience_score: Number(clamp(resilienceScore).toFixed(2)),
    recommendation,
    strategy_name: strategyName(proposed),
    justification: compared.justification || `Simulated ${strategyName(proposed)} across ${simulationSummary.length} scenarios.`,
    scenarios_tested: simulationSummary.length,
    generated_at: new Date().toISOString()
  };
}

async function persistSimulationMemory(state = {}, simulationResult = {}, env = {}) {
  if (!env.DB) return null;
  const organizationId = state.organization_id || state.user?.organization_id;
  if (!organizationId) return null;
  const memoryStore = new D1MemoryStore(env.DB);
  const failures = simulationResult.simulation_summary
    .flatMap((item) => item.outcome?.key_failures || [])
    .filter(Boolean);
  const best = simulationResult.best_strategy || "Modify strategy before execution.";
  return memoryStore.remember({
    caseState: {
      ...state,
      simulation: simulationResult,
      organization_id: organizationId,
      loop: { ...(state.loop || {}), stop_reason: state.loop?.stop_reason || "simulation_completed" }
    },
    user: state.user || null,
    outcome: simulationResult.block_execution ? "failure" : "success",
    memory: {
      episodic: [
        {
          case_id: state.case_id,
          case_type: deriveCaseType(state.user_goal || ""),
          event_type: "simulation_completed",
          input: { user_goal: state.user_goal, scenarios: simulationResult.simulation_summary.map((item) => item.scenario) },
          output: {
            best_strategy: best,
            block_execution: simulationResult.block_execution,
            failures
          },
          outcome: simulationResult.block_execution ? "failure" : "success",
          confidence: 0.78
        }
      ],
      semantic: [
        {
          entity: "simulation_result",
          fact: simulationResult.justification,
          source_case_id: state.case_id,
          confidence: 0.76
        }
      ],
      procedural: [
        {
          task_type: deriveCaseType(state.user_goal || ""),
          strategy_steps: [best, ...simulationResult.alternatives.map((item) => `Alternative: ${item.strategy}`)].slice(0, 5),
          success_rate: simulationResult.block_execution ? 0.42 : 0.78,
          confidence: 0.78
        }
      ],
      confidence: 0.78
    },
    reflection: {
      what_worked: ["Simulation evaluated strategy resilience before execution."],
      what_failed: failures,
      improvements: simulationResult.block_execution
        ? ["Require human approval before executing high-risk simulated strategy."]
        : ["Reuse simulation-ranked best strategy for similar future decisions."]
    },
    learning: {
      lessons: failures.length ? failures : ["Simulation reduced decision uncertainty before execution."],
      improvements: simulationResult.block_execution
        ? ["Modify strategy before execution."]
        : ["Proceed with simulation-ranked strategy."],
      strategy_updates: [{ strategy: best, outcome: simulationResult.block_execution ? "failure" : "success" }]
    }
  });
}

export async function runSimulation(state = {}, env = {}) {
  const input = {
    text: state.user_goal || state.text || "",
    context: state,
    llm: env.AI,
    cache: env.CONFIG_CACHE
  };
  const generated = await runTool("generate_scenarios", input);
  const scenarios = asArray(generated.scenarios).slice(0, 6);
  const simulationSummary = [];

  for (const scenario of scenarios) {
    const simulatedState = applyScenario(state, scenario);
    const sharedInput = {
      text: state.user_goal || "",
      context: {
        ...simulatedState,
        simulation_mode: true,
        scenario
      },
      llm: env.AI,
      cache: env.CONFIG_CACHE
    };
    const options = await runTool("generate_options", sharedInput);
    const objections = await runTool("generate_objections", {
      ...sharedInput,
      context: { ...sharedInput.context, options: options.options || [] }
    });
    const stress = await runTool("run_stress_tests", {
      ...sharedInput,
      context: { ...sharedInput.context, options: options.options || [], objections: objections.objections || [] }
    });
    const outcome = await runTool("evaluate_outcome", {
      ...sharedInput,
      context: {
        ...sharedInput.context,
        options: options.options || [],
        objections: objections.objections || [],
        stress_tests: stress.stress_tests || [],
        verdict: stress.verdict
      }
    });
    simulationSummary.push({
      scenario: scenario.name,
      conditions: scenario.conditions || {},
      strategy: strategyName(options.options?.[0]),
      options: options.options || [],
      objections: objections.objections || [],
      stress_tests: stress.stress_tests || [],
      outcome
    });
  }

  const compared = compareSimulations(simulationSummary);
  if (state.proposed_strategy) {
    return structuredStrategySimulation(state, simulationSummary, compared);
  }
  const threshold = Number(env.SIMULATION_RISK_THRESHOLD || state.simulation_risk_threshold || 0.72);
  const highestRisk = Math.max(...simulationSummary.map((item) => Number(item.outcome?.risk_score || 0)), 0);
  const result = {
    ...compared,
    risk_threshold: threshold,
    highest_risk_score: Number(highestRisk.toFixed(2)),
    block_execution: highestRisk > threshold,
    approval_required: highestRisk > threshold,
    generated_at: new Date().toISOString()
  };
  await persistSimulationMemory(state, result, env);
  return result;
}
