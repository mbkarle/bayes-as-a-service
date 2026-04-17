import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getDefaultPerspectiveId } from "@/lib/supabase/perspective";

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();

  const { text, type, log_odds_prior, source } = body as {
    text: string;
    type: "CLAIM" | "EVIDENCE";
    log_odds_prior?: number;
    source?: "USER" | "LLM_DECOMPOSITION" | "LLM_EVIDENCE_SEARCH";
  };

  if (!text || !type) {
    return NextResponse.json(
      { error: "text and type are required" },
      { status: 400 }
    );
  }

  const perspectiveId = await getDefaultPerspectiveId(supabase);
  const prior = log_odds_prior ?? 0.0;

  const { data, error } = await supabase
    .from("nodes")
    .insert({
      text,
      type,
      log_odds_prior: prior,
      log_odds_posterior: prior, // Initialize posterior = prior
      source: source ?? "USER",
      perspective_id: perspectiveId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
