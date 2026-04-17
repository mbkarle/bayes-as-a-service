import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { computePosterior, sigmoid, type EdgeWithChild } from "@/lib/engine/math";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Fetch the node
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("id, text, log_odds_prior, log_odds_posterior, evidence_weight")
    .eq("id", id)
    .single();

  if (nodeError || !node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  // Fetch child edges with child nodes
  const { data: edges, error: edgeError } = await supabase
    .from("edges")
    .select(
      `
      id,
      child_id,
      log_lr_positive,
      log_lr_negative,
      relevance_weight,
      reasoning,
      nodes!edges_child_id_fkey (
        id, text, type, log_odds_posterior, evidence_weight
      )
    `
    )
    .eq("parent_id", id);

  if (edgeError) {
    return NextResponse.json({ error: edgeError.message }, { status: 500 });
  }

  if (!edges || edges.length === 0) {
    return NextResponse.json({
      node: { ...node, probability: sigmoid(node.log_odds_posterior) },
      contributions: [],
      loadBearing: [],
      keyUncertainties: [],
      conflicts: [],
    });
  }

  // Build EdgeWithChild array and compute contributions
  const edgeWithChildren: EdgeWithChild[] = edges.map((edge) => {
    const child = edge.nodes as unknown as {
      id: string;
      log_odds_posterior: number;
    };
    return {
      edgeId: edge.id,
      childId: child.id,
      logLrPositive: edge.log_lr_positive,
      logLrNegative: edge.log_lr_negative,
      relevanceWeight: edge.relevance_weight,
      childLogOddsPosterior: child.log_odds_posterior,
    };
  });

  const result = computePosterior(node.log_odds_prior, edgeWithChildren);

  // Enrich contributions with child text and metadata
  const contributions = result.contributions.map((c) => {
    const edgeData = edges.find((e) => e.id === c.edgeId)!;
    const child = edgeData.nodes as unknown as {
      id: string;
      text: string;
      type: string;
      evidence_weight: number;
    };
    return {
      edgeId: c.edgeId,
      childId: c.childId,
      childText: child.text,
      childType: child.type,
      weightedLogLR: c.weightedLogLR,
      relevanceWeight: edgeData.relevance_weight,
      childEvidenceWeight: child.evidence_weight,
      reasoning: edgeData.reasoning,
    };
  });

  // Sort by absolute contribution (load-bearing first)
  const sorted = [...contributions].sort(
    (a, b) => Math.abs(b.weightedLogLR) - Math.abs(a.weightedLogLR)
  );

  // Load-bearing: top contributors by |contribution|
  const loadBearing = sorted.filter((c) => Math.abs(c.weightedLogLR) > 0.01).slice(0, 5);

  // Key uncertainties: high relevance weight but low evidence weight
  const keyUncertainties = contributions.filter(
    (c) => c.relevanceWeight >= 0.4 && c.childEvidenceWeight < 0.1
  );

  // Conflicts: contributions with opposite signs
  const positiveContribs = contributions.filter((c) => c.weightedLogLR > 0.01);
  const negativeContribs = contributions.filter((c) => c.weightedLogLR < -0.01);
  const hasConflict = positiveContribs.length > 0 && negativeContribs.length > 0;

  return NextResponse.json({
    node: { ...node, probability: sigmoid(node.log_odds_posterior) },
    contributions: sorted,
    loadBearing,
    keyUncertainties,
    conflicts: hasConflict
      ? { supporting: positiveContribs, undermining: negativeContribs }
      : null,
  });
}
