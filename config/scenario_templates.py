SCENARIO_TEMPLATES = {
    "cloud_migration_popia": {
        "label": "Cloud migration under POPIA",
        "seed_message": (
            "We are evaluating migrating our CRM and customer data platform to a global cloud "
            "provider. The project is already approved at exec level and capex is committed. "
            "Stage 4 load-shedding and the ZAR depreciation at +4.2% over 72 hours were not "
            "factored into the original business case. POPIA data residency implications have "
            "not been formally assessed. The board wants to proceed on original terms."
        ),
        "risk_state_override": "ELEVATED",
        "pre_injected_signals": [
            {"signal_type": "currency", "value": "ZAR/USD +4.2% 72h", "severity": "HIGH"},
            {"signal_type": "energy", "value": "Stage 4 load-shedding active", "severity": "HIGH"},
            {"signal_type": "regulatory", "value": "POPIA data residency audit outstanding", "severity": "HIGH"},
        ]
    },

    "vendor_contract_zar": {
        "label": "Vendor contract at ZAR risk",
        "seed_message": (
            "Our primary AI vendor contract comes up for renewal in 60 days. It is dollar-denominated. "
            "The original contract was signed when ZAR was 12% stronger. The board wants to proceed on "
            "original terms citing sunk cost and switching risk. We have no internal model alternative "
            "ready and no procurement process has been initiated for alternatives."
        ),
        "risk_state_override": "ELEVATED",
        "pre_injected_signals": [
            {"signal_type": "currency", "value": "ZAR/USD +4.2% 72h", "severity": "HIGH"},
            {"signal_type": "vendor", "value": "Contract renewal 60-day window", "severity": "MEDIUM"},
        ]
    },

    "edge_ai_load_shedding": {
        "label": "Edge AI under load-shedding",
        "seed_message": (
            "We are deploying predictive maintenance AI across three platinum group metals mining sites "
            "in Limpopo and the North West. The vendor's system requires continuous cloud connectivity. "
            "We are in Stage 4 load-shedding territory and rural broadband averages 400ms latency. "
            "The vendor's SLA assumes 99.9% uptime. The board presentation is in two weeks."
        ),
        "risk_state_override": "COMPOUND",
        "pre_injected_signals": [
            {"signal_type": "energy", "value": "Stage 4 load-shedding active", "severity": "HIGH"},
            {"signal_type": "connectivity", "value": "Rural broadband 400ms average latency", "severity": "HIGH"},
            {"signal_type": "regulatory", "value": "POPIA telemetry data cross-border flag", "severity": "HIGH"},
        ]
    },

    "board_ai_literacy": {
        "label": "Board AI literacy gap",
        "seed_message": (
            "Our board approved an enterprise-wide AI strategy last quarter. Three months in, "
            "no director can interrogate the system outputs, explain what the models are doing, "
            "or evaluate whether the recommendations align with our regulatory obligations. "
            "King IV obligations are formally unmet. The company secretary has flagged this. "
            "We need a governance architecture that closes this gap without replacing the board."
        ),
        "risk_state_override": "ELEVATED",
        "pre_injected_signals": [
            {"signal_type": "governance", "value": "King IV AI oversight obligations unmet", "severity": "CRITICAL"},
            {"signal_type": "human_capital", "value": "Board AI literacy deficit", "severity": "HIGH"},
        ]
    }
}
