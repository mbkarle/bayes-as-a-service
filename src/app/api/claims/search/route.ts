import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/embedding";

const DUPLICATE_THRESHOLD = 0.95;
const RELATED_THRESHOLD = 0.75;

async function textFallback(supabase: ReturnType<typeof createServiceClient>, text: string) {
  const { data } = await supabase
    .from("nodes")
    .select("*, claim_metadata(*)")
    .eq("type", "CLAIM")
    .ilike("text", `%${text}%`)
    .limit(20);

  return NextResponse.json({
    duplicates: [],
    related: data ?? [],
    search_type: "text_fallback",
  });
}

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();

  const { text } = body as { text: string };

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Try to generate an embedding for vector search
  let embedding: number[];
  try {
    embedding = await embedQuery(text);
  } catch (e) {
    console.warn("Embedding generation failed, falling back to text search:", e);
    return textFallback(supabase, text);
  }

  const embeddingStr = `[${embedding.join(",")}]`;

  const { data, error } = await supabase.rpc("search_claims_by_embedding", {
    query_embedding: embeddingStr,
    match_threshold: RELATED_THRESHOLD,
    match_count: 20,
  });

  if (error) {
    console.warn("Vector search failed, falling back to text search:", error.message);
    return textFallback(supabase, text);
  }

  const results = (data ?? []) as Array<{
    node_id: string;
    text: string;
    similarity: number;
    log_odds_posterior: number;
    evidence_weight: number;
  }>;

  // If vector search returned nothing, existing claims may lack embeddings.
  // Fall back to text search so users still see results.
  if (results.length === 0) {
    return textFallback(supabase, text);
  }

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
