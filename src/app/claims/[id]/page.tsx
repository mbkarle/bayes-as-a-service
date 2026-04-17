"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchNeighborhood, fetchAnalysis } from "@/lib/api";
import type { NeighborhoodResponse, AnalysisResponse, Contribution } from "@/lib/types";
import PosteriorDisplay from "@/components/PosteriorDisplay";
import ChildContributionList from "@/components/ChildContributionList";
import NeighborhoodGraph from "@/components/NeighborhoodGraph";
import InvestigationDialog from "@/components/InvestigationDialog";
import { useRealtimeNodes } from "@/hooks/useRealtimeNodes";

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [neighborhood, setNeighborhood] = useState<NeighborhoodResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const n = await fetchNeighborhood(id);
      setNeighborhood(n);
      setError(null);
      // Analysis is non-critical — load it separately
      fetchAnalysis(id).then(setAnalysis).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load claim");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: collect all visible node IDs and subscribe
  const visibleNodeIds = neighborhood
    ? [
        neighborhood.node.id,
        ...neighborhood.children.map((c) => c.node.id),
        ...neighborhood.parents.map((p) => p.node.id),
      ]
    : [];

  const { updatedNodes, propagating } = useRealtimeNodes(visibleNodeIds);

  // When realtime updates come in, refresh data
  useEffect(() => {
    if (Object.keys(updatedNodes).length > 0) {
      loadData();
    }
  }, [updatedNodes, loadData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-64 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (error || !neighborhood) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error ?? "Claim not found"}
        </div>
      </div>
    );
  }

  const node = neighborhood.node;
  const contributions = analysis?.contributions ?? [];
  const conflicts = analysis?.conflicts;
  const keyUncertainties = analysis?.keyUncertainties ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="space-y-4">
        {neighborhood.parents.length > 0 && (
          <div className="flex gap-2 text-sm text-muted">
            {neighborhood.parents.map((p) => (
              <Link
                key={p.node.id}
                href={`/claims/${p.node.id}`}
                className="text-accent hover:underline"
              >
                &larr; {p.node.text}
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {node.type}
              </span>
              <span className="text-xs text-muted">
                {node.source.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
            <h1 className="text-2xl font-bold">{node.text}</h1>
          </div>
        </div>

        {propagating && (
          <div className="flex items-center gap-2 text-sm text-accent">
            <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
            Propagating updates...
          </div>
        )}

        <PosteriorDisplay
          probability={node.probability}
          evidenceWeight={node.evidence_weight}
          convergenceStatus={node.convergence_status}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <InvestigationDialog claimId={id} onComplete={() => loadData()} />
        <Link
          href={`/claims/${id}/audit`}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Audit Log
        </Link>
      </div>

      {/* Conflicts alert */}
      {conflicts?.supporting && conflicts?.undermining && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Conflicting evidence detected
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            {conflicts.supporting.length} supporting vs{" "}
            {conflicts.undermining.length} undermining contributions.
          </p>
        </div>
      )}

      {/* Key uncertainties */}
      {keyUncertainties.length > 0 && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 dark:border-blue-700 dark:bg-blue-950">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Key uncertainties
          </p>
          <ul className="mt-1 text-sm text-blue-700 dark:text-blue-300 list-disc list-inside">
            {keyUncertainties.map((u: Contribution) => (
              <li key={u.edgeId}>
                <Link href={`/claims/${u.childId}`} className="hover:underline">
                  {u.childText}
                </Link>
                {" "}(high relevance, low evidence)
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Graph */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Neighborhood</h2>
        <NeighborhoodGraph data={neighborhood} />
      </section>

      {/* Contributions table */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Child Contributions
          <span className="text-sm font-normal text-muted ml-2">
            sorted by |contribution|
          </span>
        </h2>
        <ChildContributionList contributions={contributions} />
      </section>
    </div>
  );
}
