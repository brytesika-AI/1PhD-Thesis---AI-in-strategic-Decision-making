from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

import httpx
import streamlit as st


BACKEND_URL = "http://localhost:8000"
STAGES = [
    ("tracker", "Environmental Monitor"),
    ("induna", "Socratic Partner"),
    ("auditor", "Forensic Analyst"),
    ("innovator", "Creative Catalyst"),
    ("challenger", "Devil's Advocate"),
    ("architect", "Implementation Scaffolding"),
    ("guardian", "Monitoring Agent"),
]

st.set_page_config(page_title="AI-SRF Strategic Workspace", layout="wide", initial_sidebar_state="expanded")

st.markdown(
    """
    <style>
    .stApp { background: #f8f6f1; color: #18202f; }
    section[data-testid="stSidebar"] { background: #111827; color: #f8f6f1; }
    .workspace-header { border-bottom: 1px solid #d7d1c5; padding: 0.4rem 0 0.8rem 0; margin-bottom: 0.8rem; }
    .eyebrow { color: #8a4b1f; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    .panel { background: #ffffff; border: 1px solid #ded8cd; border-radius: 6px; padding: 0.9rem; min-height: 160px; }
    .panel h3 { font-size: 0.86rem; margin: 0 0 0.5rem 0; color: #111827; text-transform: uppercase; letter-spacing: 0.04em; }
    .stage-done { color: #2f6f4e; font-weight: 700; }
    .stage-active { color: #9a4f18; font-weight: 800; }
    .stage-pending { color: #a09a8e; }
    .monitoring { border-left: 4px solid #2f6f4e; }
    </style>
    """,
    unsafe_allow_html=True,
)


def initialise_state() -> None:
    if "stage" not in st.session_state:
        st.session_state.stage = 1
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "run_id" not in st.session_state:
        st.session_state.run_id = f"CASE-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    if "case_state" not in st.session_state:
        st.session_state.case_state = {}


def fetch_case(run_id: str) -> Dict[str, Any]:
    try:
        response = httpx.get(f"{BACKEND_URL}/api/runs/{run_id}", timeout=8)
        if response.status_code == 200:
            return response.json().get("case", {})
    except httpx.HTTPError:
        return {}
    return {}


def fetch_audit(run_id: str) -> List[Dict[str, Any]]:
    try:
        response = httpx.get(f"{BACKEND_URL}/api/runs/{run_id}/audit", timeout=8)
        return response.json().get("audit", [])
    except httpx.HTTPError:
        return []


def run_stage(user_input: str) -> None:
    payload = {
        "messages": [{"role": message["role"], "content": message["content"]} for message in st.session_state.messages],
        "stage": st.session_state.stage,
        "run_id": st.session_state.run_id,
        "sector": st.session_state.sector,
        "risk_state": st.session_state.risk_state,
    }
    response = httpx.post(f"{BACKEND_URL}/api/conversation", json=payload, timeout=60)
    response.raise_for_status()
    data = response.json()
    if data.get("error"):
        st.session_state.case_state = data.get("case_state", {})
        st.warning(data["error"])
        return
    st.session_state.messages.append(
        {
            "role": "assistant",
            "content": data.get("raw", ""),
            "json": data.get("content", {}),
            "agent": data.get("agent", "AI-SRF Agent"),
        }
    )
    st.session_state.case_state = data.get("case_state") or fetch_case(st.session_state.run_id)
    st.session_state.stage = st.session_state.case_state.get("current_stage", st.session_state.stage)


def pending_approval(case_state: Dict[str, Any]) -> Dict[str, Any] | None:
    for gate in reversed(case_state.get("approval_gates", [])):
        if gate.get("status") == "pending":
            return gate
    return None


def decide_approval(approval_id: str, approved: bool) -> None:
    payload = {
        "approved": approved,
        "reviewer": "workspace_user",
        "notes": "Approved in Streamlit workspace." if approved else "Rejected in Streamlit workspace.",
    }
    response = httpx.post(
        f"{BACKEND_URL}/api/runs/{st.session_state.run_id}/approvals/{approval_id}",
        json=payload,
        timeout=15,
    )
    response.raise_for_status()
    st.session_state.case_state = response.json().get("case", {})
    st.session_state.stage = st.session_state.case_state.get("current_stage", st.session_state.stage)


