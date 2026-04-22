function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(value) {
  return String(value || "").trim();
}

function severityScore(value = "") {
  const text = String(value).toLowerCase();
  if (text.includes("critical") || text.includes("high") || text.includes("blocked")) return 0.9;
  if (text.includes("medium") || text.includes("moderate") || text.includes("review")) return 0.65;
  if (text.includes("low")) return 0.35;
  return 0.5;
}

function confidenceFrom(source = {}) {
  return Math.min(1, Math.max(0.35, Number(source.confidence || 0.65)));
}

function item(text, framework, source = {}, type = "signal") {
  return {
    text: compact(text),
    framework,
    type,
    severity: severityScore(text),
    confidence: confidenceFrom(source)
  };
}

function addMany(target, values, framework, source, type) {
  for (const value of asArray(values)) {
    const text = typeof value === "string" ? value : value?.summary || value?.implication || value?.text || JSON.stringify(value);
    if (compact(text)) target.push(item(text, framework, source, type));
  }
}

export function normalizeFrameworkOutputs(outputs = {}) {
  const normalized = {
    risks: [],
    opportunities: [],
    constraints: [],
    strengths: [],
    strategic_options: []
  };

  const porter = outputs.porter || outputs.porters_five_forces || {};
  if (porter.competitive_rivalry) normalized.risks.push(item(`Competitive rivalry: ${porter.competitive_rivalry}`, "porter", porter, "risk"));
  if (porter.supplier_power) normalized.constraints.push(item(`Supplier power: ${porter.supplier_power}`, "porter", porter, "constraint"));
  if (porter.buyer_power) normalized.constraints.push(item(`Buyer power: ${porter.buyer_power}`, "porter", porter, "constraint"));
  if (porter.threat_of_substitution) normalized.risks.push(item(`Substitution threat: ${porter.threat_of_substitution}`, "porter", porter, "risk"));
  if (porter.threat_of_new_entry) normalized.risks.push(item(`New-entry threat: ${porter.threat_of_new_entry}`, "porter", porter, "risk"));
  if (porter.overall_industry_attractiveness) {
    normalized.strategic_options.push(item(`Industry attractiveness is ${porter.overall_industry_attractiveness}`, "porter", porter, "option"));
  }

  const swot = outputs.swot || {};
  addMany(normalized.strengths, swot.strengths, "swot", swot, "strength");
  addMany(normalized.constraints, swot.weaknesses, "swot", swot, "constraint");
  addMany(normalized.opportunities, swot.opportunities, "swot", swot, "opportunity");
  addMany(normalized.risks, swot.threats, "swot", swot, "risk");

  const pestle = outputs.pestle || {};
  addMany(normalized.constraints, pestle.political, "pestle", pestle, "constraint");
  addMany(normalized.risks, pestle.economic, "pestle", pestle, "risk");
  addMany(normalized.opportunities, pestle.social, "pestle", pestle, "opportunity");
  addMany(normalized.opportunities, pestle.technological, "pestle", pestle, "opportunity");
  addMany(normalized.risks, pestle.legal, "pestle", pestle, "risk");
  addMany(normalized.risks, pestle.environmental, "pestle", pestle, "risk");
  addMany(normalized.constraints, pestle.highlights, "pestle", pestle, "constraint");

  const valueChain = outputs.value_chain || {};
  addMany(normalized.constraints, valueChain.inbound_logistics, "value_chain", valueChain, "constraint");
  addMany(normalized.constraints, valueChain.operations, "value_chain", valueChain, "constraint");
  addMany(normalized.strategic_options, valueChain.outbound_logistics, "value_chain", valueChain, "option");
  addMany(normalized.opportunities, valueChain.marketing_sales, "value_chain", valueChain, "opportunity");
  addMany(normalized.strategic_options, valueChain.service, "value_chain", valueChain, "option");
  addMany(normalized.risks, valueChain.bottlenecks, "value_chain", valueChain, "risk");
  for (const [activity, detail] of Object.entries(valueChain.support_activities || {})) {
    normalized.constraints.push(item(`${activity}: ${detail}`, "value_chain", valueChain, "constraint"));
  }

  const scenario = outputs.scenario || outputs.scenario_planning || {};
  for (const scenarioItem of asArray(scenario.scenarios)) {
    const name = scenarioItem.name || "scenario";
    addMany(normalized.strategic_options, [`${name}: ${scenarioItem.implication || JSON.stringify(scenarioItem)}`], "scenario_planning", scenario, "option");
    addMany(normalized.risks, scenarioItem.drivers || [], "scenario_planning", scenario, "risk");
  }
  addMany(normalized.risks, scenario.critical_uncertainties, "scenario_planning", scenario, "risk");
  if (scenario.preferred_posture) normalized.strategic_options.push(item(`Preferred posture: ${scenario.preferred_posture}`, "scenario_planning", scenario, "option"));

  return normalized;
}

