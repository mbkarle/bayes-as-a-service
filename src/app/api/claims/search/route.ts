import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const DUPLICATE_THRESHOLD = 0.95;
const RELATED_THRESHOLD = 0.75;

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();

  const { text, embedding } = body as {
    text: string;
    embedding?: number[];
  };

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // If no embedding provided, we can't do vector search yet.
  // Fall back to text-based search.
  if (!embedding) {
    const { data, error } = await supabase
      .from("nodes")
      .select("*, claim_metadata(*)")
      .eq("type", "CLAIM")
      .ilike("text", `%${text}%`)
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      duplicates: [],
      related: data ?? [],
      search_type: "text_fallback",
    });
  }

  // Vector similarity search using pgvector
  // Uses a raw RPC call since Supabase JS doesn't have native vector search syntax.
  // We need a database function for this — for now use a raw query approach.
  const embeddingStr = `[${embedding.join(",")}]`;

  const { data, error } = await supabase.rpc("search_claims_by_embedding", {
    query_embedding: embeddingStr,
    match_threshold: RELATED_THRESHOLD,
    match_count: 20,
  });

  if (error) {
    // If the RPC function doesn't exist yet, fall back to text search
    if (error.message.includes("search_claims_by_embedding")) {
      const { data: textData } = await supabase
        .from("nodes")
        .select("*, claim_metadata(*)")
        .eq("type", "CLAIM")
        .ilike("text", `%${text}%`)
        .limit(20);

      return NextResponse.json({
        duplicates: [],
        related: textData ?? [],
        search_type: "text_fallback",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = (data ?? []) as Array<{
    node_id: string;
    text: string;
    similarity: number;
    log_odds_posterior: number;
    evidence_weight: number;
  }>;

  const duplicates = results.filter((r) => r.similarity >= DUPLICATE_THRESHOLD);
  const related = results.filter(
    (r) => r.similarity >= RELATED_THRESHOLD && r.similarity < DUPLICATE_THRESHOLD
  );

  return NextResponse.json({
    duplicates,
    related,
    search_type: "vector",
  });
}
