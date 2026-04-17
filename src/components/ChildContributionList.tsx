"use client";

import Link from "next/link";
import type { Contribution } from "@/lib/types";

interface ChildContributionListProps {
  contributions: Contribution[];
}

function formatLogLR(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}`;
}

function contributionColor(v: number): string {
  if (v > 0.01) return "text-positive";
  if (v < -0.01) return "text-negative";
  return "text-muted";
}

function typeBadge(type: "CLAIM" | "EVIDENCE") {
  if (type === "EVIDENCE") {
    return (
      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
        Evidence
      </span>
    );
  }
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      Claim
    </span>
  );
}

export default function ChildContributionList({
  contributions,
}: ChildContributionListProps) {
  if (contributions.length === 0) {
    return (
      <p className="py-4 text-sm text-muted">
        No children. Investigate this claim to add sub-claims and evidence.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="pb-2 pr-4 font-medium">Child</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 pr-4 font-medium text-right">Contribution</th>
            <th className="pb-2 pr-4 font-medium text-right">Weight</th>
            <th className="pb-2 font-medium">Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((c) => {
            const href =
              c.childType === "EVIDENCE"
                ? `/evidence/${c.childId}`
                : `/claims/${c.childId}`;
            return (
              <tr
                key={c.edgeId}
                className="border-b border-border last:border-0"
              >
                <td className="py-2.5 pr-4">
                  <Link
                    href={href}
                    className="text-accent hover:underline"
                  >
                    {c.childText}
                  </Link>
                </td>
                <td className="py-2.5 pr-4">{typeBadge(c.childType)}</td>
                <td
                  className={`py-2.5 pr-4 text-right font-mono ${contributionColor(c.weightedLogLR)}`}
                >
                  {formatLogLR(c.weightedLogLR)}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono text-muted">
                  {c.relevanceWeight.toFixed(2)}
                </td>
                <td className="py-2.5 text-muted max-w-xs truncate">
                  {c.reasoning ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
