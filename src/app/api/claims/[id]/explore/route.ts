import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { investigate, DEFAULT_BUDGET, type InvestigationBudget } from "@/lib/llm/investigate";

/**
 * Explore further: runs investigation on sub-claims with low evidence weight,
 * prioritizing key uncertainties.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  const body = await request.json().catch(() => ({}));

  const budget: InvestigationBudget = {
    maxDecompositionDepth:
      body.max_decomposition_depth ?? DEFAULT_BUDGET.maxDecompositionDepth,
    maxEvidencePerClaim:
      body.max_evidence_per_claim ?? DEFAULT_BUDGET.maxEvidencePerClaim,
    maxLlmCalls: body.max_llm_calls ?? DEFAULT_BUDGET.maxLlmCalls,
  };

  // Find children with low evidence weight (key uncertainties)
  const { data: edges } = await supabase
    .from("edges")
    .select(
      `
      child_id,
      relevance_weight,
      nodes!edges_child_id_fkey (
        id, text, type, evidence_weight
      )
    `
    )
    .eq("parent_id", id);

  if (!edges || edges.length === 0) {
    // No children yet — run a standard investigation on this claim
    try {
      const result = await investigate(supabase, id, budget);
      return NextResponse.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Exploration failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Sort children by: high relevance weight, low evidence weight (key uncertainties first)
  const candidates = edges
    .map((e) => {
      const child = e.nodes as unknown as {
        id: string;
        text: string;
        type: string;
        evidence_weight: number;
      };
      return {
        childId: child.id,
        childText: child.text,
        childType: child.type,
        relevanceWeight: e.relevance_weight,
        evidenceWeight: child.evidence_weight,
        // Score: higher = more worth investigating
        score: e.relevance_weight * (1 / (1 + child.evidence_weight)),
      };
    })
    .filter((c) => c.childType === "CLAIM" && c.evidenceWeight < 0.5)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return NextResponse.json({
      message: "All sub-claims are sufficiently investigated",
      nodesCreated: [],
      edgesCreated: [],
      llmCallsUsed: 0,
      budgetExhausted: false,
    });
  }

  // Investigate the top candidate
  const target = candidates[0];
  try {
    const result = await investigate(supabase, target.childId, budget);
    return NextResponse.json({
      ...result,
      exploredClaim: { id: target.childId, text: target.childText },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Exploration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
