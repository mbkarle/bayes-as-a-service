import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getDefaultPerspectiveId } from "@/lib/supabase/perspective";
import { propagate } from "@/lib/engine/propagation";

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();

  const { parent_id, child_id, log_lr_positive, log_lr_negative, relevance_weight, reasoning } =
    body as {
      parent_id: string;
      child_id: string;
      log_lr_positive: number;
      log_lr_negative: number;
      relevance_weight: number;
      reasoning?: string;
    };

  if (!parent_id || !child_id || log_lr_positive === undefined || log_lr_negative === undefined || !relevance_weight) {
    return NextResponse.json(
      { error: "parent_id, child_id, log_lr_positive, log_lr_negative, and relevance_weight are required" },
      { status: 400 }
    );
  }

  const perspectiveId = await getDefaultPerspectiveId(supabase);

  const { data, error } = await supabase
    .from("edges")
    .insert({
      parent_id,
      child_id,
      log_lr_positive,
      log_lr_negative,
      relevance_weight,
      reasoning: reasoning ?? null,
      perspective_id: perspectiveId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Propagate from the parent (it has a new child)
  const summary = await propagate(supabase, parent_id, data.id);

  return NextResponse.json({ edge: data, propagation: summary }, { status: 201 });
}
