import streamlit as st
import httpx
import json
import pandas as pd
from datetime import datetime
import os

# --- Configuration & High-Fidelity Styling ---
st.set_page_config(
    page_title="AI - Strategic Resilience Framework",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

def local_css(file_name):
    with open(file_name) as f:
        st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)

try:
    local_css("app/styles.css")
except:
    pass

from backend.calculations.ror_engine import RORState, extract_financials_from_input

# --- State Management ---
if "stage" not in st.session_state: st.session_state.stage = 1
if "messages" not in st.session_state: st.session_state.messages = []
if "risk_state" not in st.session_state: st.session_state.risk_state = "ELEVATED"
if "run_id" not in st.session_state: st.session_state.run_id = f"run-{datetime.now().strftime('%H%M%S')}"
if "deliberation_trace" not in st.session_state: st.session_state.deliberation_trace = []
if "ror_state" not in st.session_state: st.session_state.ror_state = RORState()
if "session_context" not in st.session_state:
    st.session_state.session_context = {
        'confirmed_findings': [],
        'executive_constraints': {'time_constraint': None, 'budget_constraint': None, 'political_constraint': None, 'board_deadline': None},
        'financial_data': {'investment_total': 0.0, 'current_recovery_pct': 0.0, 'unrealised_value': 0.0},
        'chosen_option': None,
        'nigeria_workstream_required': False,
        'current_stage': 1,
        'completed_stages': []
    }

def on_executive_input(text: str):
    """Update ROR state from user input."""
    financials = extract_financials_from_input(text)
    ror = st.session_state.ror_state
    if 'investment_total' in financials: ror.investment_total = financials['investment_total']
    if 'current_recovery_pct' in financials: ror.current_recovery_pct = financials['current_recovery_pct']
    st.session_state.ror_state = ror

def build_context_injection():
    """Build a Version 3.0 context string for prompt injection."""
    ctx = st.session_state.session_context
    ror = st.session_state.ror_state
    injection = f"""
INHERITED SESSION CONTEXT:
Current Stage: {ctx['current_stage']} | Board Deadline: {ctx['executive_constraints']['board_deadline'] or 'Not yet stated'}
Chosen Option: {ctx['chosen_option'] or 'Not yet chosen'} | Nigeria Workstream Required: {ctx['nigeria_workstream_required']}

{ror.format_for_prompt()}
"""
    return injection

def extract_session_context(stage_number, executive_response, agent_output):
    """Extract key facts into session_context."""
    on_executive_input(executive_response)
    context = st.session_state.session_context
    import re
    
    if '90 day' in executive_response.lower() or '90-day' in executive_response.lower():
        context['executive_constraints']['board_deadline'] = '90 days'
    for option in ['option 1', 'option 2', 'option 3']:
        if option in executive_response.lower(): context['chosen_option'] = option
    if 'nigeria' in executive_response.lower() and ('retrain' in executive_response.lower() or 'separate' in executive_response.lower()):
        context['nigeria_workstream_required'] = True
    
    context['completed_stages'].append(stage_number)
    context['current_stage'] = stage_number + 1
    st.session_state.session_context = context