def panel(title: str, body: Any, extra_class: str = "") -> None:
    st.markdown(f'<div class="panel {extra_class}"><h3>{title}</h3>', unsafe_allow_html=True)
    if body:
        st.json(body)
    else:
        st.caption("No structured output captured yet.")
    st.markdown("</div>", unsafe_allow_html=True)


initialise_state()

with st.sidebar:
    st.markdown("## AI-SRF Governance")
    st.session_state.run_id = st.text_input("Decision case", st.session_state.run_id)
    st.session_state.sector = st.selectbox(
        "Sector",
        ["financial_services", "mining", "retail", "public_sector", "other"],
        index=0,
    )
    st.session_state.risk_state = st.selectbox("Risk state", ["ELEVATED", "NORMAL", "CRITICAL"], index=0)
    st.divider()
    st.markdown("### Pipeline")
    for index, (_, label) in enumerate(STAGES, start=1):
        if st.session_state.stage == index:
            st.markdown(f'<span class="stage-active">{index}. {label} - active</span>', unsafe_allow_html=True)
        elif st.session_state.stage > index:
            st.markdown(f'<span class="stage-done">{index}. {label} - complete</span>', unsafe_allow_html=True)
        else:
            st.markdown(f'<span class="stage-pending">{index}. {label}</span>', unsafe_allow_html=True)
    st.divider()
    if st.button("Refresh Case"):
        st.session_state.case_state = fetch_case(st.session_state.run_id)
    if st.button("Reset Workspace"):
        st.session_state.clear()
        st.rerun()

st.markdown(
    f"""
    <div class="workspace-header">
      <div class="eyebrow">Governance-first strategic decision platform</div>
      <h1>AI-SRF Strategic Workspace</h1>
      <p>Case <strong>{st.session_state.run_id}</strong> uses human-gated, auditable agent progression.</p>
    </div>
    """,
    unsafe_allow_html=True,
)

case_state = st.session_state.case_state or fetch_case(st.session_state.run_id)
audit = fetch_audit(st.session_state.run_id)
gate = pending_approval(case_state)

top_left, top_right = st.columns([2, 1])
with top_left:
    st.subheader("Active Stage")
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            if message.get("agent"):
                st.caption(message["agent"])
            st.markdown(message["content"] or "Structured response received.")
            if message.get("json"):
                with st.expander("Structured output"):
                    st.json(message["json"])

    user_input = st.chat_input("Add context, approve a gate, or challenge an assumption...")
    if user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})
        with st.spinner("Executing governed stage..."):
            try:
                run_stage(user_input)
                st.rerun()
            except httpx.HTTPError as exc:
                st.error(f"AI-SRF API error: {exc}")

with top_right:
    st.subheader("Monitoring Agent")
    monitoring_rules = case_state.get("monitoring_rules", [])
    panel("Ongoing Status", {"status": case_state.get("status", "not started"), "rules": monitoring_rules}, "monitoring")
    if gate:
        st.warning(f"Human approval required for stage {gate['stage_id']} before progression.")
        approve_col, reject_col = st.columns(2)
        with approve_col:
            if st.button("Approve Gate", type="primary"):
                try:
                    decide_approval(gate["approval_id"], True)
                    st.rerun()
                except httpx.HTTPError as exc:
                    st.error(f"Approval failed: {exc}")
        with reject_col:
            if st.button("Reject Gate"):
                try:
                    decide_approval(gate["approval_id"], False)
                    st.rerun()
                except httpx.HTTPError as exc:
                    st.error(f"Rejection failed: {exc}")

st.divider()

briefing, stage, evidence, assumptions = st.columns(4)
with briefing:
    panel("Situational Briefing", case_state.get("stage_outputs", {}).get("1"))
with stage:
    panel("Current Stage", {"stage": case_state.get("current_stage", st.session_state.stage), "status": case_state.get("status", "active")})
with evidence:
    panel("Evidence", case_state.get("evidence_bundle"))
with assumptions:
    panel("Assumptions", case_state.get("assumptions"))

options, stress, roadmap, trace = st.columns(4)
with options:
    panel("Options", case_state.get("options_generated"))
with stress:
    panel("Stress Tests", case_state.get("devil_advocate_findings"))
with roadmap:
    panel("Implementation Roadmap", case_state.get("implementation_plan"))
with trace:
    panel("Audit Trace", {"events": len(audit), "latest": audit[-1] if audit else None})

with st.expander("Replay Audit Log", expanded=False):
    if audit:
        for event in audit:
            st.json(event)
    else:
        st.caption("No replay events available for this case yet.")
