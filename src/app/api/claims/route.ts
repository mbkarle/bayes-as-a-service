import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getDefaultPerspectiveId } from "@/lib/supabase/perspective";

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();

  const { text, log_odds_prior, source, domain_tags } = body as {
    text: string;
    log_odds_prior?: number;
    source?: "USER" | "LLM_DECOMPOSITION" | "LLM_EVIDENCE_SEARCH";
    domain_tags?: string[];
  };

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const perspectiveId = await getDefaultPerspectiveId(supabase);
  const prior = log_odds_prior ?? 0.0;

  // Create the node
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      text,
      type: "CLAIM" as const,
      log_odds_prior: prior,
      log_odds_posterior: prior,
      source: source ?? "USER",
      perspective_id: perspectiveId,
    })
    .select()
    .single();

  if (nodeError) {
    return NextResponse.json({ error: nodeError.message }, { status: 500 });
  }

  // Create claim metadata (embedding will be populated by the LLM integration layer)
  const { error: metaError } = await supabase.from("claim_metadata").insert({
    node_id: node.id,
    domain_tags: domain_tags ?? [],
  });

  if (metaError) {
    console.error("Failed to create claim metadata:", metaError);
  }

  return NextResponse.json(node, { status: 201 });
}