# --- McKinsey Authority Header ---
st.markdown('<div class="tribal-line"></div>', unsafe_allow_html=True)
st.markdown(f"""
<div class="mckinsey-header">
    <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center;">
            <div class="header-profile">BS</div>
            <div>
                <div class="header-title">AI - Strategic Resilience Framework</div>
                <div class="uj-attribution">By: Bright Sikazwe, PhD Candidate</div>
            </div>
        </div>
        <div style="display: flex; gap: 10px;">
            <div class="status-pill" style="background: #A8401E; color: white; padding: 5px 15px; border-radius: 4px; font-weight: 900; border: 1px solid #A8401E;">● {st.session_state.risk_state}</div>
            <div class="status-pill" style="border: 1px solid #C8922A; color: #C8922A; padding: 5px 15px; border-radius: 4px;">KING IV</div>
            <div class="status-pill" style="border: 1px solid #C8922A; color: #C8922A; padding: 5px 15px; border-radius: 4px;">POPIA</div>
            <div class="status-pill" style="background: #2A6645; color: white; padding: 5px 15px; border-radius: 4px; font-weight: 900;">GOVERNED</div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)
st.markdown('<div class="tribal-line"></div>', unsafe_allow_html=True)

# --- McKinsey ROR Metrics (Top Dashboard) ---
ror = st.session_state.ror_state
metrics = ror.format_for_display()
metrics_html = f"""
<div class="ror-metric-container">
    <div class="ror-card">
        <div class="ror-label">TOTAL INVESTMENT</div>
        <div class="ror-value">{metrics["investment"]}</div>
        <div class="ror-progress-bar"><div class="ror-progress-fill" style="width: 100%; background: #C8922A;"></div></div>
    </div>
    <div class="ror-card">
        <div class="ror-label">UNREALISED VALUE</div>
        <div class="ror-value" style="color: #A8401E;">{metrics["unrealised"]}</div>
        <div class="ror-progress-bar"><div class="ror-progress-fill" style="width: 100%; background: #A8401E;"></div></div>
    </div>
    <div class="ror-card">
        <div class="ror-label">CURRENT RECOVERY</div>
        <div class="ror-value">{metrics["recovery"]}</div>
        <div class="ror-progress-bar"><div class="ror-progress-fill" style="width: {ror.current_recovery_pct}%; background: #2A6645;"></div></div>
    </div>
    <div class="ror-card">
        <div class="ror-label">ROR DELTA (90d)</div>
        <div class="ror-value" style="color: #2A6645;">{metrics["ror_delta"]}</div>
        <div class="ror-progress-bar"><div class="ror-progress-fill" style="width: {min(100, ror.gauntlet_score_pct)}%; background: #2A6645;"></div></div>
    </div>
</div>
"""
st.markdown(metrics_html, unsafe_allow_html=True)

# SIDEBAR: Metadata & Controls
with st.sidebar:
    st.markdown("### 📊 LIVE ROR DASHBOARD")
    ror = st.session_state.ror_state
    metrics = ror.format_for_display()
    
    col1, col2 = st.columns(2)
    with col1:
        st.metric("Investment", metrics["investment"])
        st.metric("Unrealised", metrics["unrealised"], delta_color="inverse")
    with col2:
        st.metric("Recovery", metrics["recovery"])
        st.metric("ROR Delta", metrics["ror_delta"])
    
    st.markdown(f"**Digital Gauntlet Score:** {metrics['gauntlet']}")
    if ror.gauntlet_conditions_total > 0:
        st.progress(ror.gauntlet_conditions_passed / ror.gauntlet_conditions_total)
    
    st.divider()
    st.markdown("### 🛠️ GOVERNANCE CONTROLS")
    if st.button("🚀 Execute Strategic Simulation", use_container_width=True):
        st.info("Silicon Sampling initialized...")
    
    if st.button("🔄 Reset Framework Cycle", use_container_width=True):
        st.session_state.stage = 1
        st.session_state.messages = []
        st.session_state.deliberation_trace = []
        st.session_state.ror_state = RORState()
        st.rerun()

# --- Governance Interface ---
col_left, col_right = st.columns([2.2, 1])

with col_left:
    tabs = st.tabs(["STRATEGIC CONVERSATION", "AGENT DELIBERATION", "Environmental Monitor · Sensing"])
    
    with tabs[0]:
        # Verdict-First Message (Environmental Monitor)
        st.markdown(f"""
        <div class="verdict-box">
            <p style="color: #64748B; font-size: 0.75rem; font-weight: 800; text-transform: uppercase;">Environmental Monitor</p>
            <p style="font-size: 0.95rem; line-height: 1.5;">
                The environment is classified <strong>{st.session_state.risk_state}</strong>. 
                Atmospheric sensing for the {st.session_state.sector} sector is active. 
                Governance is enforced under POPIA and King IV standards.
                <br><br>
                What are you bringing to the framework today?
            </p>
        </div>
        """, unsafe_allow_html=True)

        # Chat History container
        chat_container = st.container(height=350)
        with chat_container:
            for msg in st.session_state.messages:
                # Custom chat bubble styling
                role_label = "COMMAND" if msg["role"] == "user" else "GOVERNANCE VERDICT"
                border_color = "#E2E8F0" if msg["role"] == "user" else "#C8922A"
                st.markdown(f"""
                <div style="border-left: 3px solid {border_color}; padding-left: 10px; margin-bottom: 15px;">
                    <p style="font-size: 0.65rem; color: #64748B; font-weight: 800; margin-bottom: 2px;">{role_label}</p>
                    <div style="font-size: 0.9rem;">{msg["content"]}</div>
                </div>
                """, unsafe_allow_html=True)

        # Command Deck Input
        st.markdown('<p class="governance-caption">Command Deck</p>', unsafe_allow_html=True)
        
        # Analyst Queries (Quick Action Buttons)
        queries = [
            "Cloud migration under POPIA", "Vendor contract at ZAR risk",
            "Edge AI under load-shedding", "Board AI literacy gap"
        ]
        
        # Simplified analyst buttons row
        btn_cols = st.columns(4)
        for i, q in enumerate(queries):
            if btn_cols[i].button(q, use_container_width=True):
                st.session_state.messages.append({"role": "user", "content": q})
                st.rerun()

        prompt = st.chat_input("Describe the strategic decision...")
        if prompt:
            st.session_state.messages.append({"role": "user", "content": prompt})
            with st.spinner("Executing governance cycle — agents deliberating..."):
                try:
                    # Strip trace from messages before sending
                    clean_messages = [{"role": m["role"], "content": m["content"]} for m in st.session_state.messages]
                    
                    # Inject context inheritance
                    session_context_str = build_context_injection()
                    
                    res = httpx.post(f"{BACKEND_URL}/api/conversation", json={
                        "messages": clean_messages,
                        "stage": st.session_state.stage,
                        "risk_state": st.session_state.risk_state,
                        "run_id": st.session_state.run_id,
                        "sector": "financial_services",
                        "session_context": session_context_str
                    }, timeout=600.0)
                    data = res.json()
                    
                    # Extract verdict content
                    verdict_content = data.get("content", "")
                    if isinstance(verdict_content, dict):
                        verdict_text = json.dumps(verdict_content, indent=2)
                    else:
                        verdict_text = str(verdict_content)
                    
                    # Extract the raw agent trace
                    raw_trace = data.get("raw_messages", [])
                    
                    st.session_state.messages.append({
                        "role": "assistant", 
                        "content": verdict_text
                    })
                    st.session_state.deliberation_trace = raw_trace
                    
                    # Store context findings after stage completion
                    extract_session_context(st.session_state.stage, prompt, verdict_text)
                    
                    st.session_state.stage = min(st.session_state.stage + 1, 6)
                    st.rerun()
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    st.error(f"Governance engine error: {e}")
    
    # === AGENT DELIBERATION TAB ===
    with tabs[1]:
        st.markdown("""
        <div style="margin-bottom: 15px;">
            <p style="font-size: 0.75rem; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 1px;">
                MULTI-AGENT DELIBERATION TRACE · TRANSPARENCY LOG
            </p>
            <p style="font-size: 0.8rem; color: #94A3B8; margin-top: -8px;">
                Full audit trail of the Dynamic Router's agent selection, tool invocations, and analytical outputs. 
                Required for PhD governance auditability (King IV Principle 8).
            </p>
        </div>
        """, unsafe_allow_html=True)
        
        trace_data = st.session_state.deliberation_trace
        
        if not trace_data:
            st.markdown("""
            <div style="text-align: center; padding: 40px; color: #64748B;">
                <p style="font-size: 1.5rem;">🔬</p>
                <p style="font-weight: 700;">No deliberation data yet</p>
                <p style="font-size: 0.8rem;">Submit a strategic decision in the Conversation tab to generate an agent trace.</p>
            </div>
            """, unsafe_allow_html=True)
        else:
            # Agent color mapping
            agent_colors = {
                "User": "#E2E8F0",
                "Dynamic Router": "#8B5CF6",
                "Environmental Monitor": "#2A6645",
                "Socratic Partner": "#C8922A",
                "Forensic Analyst": "#A8401E",
                "Creative Catalyst": "#0EA5E9",
                "Devil's Advocate": "#DC2626"
            }
            agent_icons = {
                "User": "👤",
                "Dynamic Router": "🔀",
                "Environmental Monitor": "🌍",
                "Socratic Partner": "🤔",
                "Forensic Analyst": "⚖️",
                "Creative Catalyst": "💡",
                "Devil's Advocate": "😈"
            }
            step_labels = {
                "input": "INPUT",
                "router": "ROUTING",
                "tool_call": "TOOL EXECUTION",
                "analysis": "ANALYSIS"
            }
            
            trace_container = st.container(height=500)
            with trace_container:
                for i, entry in enumerate(trace_data):
                    agent = entry.get("agent", "Unknown")
                    step = entry.get("step", "")
                    content = entry.get("content", "")
                    tools = entry.get("tools", [])
                    round_num = entry.get("round", 0)
                    
                    color = agent_colors.get(agent, "#64748B")
                    icon = agent_icons.get(agent, "🤖")
                    step_label = step_labels.get(step, step.upper())
                    
                    # Timeline card
                    st.markdown(f"""
                    <div style="
                        border-left: 3px solid {color};
                        padding: 12px 16px;
                        margin-bottom: 8px;
                        background: rgba(30, 41, 59, 0.4);
                        border-radius: 0 6px 6px 0;
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.1rem;">{icon}</span>
                                <span style="
                                    font-size: 0.7rem;
                                    font-weight: 900;
                                    color: {color};
                                    text-transform: uppercase;
                                    letter-spacing: 0.5px;
                                ">{agent}</span>
                            </div>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <span style="
                                    font-size: 0.6rem;
                                    font-weight: 700;
                                    color: white;
                                    background: {color};
                                    padding: 2px 8px;
                                    border-radius: 3px;
                                    text-transform: uppercase;
                                ">{step_label}</span>
                                <span style="
                                    font-size: 0.6rem;
                                    color: #64748B;
                                    font-weight: 600;
                                ">Round {round_num}</span>
                            </div>
                        </div>
                        <div style="font-size: 0.85rem; color: #CBD5E1; line-height: 1.6; white-space: pre-wrap;">{content}</div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    # Render tool details if present
                    if tools:
                        for tool in tools:
                            tool_name = tool.get("tool", "unknown")
                            tool_query = tool.get("query", "")
                            tool_result = tool.get("result_preview", "")
                            st.markdown(f"""
                            <div style="
                                margin-left: 24px;
                                border-left: 2px dashed #475569;
                                padding: 8px 12px;
                                margin-bottom: 8px;
                                background: rgba(15, 23, 42, 0.6);
                                border-radius: 0 4px 4px 0;
                            ">
                                <p style="font-size: 0.65rem; font-weight: 800; color: #C8922A; margin-bottom: 4px;">
                                    🔧 TOOL: {tool_name}
                                </p>
                                <p style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 4px;">
                                    <strong>Query:</strong> {tool_query}
                                </p>
                                <p style="font-size: 0.75rem; color: #64748B;">
                                    <strong>Result:</strong> {tool_result[:200]}{'...' if len(tool_result) > 200 else ''}
                                </p>
                            </div>
                            """, unsafe_allow_html=True)
            
            # Summary metrics
            agent_count = len(set(e.get("agent") for e in trace_data if e.get("step") == "analysis"))
            tool_count = sum(len(e.get("tools", [])) for e in trace_data)
            round_count = max((e.get("round", 0) for e in trace_data), default=0)
            
            mcols = st.columns(3)
            mcols[0].metric("Agents Engaged", agent_count)
            mcols[1].metric("Tools Invoked", tool_count)
            mcols[2].metric("Deliberation Rounds", round_count)
    
    with tabs[2]:
        st.info("Environmental sensing data will be displayed here when the monitoring agent is active.")

with col_right:
    st.markdown('<p style="font-size: 0.8rem; font-weight: 800; color: #64748B; margin-top: 10px;">AGENT PIPELINE</p>', unsafe_allow_html=True)
    
    stages = [
        ("Environmental Monitor", "Layer 1 · Complete", "green"),
        ("Socratic Partner", "Layer 2 · Awaiting", "grey"),
        ("Forensic Analyst", "Layer 2 · Awaiting", "grey"),
        ("Creative Catalyst", "Layer 2 · Awaiting", "grey"),
        ("Devil's Advocate", "Layer 2 · Mandatory", "terracotta"),
        ("Impl. Scaffolding", "Layer 3 · Awaiting", "grey"),
        ("Monitoring Agent", "Layer 3 · Continuous", "grey")
    ]
    
    pipeline_container = st.container()
    with pipeline_container:
        for i, (name, status, color_type) in enumerate(stages):
            # Dynamic color logic based on current stage
            final_color = "green" if i < st.session_state.stage - 1 else ("terracotta" if i == st.session_state.stage - 1 else "grey")
            st.markdown(f"""
            <div class="pipeline-card">
                <div class="trace-dot dot-{final_color}"></div>
                <div>
                    <div class="trace-label">{name}</div>
                    <div class="trace-status">{status}</div>
                </div>
            </div>
            """, unsafe_allow_html=True)

    # Active Signals
    st.markdown('<p style="font-size: 0.8rem; font-weight: 800; color: #64748B; margin-top: 20px;">ACTIVE SIGNALS</p>', unsafe_allow_html=True)
    signals = [
        ("● ZAR/USD +4.2% · 72h window", "#C8922A"),
        ("● Stage 4 load-shedding active", "#A8401E"),
        ("● Transnet nominal", "#2A6645"),
        ("● POPIA audit outstanding", "#A8401E")
    ]
    for text, color in signals:
        st.markdown(f'<div class="signal-item" style="color: {color};">{text}</div>', unsafe_allow_html=True)

    st.markdown('<p style="color: #A8401E; font-size: 0.7rem; font-weight: 800; margin-top: 20px;">'
                'Devil\'s Advocate cannot be bypassed</p>', unsafe_allow_html=True)

# SIDEBAR: Metadata & Controls
with st.sidebar:
    st.markdown("### 🛠️ GOVERNANCE CONTROLS")
    if st.button("🚀 Execute Strategic Simulation", use_container_width=True):
        st.info("Silicon Sampling initialized...")
    
    if st.button("🔄 Reset Framework Cycle", use_container_width=True):
        st.session_state.stage = 1
        st.session_state.messages = []
        st.session_state.deliberation_trace = []
        st.rerun()
    
    st.divider()
    st.markdown("### 📄 SESSION METADATA")
    st.caption(f"Run ID: {st.session_state.run_id}")
    st.caption(f"Framework version: v1.4 (McKinsey-SA Edition)")

# Footer
st.markdown(f"""
<div style="text-align: center; margin-top: 20px;">
    <p style="font-size: 0.65rem; color: #94A3B8; font-weight: 800; text-transform: uppercase;">
        This framework does not help. It governs.
    </p>
    <div class="tribal-line"></div>
</div>
""", unsafe_allow_html=True)
