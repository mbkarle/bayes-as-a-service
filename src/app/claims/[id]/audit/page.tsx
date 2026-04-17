"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchAudit, fetchNode } from "@/lib/api";
import type { AuditEntry, NodeSummary } from "@/lib/types";

function sigmoid(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds));
}

function formatProb(logOdds: number): string {
  return (sigmoid(logOdds) * 100).toFixed(2) + "%";
}

function sourceBadge(source: string) {
  const colors: Record<string, string> = {
    PROPAGATION: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    USER_MANUAL: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    LLM_DECOMPOSITION:
      "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    LLM_EVIDENCE_EVAL:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors[source] ?? colors.PROPAGATION}`}
    >
      {source.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

export default function AuditLogPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [node, setNode] = useState<NodeSummary | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 25;

  const loadPage = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      try {
        const [auditRes, nodeRes] = await Promise.all([
          fetchAudit(id, limit, newOffset),
          node ? Promise.resolve(node) : fetchNode(id),
        ]);
        setEntries(auditRes.entries);
        setTotal(auditRes.total);
        setOffset(newOffset);
        if (!node) setNode(nodeRes);
      } catch {
        // Silently fail, entries stay empty
      } finally {
        setLoading(false);
      }
    },
    [id, node]
  );

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="space-y-1">
        <Link
          href={`/claims/${id}`}
          className="text-sm text-accent hover:underline"
        >
          &larr; Back to claim
        </Link>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        {node && <p className="text-muted">{node.text}</p>}
      </div>

      {loading && entries.length === 0 ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-10 rounded bg-zinc-200 dark:bg-zinc-800"
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted py-4">No update history yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="pb-2 pr-4 font-medium">Time</th>
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    P before
                  </th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    P after
                  </th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    &Delta; log-odds
                  </th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    EW before
                  </th>
                  <th className="pb-2 font-medium text-right">EW after</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const delta = e.log_odds_after - e.log_odds_before;
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="py-2 pr-4 text-muted whitespace-nowrap">
                        {new Date(e.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">{sourceBadge(e.source)}</td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {formatProb(e.log_odds_before)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {formatProb(e.log_odds_after)}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right font-mono ${delta > 0 ? "text-positive" : delta < 0 ? "text-negative" : "text-muted"}`}
                      >
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(4)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-muted">
                        {e.evidence_weight_before.toFixed(3)}
                      </td>
                      <td className="py-2 text-right font-mono text-muted">
                        {e.evidence_weight_after.toFixed(3)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">
                {offset + 1}–{Math.min(offset + limit, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={offset === 0}
                  onClick={() => loadPage(Math.max(0, offset - limit))}
                  className="rounded border border-border px-3 py-1 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  disabled={offset + limit >= total}
                  onClick={() => loadPage(offset + limit)}
                  className="rounded border border-border px-3 py-1 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
