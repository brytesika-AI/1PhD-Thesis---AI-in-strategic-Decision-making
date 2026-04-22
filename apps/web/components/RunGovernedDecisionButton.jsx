import React from "react";

export const API_BASE = "https://ai-srf-governance-worker.bryte-sika.workers.dev";

export function RunGovernedDecisionButton({
  user,
  currentCaseId,
  selectedStage,
  onSuccess,
  onUnauthorized,
  onError,
  apiBase = API_BASE
}) {
  const [loading, setLoading] = React.useState(false);
  const canRun = user?.role === "analyst" || user?.role === "admin";

  async function runGovernedDecisionCycle() {
    if (!canRun || loading) return;
    setLoading(true);
    const payload = {
      case_id: currentCaseId,
      entry_stage: selectedStage
    };
    console.log("Running decision loop", payload);
    try {
      const response = await fetch(`${apiBase}/api/decision/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.status === 401) {
        onUnauthorized?.();
        return;
      }

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Execution failed");
      onSuccess?.(payload);
    } catch (error) {
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }

  if (!canRun) return null;

  return (
    <button
      type="button"
      onClick={runGovernedDecisionCycle}
      disabled={loading}
      style={{
        width: "100%",
        minHeight: 46,
        border: 0,
        borderRadius: 8,
        background: "#C8922A",
        color: "#111821",
        fontWeight: 850,
        cursor: loading ? "progress" : "pointer"
      }}
    >
      {loading ? "Running governed cycle" : "Run Governed Decision Cycle"}
    </button>
  );
}
