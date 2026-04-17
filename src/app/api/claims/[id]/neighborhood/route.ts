import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sigmoid } from "@/lib/engine/math";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Fetch the claim node
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("*")
    .eq("id", id)
    .single();

  if (nodeError || !node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  // Fetch child edges with child nodes
  const { data: childEdges, error: childError } = await supabase
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
        id, text, type, log_odds_posterior, evidence_weight, convergence_status
      )
    `
    )
    .eq("parent_id", id);

  if (childError) {
    return NextResponse.json({ error: childError.message }, { status: 500 });
  }

  // Fetch parent edges with parent nodes
  const { data: parentEdges, error: parentError } = await supabase
    .from("edges")
    .select(
      `
      id,
      parent_id,
      log_lr_positive,
      log_lr_negative,
      relevance_weight,
      reasoning,
      nodes!edges_parent_id_fkey (
        id, text, type, log_odds_posterior, evidence_weight, convergence_status
      )
    `
    )
    .eq("child_id", id);

  if (parentError) {
    return NextResponse.json({ error: parentError.message }, { status: 500 });
  }

  return NextResponse.json({
    node: {
      ...node,
      probability: sigmoid(node.log_odds_posterior),
    },
    children: (childEdges ?? []).map((edge) => {
      const child = edge.nodes as unknown as {
        id: string;
        text: string;
        type: string;
        log_odds_posterior: number;
        evidence_weight: number;
        convergence_status: string;
      };
      return {
        edge: {
          id: edge.id,
          log_lr_positive: edge.log_lr_positive,
          log_lr_negative: edge.log_lr_negative,
          relevance_weight: edge.relevance_weight,
          reasoning: edge.reasoning,
        },
        node: {
          ...child,
          probability: sigmoid(child.log_odds_posterior),
        },
      };
    }),
    parents: (parentEdges ?? []).map((edge) => {
      const parent = edge.nodes as unknown as {
        id: string;
        text: string;
        type: string;
        log_odds_posterior: number;
        evidence_weight: number;
        convergence_status: string;
      };
      return {
        edge: {
          id: edge.id,
          log_lr_positive: edge.log_lr_positive,
          log_lr_negative: edge.log_lr_negative,
          relevance_weight: edge.relevance_weight,
          reasoning: edge.reasoning,
        },
        node: {
          ...parent,
          probability: sigmoid(parent.log_odds_posterior),
        },
      };
    }),
  });
}
