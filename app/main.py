import streamlit as st
import httpx
import json
import pandas as pd
from datetime import datetime
import os
import re

# --- Configuration & Doctoral Styling ---
st.set_page_config(
    page_title="AI-SRF V4.0 | Doctoral Architecture",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

def local_css(file_name):
    try:
        with open(file_name) as f:
            st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)
    except:
        pass

local_css("app/styles.css")

from backend.calculations.ror_engine import RORState, extract_financials_from_input

# --- State Management ---
if "stage" not in st.session_state: st.session_state.stage = 1
if "messages" not in st.session_state: st.session_state.messages = []
if "risk_state" not in st.session_state: st.session_state.risk_state = "ELEVATED"
if "sector" not in st.session_state: st.session_state.sector = "Financial Services"
if "run_id" not in st.session_state: st.session_state.run_id = f"PHD-{datetime.now().strftime('%H%M%S')}"
if "deliberation_trace" not in st.session_state: st.session_state.deliberation_trace = []
if "ror_state" not in st.session_state: st.session_state.ror_state = RORState()
if "env_brief" not in st.session_state: st.session_state.env_brief = {}
if "system_card" not in st.session_state: st.session_state.system_card = None

def format_json_as_markdown(data, level=4):
    """Recursive renderer for V4.0 Doctoral JSON outputs."""
    if not isinstance(data, (dict, list)): return str(data)
    
    md = ""
    if isinstance(data, dict):
        for key, value in data.items():
            if key in ["agent", "stage", "aisrf_citation"]: continue
            
            title = key.replace("_", " ").upper()
            md += f"{'#' * min(level, 6)} {title}\n"
            
            if isinstance(value, list) and value and isinstance(value[0], dict):
                # Render as Table
                keys = value[0].keys()
                header = " | ".join([k.replace("_", " ").title() for k in keys])
                sep = " | ".join(["---"] * len(keys))
                md += f"| {header} |\n| {sep} |\n"
                for item in value:
                    md += "| " + " | ".join([str(item.get(k, "")) for k in keys]) + " |\n"
            elif isinstance(value, (dict, list)):
                md += format_json_as_markdown(value, level + 1)
            else:
                md += f"{value}\n"
            md += "\n"
    elif isinstance(data, list):
        for i, item in enumerate(data):
            if isinstance(item, (dict, list)):
                md += format_json_as_markdown(item, level)
            else:
                md += f"- {item}\n"
                
    return md

# --- Top Dashboard: Four ROR Indicators ---
ror = st.session_state.ror_state
dlr_val = f"{ror.dlr:.1f}%" if ror.dlr else "---"
alpha_val = f"{ror.decision_alpha:+.2f}" if ror.decision_alpha else "Pending"
iar_val = f"{ror.iar:.0f}%"
asy_val = f"{ror.asy:.1f}%" if ror.asy else f"0/{ror.regulatory_constraints_injected}"

