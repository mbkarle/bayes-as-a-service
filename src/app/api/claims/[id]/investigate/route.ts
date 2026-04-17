import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { investigate, DEFAULT_BUDGET, type InvestigationBudget } from "@/lib/llm/investigate";

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

  try {
    const result = await investigate(supabase, id, budget);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Investigation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
