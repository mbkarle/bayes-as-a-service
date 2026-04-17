"use client";

interface PosteriorDisplayProps {
  probability: number;
  evidenceWeight: number;
  convergenceStatus: "INITIAL" | "STABLE" | "UNSTABLE";
  size?: "sm" | "lg";
}

function probabilityColor(p: number): string {
  if (p >= 0.75) return "text-positive";
  if (p <= 0.25) return "text-negative";
  return "text-foreground";
}

function barColor(p: number): string {
  if (p >= 0.75) return "bg-positive";
  if (p <= 0.25) return "bg-negative";
  if (p >= 0.6) return "bg-emerald-400";
  if (p <= 0.4) return "bg-red-400";
  return "bg-zinc-400";
}

function weightLabel(w: number): string {
  if (w === 0) return "Unexplored";
  if (w < 0.1) return "Weakly evidenced";
  if (w < 0.5) return "Partially evidenced";
  if (w < 1.0) return "Moderately evidenced";
  return "Well evidenced";
}

export default function PosteriorDisplay({
  probability,
  evidenceWeight,
  convergenceStatus,
  size = "lg",
}: PosteriorDisplayProps) {
  const pct = (probability * 100).toFixed(1);
  const isLarge = size === "lg";

  return (
    <div className={isLarge ? "space-y-2" : "space-y-1"}>
      <div className="flex items-baseline gap-2">
        <span
          className={`${probabilityColor(probability)} font-mono font-bold ${isLarge ? "text-4xl" : "text-lg"}`}
        >
          {pct}%
        </span>
        {convergenceStatus === "UNSTABLE" && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            Unstable
          </span>
        )}
        {convergenceStatus === "INITIAL" && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            No evidence
          </span>
        )}
      </div>

      {/* Probability bar */}
      <div
        className={`w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700 ${isLarge ? "h-3" : "h-1.5"}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor(probability)}`}
          style={{ width: `${probability * 100}%` }}
        />
      </div>

      {isLarge && (
        <p className="text-sm text-muted">
          Evidence weight: {evidenceWeight.toFixed(3)} &middot;{" "}
          {weightLabel(evidenceWeight)}
        </p>
      )}
    </div>
  );
}