# --- McKinsey Authority Header ---
st.markdown('<div class="tribal-line"></div>', unsafe_allow_html=True)
st.markdown(f"""
<div class="mckinsey-header">
    <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center;">
            <div class="header-profile">BS</div>
            <div>
                <div class="header-title">AI - Strategic Resilience Framework (V4.0)</div>
                <div class="uj-attribution">Source: PhD Proposal, Bright Sikazwe (2026)</div>
            </div>
        </div>
        <div style="display: flex; gap: 10px;">
            <div class="status-pill" style="background: #A8401E; color: white;">● {st.session_state.risk_state}</div>
            <div class="status-pill">DLR: {dlr_val}</div>
            <div class="status-pill">αD: {alpha_val}</div>
            <div class="status-pill">ASY: {asy_val}</div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)
st.markdown('<div class="tribal-line"></div>', unsafe_allow_html=True)

# --- Real-Time Sensing Ticker ---
brief = st.session_state.env_brief
eskom = brief.get("eskom", {}).get("status", {}).get("eskom", {}).get("stage", "Unknown")
zar = brief.get("sarb", {}).get("ZAR_USD", "---")
st.markdown(f"""
<div style="background: rgba(30, 41, 59, 0.5); padding: 5px 20px; font-size: 0.75rem; color: #94A3B8; border-bottom: 1px solid #1E293B;">
    📡 SENSING: Eskom {eskom} | ZAR/USD: {zar} | JSE SENS Active | Laws.Africa Live | Macro: GDP 1.2%
</div>
""", unsafe_allow_html=True)

# SIDEBAR
with st.sidebar:
    st.markdown("### 📊 DOCTORAL INDICATORS")
    st.metric("Decision Latency (DLR)", dlr_val)
    st.metric("Decision Alpha (αD)", alpha_val)
    st.metric("Autonomy Ratio (IAR)", iar_val)
    st.metric("Sovereignty Yield (ASY)", asy_val)
    
    st.divider()
    st.markdown("### 🛠️ GOVERNANCE CONTROLS")
    if st.button("🔄 Reset Doctoral Cycle", use_container_width=True):
        st.session_state.stage = 1
        st.session_state.messages = []
        st.session_state.deliberation_trace = []
        st.session_state.ror_state = RORState()
        st.rerun()
    
    if st.session_state.system_card:
        st.success("AI System Card Generated")
        st.download_button("📂 Download System Card", json.dumps(st.session_state.system_card, indent=2), file_name=f"AISRF_SYSTEM_CARD_{st.session_state.run_id}.json")

# INTERFACE
col_left, col_right = st.columns([2.5, 1])

with col_left:
    chat_container = st.container(height=500)
    with chat_container:
        for msg in st.session_state.messages:
            with st.chat_message(msg["role"]):
                if msg["role"] == "assistant" and isinstance(msg.get("json"), dict):
                    st.markdown(format_json_as_markdown(msg["json"]))
                else:
                    st.markdown(msg["content"])

    prompt = st.chat_input("Executive command...")
    if prompt:
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.status(f"Layer {st.session_state.stage} Deliberation...") as status:
            try:
                res = httpx.post(f"{BACKEND_URL}/api/conversation", json={
                    "messages": [{"role": m["role"], "content": m["content"]} for m in st.session_state.messages],
                    "stage": st.session_state.stage,
                    "risk_state": st.session_state.risk_state,
                    "sector": st.session_state.sector,
                    "run_id": st.session_state.run_id
                }, timeout=600.0)
                
                data = res.json()
                # Assuming data = {"content": parsed_json, "raw": raw_text, "env_brief": {...}}
                
                agent_json = data.get("content", {})
                st.session_state.messages.append({"role": "assistant", "content": data.get("raw", ""), "json": agent_json})
                
                if "env_brief" in data: st.session_state.env_brief = data["env_brief"]
                if "system_card" in data: st.session_state.system_card = data["system_card"]
                
                st.session_state.stage = min(st.session_state.stage + 1, 7)
                status.update(label="Stage Complete", state="complete")
                st.rerun()
            except Exception as e:
                st.error(f"Governance Engine Failure: {e}")

with col_right:
    st.markdown('<p class="governance-caption">7-STAGE GOVERNANCE CYCLE</p>', unsafe_allow_html=True)
    stages = ["Tracker", "Induna", "Auditor", "Innovator", "Challenger", "Architect", "Guardian"]
    for i, name in enumerate(stages):
        status_color = "green" if i < st.session_state.stage - 1 else ("terracotta" if i == st.session_state.stage - 1 else "grey")
        st.markdown(f"""
        <div class="pipeline-card">
            <div class="trace-dot dot-{status_color}"></div>
            <div>
                <div class="trace-label">{name}</div>
                <div class="trace-status">{'Active' if i == st.session_state.stage - 1 else ('Complete' if i < st.session_state.stage - 1 else 'Awaiting')}</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