function tokenSet(text = "") {
  return new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3));
}

function similar(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return false;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.min(a.size, b.size) >= 0.35;
}

function mergeSimilar(items = []) {
  const groups = [];
  for (const signal of items.filter((entry) => entry.text)) {
    const existing = groups.find((group) => group.items.some((entry) => similar(entry.text, signal.text)));
    if (existing) {
      existing.items.push(signal);
    } else {
      groups.push({ items: [signal] });
    }
  }
  return groups.map((group) => {
    const frameworks = [...new Set(group.items.map((entry) => entry.framework))];
    const avgConfidence = group.items.reduce((total, entry) => total + entry.confidence, 0) / group.items.length;
    const maxSeverity = Math.max(...group.items.map((entry) => entry.severity));
    return {
      text: group.items[0].text,
      supporting_evidence: group.items.map((entry) => ({ framework: entry.framework, text: entry.text })),
      frameworks,
      frequency: group.items.length,
      priority: Number((group.items.length * 0.35 + maxSeverity * 0.4 + avgConfidence * 0.25).toFixed(3)),
      confidence: Number(avgConfidence.toFixed(2)),
      severity: Number(maxSeverity.toFixed(2))
    };
  }).sort((left, right) => right.priority - left.priority);
}

function findConflicts(risks = [], opportunities = []) {
  const conflicts = [];
  for (const risk of risks) {
    for (const opportunity of opportunities) {
      if (similar(risk.text, opportunity.text)) {
        conflicts.push({
          issue: risk.text,
          risk: risk.text,
          opportunity: opportunity.text,
          action: "Flag for Devil's Advocate stress test"
        });
      }
    }
  }
  return conflicts.slice(0, 8);
}

export function prioritizeNormalizedData(normalizedData = {}) {
  const topRisks = mergeSimilar(normalizedData.risks || []);
  const topOpportunities = mergeSimilar(normalizedData.opportunities || []);
  const topConstraints = mergeSimilar(normalizedData.constraints || []);
  const topStrengths = mergeSimilar(normalizedData.strengths || []);
  const strategicOptions = mergeSimilar(normalizedData.strategic_options || []);
  return {
    top_risks: topRisks,
    top_opportunities: topOpportunities,
    top_constraints: topConstraints,
    top_strengths: topStrengths,
    strategic_options: strategicOptions,
    conflicts: findConflicts(topRisks, topOpportunities)
  };
}

export function generateBlendedStrategy(normalizedData = {}, prioritized = prioritizeNormalizedData(normalizedData)) {
  const leadingRisk = prioritized.top_risks[0]?.text || "No dominant strategic risk identified.";
  const leadingOpportunity = prioritized.top_opportunities[0]?.text || "No dominant opportunity identified.";
  const leadingConstraint = prioritized.top_constraints[0]?.text || "No dominant constraint identified.";
  const bestOption = prioritized.strategic_options[0]?.text || "Use a staged governed rollout with monitoring.";
  const confidenceInputs = [
    ...prioritized.top_risks.slice(0, 3),
    ...prioritized.top_opportunities.slice(0, 3),
    ...prioritized.strategic_options.slice(0, 2)
  ];
  const confidence = confidenceInputs.length
    ? confidenceInputs.reduce((total, entry) => total + entry.confidence, 0) / confidenceInputs.length
    : 0.62;
  return {
    recommended_strategy: `${bestOption} Mitigate ${leadingRisk} while exploiting ${leadingOpportunity}.`,
    alternatives: prioritized.strategic_options.slice(1, 4).map((entry) => entry.text),
    key_tradeoffs: [
      `Risk tradeoff: ${leadingRisk}`,
      `Opportunity tradeoff: ${leadingOpportunity}`,
      `Constraint tradeoff: ${leadingConstraint}`
    ],
    confidence: Number(Math.min(0.95, Math.max(0.45, confidence)).toFixed(2))
  };
}

export function blendFrameworks(frameworkOutputs = {}) {
  const normalized = normalizeFrameworkOutputs(frameworkOutputs);
  const prioritized = prioritizeNormalizedData(normalized);
  const strategy = generateBlendedStrategy(normalized, prioritized);
  return {
    framework_contributors: Object.keys(frameworkOutputs).filter((key) => frameworkOutputs[key]),
    normalized,
    ...prioritized,
    ...strategy,
    blended_at: new Date().toISOString()
  };
}
