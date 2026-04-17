"use client";

import { useState } from "react";
import { investigateClaim } from "@/lib/api";
import type { InvestigationResult } from "@/lib/types";

interface InvestigationDialogProps {
  claimId: string;
  onComplete: (result: InvestigationResult) => void;
}

export default function InvestigationDialog({
  claimId,
  onComplete,
}: InvestigationDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxLlmCalls, setMaxLlmCalls] = useState(10);
  const [maxEvidence, setMaxEvidence] = useState(3);
  const [maxDepth, setMaxDepth] = useState(1);

  async function handleInvestigate() {
    setLoading(true);
    setError(null);
    try {
      const result = await investigateClaim(claimId, {
        max_llm_calls: maxLlmCalls,
        max_evidence_per_claim: maxEvidence,
        max_decomposition_depth: maxDepth,
      });
      onComplete(result);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Investigation failed");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
      >
        Investigate
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-4">
      <h3 className="text-sm font-semibold">Investigation Budget</h3>

      <div className="grid grid-cols-3 gap-4">
        <label className="space-y-1">
          <span className="text-xs text-muted">Max LLM calls</span>
          <input
            type="number"
            min={1}
            max={50}
            value={maxLlmCalls}
            onChange={(e) => setMaxLlmCalls(Number(e.target.value))}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Evidence per claim</span>
          <input
            type="number"
            min={1}
            max={10}
            value={maxEvidence}
            onChange={(e) => setMaxEvidence(Number(e.target.value))}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Decomposition depth</span>
          <input
            type="number"
            min={1}
            max={3}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-mono"
          />
        </label>
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleInvestigate}
          disabled={loading}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? "Investigating..." : "Run Investigation"}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={loading}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
