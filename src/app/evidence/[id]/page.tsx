"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchNeighborhood } from "@/lib/api";
import type { NeighborhoodResponse, EvidenceMetadata } from "@/lib/types";
import PosteriorDisplay from "@/components/PosteriorDisplay";

const TIER_LABELS: Record<number, string> = {
  1: "Gold standard (systematic review, meta-analysis)",
  2: "High quality (RCT, large cohort study)",
  3: "Moderate (observational, case-control)",
  4: "Low quality (case report, expert opinion)",
  5: "Anecdotal (blog, forum, personal account)",
};

export default function EvidenceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [neighborhood, setNeighborhood] = useState<NeighborhoodResponse | null>(null);
  const [metadata, setMetadata] = useState<EvidenceMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [n, metaRes] = await Promise.all([
          fetchNeighborhood(id),
          fetch(`/api/evidence/${id}/metadata`).then((r) =>
            r.ok ? r.json() : null
          ),
        ]);
        setNeighborhood(n);
        setMetadata(metaRes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load evidence");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (error || !neighborhood) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error ?? "Evidence not found"}
        </div>
      </div>
    );
  }

  const node = neighborhood.node;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            Evidence
          </span>
          <span className="text-xs text-muted">
            {node.source.replace(/_/g, " ").toLowerCase()}
          </span>
        </div>
        <h1 className="text-2xl font-bold">{node.text}</h1>

        <PosteriorDisplay
          probability={node.probability}
          evidenceWeight={node.evidence_weight}
          convergenceStatus={node.convergence_status}
          size="sm"
        />
        <p className="text-sm text-muted">
          Credibility: {(node.probability * 100).toFixed(1)}%
        </p>
      </div>

      {/* Metadata */}
      {metadata && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Source Metadata</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {metadata.source_url && (
              <>
                <dt className="text-muted font-medium">URL</dt>
                <dd>
                  <a
                    href={metadata.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline break-all"
                  >
                    {metadata.source_url}
                  </a>
                </dd>
              </>
            )}
            {metadata.source_type && (
              <>
                <dt className="text-muted font-medium">Type</dt>
                <dd>{metadata.source_type.replace(/_/g, " ")}</dd>
              </>
            )}
            {metadata.provenance_tier != null && (
              <>
                <dt className="text-muted font-medium">Provenance</dt>
                <dd>
                  Tier {metadata.provenance_tier} &mdash;{" "}
                  {TIER_LABELS[metadata.provenance_tier] ?? "Unknown"}
                </dd>
              </>
            )}
            {metadata.authors && metadata.authors.length > 0 && (
              <>
                <dt className="text-muted font-medium">Authors</dt>
                <dd>{metadata.authors.join(", ")}</dd>
              </>
            )}
            {metadata.publication_date && (
              <>
                <dt className="text-muted font-medium">Published</dt>
                <dd>{metadata.publication_date}</dd>
              </>
            )}
            {metadata.journal_or_publisher && (
              <>
                <dt className="text-muted font-medium">Journal</dt>
                <dd>{metadata.journal_or_publisher}</dd>
              </>
            )}
          </dl>

          {metadata.content_summary && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-muted mb-1">Summary</h3>
              <p className="text-sm leading-relaxed">{metadata.content_summary}</p>
            </div>
          )}
        </section>
      )}

      {/* Parent claims */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Informs these claims</h2>
        {neighborhood.parents.length === 0 ? (
          <p className="text-sm text-muted">No parent claims.</p>
        ) : (
          <div className="space-y-3">
            {neighborhood.parents.map((p) => (
              <div
                key={p.edge.id}
                className="rounded-lg border border-border p-4 space-y-2"
              >
                <Link
                  href={`/claims/${p.node.id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {p.node.text}
                </Link>
                <div className="grid grid-cols-3 gap-4 text-sm text-muted">
                  <div>
                    <span className="block text-xs">LR+</span>
                    <span className="font-mono">
                      {p.edge.log_lr_positive.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs">LR&minus;</span>
                    <span className="font-mono">
                      {p.edge.log_lr_negative.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs">Weight</span>
                    <span className="font-mono">
                      {p.edge.relevance_weight.toFixed(2)}
                    </span>
                  </div>
                </div>
                {p.edge.reasoning && (
                  <p className="text-sm text-muted">{p.edge.reasoning}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Nav */}
      <div className="border-t border-border pt-4">
        <Link
          href={`/claims/${id}/audit`}
          className="text-sm text-accent hover:underline"
        >
          View audit log &rarr;
        </Link>
      </div>
    </div>
  );
}
