import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sigmoid } from "@/lib/engine/math";

/**
 * GET /api/graph?limit=200&offset=0
 * Returns all nodes and edges for the global graph explorer.
 */
export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);

  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);
  const offset = Number(searchParams.get("offset") ?? 0);

  // Fetch nodes with pagination
  const { data: nodes, error: nodesError, count } = await supabase
    .from("nodes")
    .select("id, text, type, log_odds_prior, log_odds_posterior, evidence_weight, convergence_status, source, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (nodesError) {
    return NextResponse.json({ error: nodesError.message }, { status: 500 });
  }

  const nodeIds = (nodes ?? []).map((n) => n.id);

  // Fetch edges where both parent and child are in the current node set
  const { data: edges, error: edgesError } = await supabase
    .from("edges")
    .select("id, parent_id, child_id, log_lr_positive, log_lr_negative, relevance_weight, reasoning")
    .or(`parent_id.in.(${nodeIds.join(",")}),child_id.in.(${nodeIds.join(",")})`)

  if (edgesError) {
    return NextResponse.json({ error: edgesError.message }, { status: 500 });
  }

  // Add probability to nodes
  const nodesWithProb = (nodes ?? []).map((n) => ({
    ...n,
    probability: sigmoid(n.log_odds_posterior),
  }));

  return NextResponse.json({
    nodes: nodesWithProb,
    edges: edges ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
