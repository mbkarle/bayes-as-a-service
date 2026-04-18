"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { searchClaims, createClaim, investigateClaim } from "@/lib/api";

interface SearchResult {
  node_id: string;
  text: string;
  similarity?: number;
}

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [duplicates, setDuplicates] = useState<SearchResult[]>([]);
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setError(null);
    setDuplicates([]);
    setRelated([]);
    setSearched(false);

    try {
      const results = await searchClaims(query.trim());
      setDuplicates(results.duplicates ?? []);
      setRelated(results.related ?? []);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function handleCreateAndInvestigate() {
    setCreating(true);
    setError(null);
    try {
      const { node } = await createClaim(query.trim());
      // Fire investigation in background, navigate immediately
      investigateClaim(node.id).catch(console.error);
      router.push(`/claims/${node.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create claim");
      setCreating(false);
    }
  }

  const hasResults = duplicates.length > 0 || related.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-3xl font-bold tracking-tight">
          Bayes as a Service
        </h1>
        <p className="text-muted text-lg">
          Type in a claim for investigation.
        </p>
      </div>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. "Remote work increases productivity"'
            className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-base placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
      </form>
      <p className="text-muted text-sm mt-4">
        *N.B.: despite efforts explicitly to the contrary, current results may feature extensive motivated reasoning.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {searched && (
        <div className="mt-8 space-y-6">
          {duplicates.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted mb-3">
                Existing matches
              </h2>
              <div className="space-y-2">
                {duplicates.map((d) => (
                  <button
                    key={d.node_id}
                    onClick={() => router.push(`/claims/${d.node_id}`)}
                    className="w-full text-left rounded-lg border border-border p-4 hover:border-accent transition-colors"
                  >
                    <p className="font-medium">{d.text}</p>
                    {d.similarity != null && (
                      <p className="text-sm text-muted mt-1">
                        Similarity: {(d.similarity * 100).toFixed(0)}%
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {related.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted mb-3">
                Related claims
              </h2>
              <div className="space-y-2">
                {related.map((r) => (
                  <button
                    key={r.node_id}
                    onClick={() => router.push(`/claims/${r.node_id}`)}
                    className="w-full text-left rounded-lg border border-border p-4 hover:border-accent transition-colors"
                  >
                    <p className="font-medium">{r.text}</p>
                    {r.similarity != null && (
                      <p className="text-sm text-muted mt-1">
                        Similarity: {(r.similarity * 100).toFixed(0)}%
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {!hasResults && (
            <section className="text-center space-y-4 py-6">
              <p className="text-muted">
                No existing claims match. Create and investigate this one?
              </p>
              <button
                onClick={handleCreateAndInvestigate}
                disabled={creating}
                className="rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {creating
                  ? "Creating..."
                  : "Create & Investigate"}
              </button>
            </section>
          )}

          {hasResults && (
            <section className="border-t border-border pt-6 text-center space-y-3">
              <p className="text-sm text-muted">
                Not what you&apos;re looking for?
              </p>
              <button
                onClick={handleCreateAndInvestigate}
                disabled={creating}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                {creating
                  ? "Creating..."
                  : "Create as new claim & investigate"}
              </button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
