import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/embedding";

/**
 * POST /api/graph/backfill-embeddings
 * Generates embeddings for all claims that are missing them.
 * Safe to call multiple times — only processes claims with null embeddings.
 */
export async function POST() {
  const supabase = createServiceClient();

  // Find claims missing embeddings
  const { data: claims, error } = await supabase
    .from("claim_metadata")
    .select("node_id, nodes!inner(text)")
    .is("embedding", null)
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!claims || claims.length === 0) {
    return NextResponse.json({ updated: 0, message: "All claims already have embeddings" });
  }

  const texts = claims.map((c) => {
    const node = c.nodes as unknown as { text: string };
    return node.text;
  });

  // Batch embed
  let embeddings: number[][];
  try {
    embeddings = await embed(texts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Embedding generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Update each claim_metadata row
  let updated = 0;
  for (let i = 0; i < claims.length; i++) {
    const embeddingStr = `[${embeddings[i].join(",")}]`;
    const { error: updateError } = await supabase
      .from("claim_metadata")
      .update({ embedding: embeddingStr })
      .eq("node_id", claims[i].node_id);

    if (updateError) {
      console.error(`Failed to update embedding for ${claims[i].node_id}:`, updateError);
    } else {
      updated++;
    }
  }

  return NextResponse.json({ updated, total: claims.length });
}
