import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { propagate } from "@/lib/engine/propagation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const body = await request.json();

  // Fetch existing edge to get parent_id for propagation
  const { data: existing, error: fetchError } = await supabase
    .from("edges")
    .select("parent_id, log_lr_positive, log_lr_negative, relevance_weight")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Edge not found" }, { status: 404 });
  }

  const updates: {
    log_lr_positive?: number;
    log_lr_negative?: number;
    relevance_weight?: number;
    reasoning?: string;
  } = {};

  if (body.log_lr_positive !== undefined) {
    updates.log_lr_positive = body.log_lr_positive;
  }
  if (body.log_lr_negative !== undefined) {
    updates.log_lr_negative = body.log_lr_negative;
  }

  if (body.relevance_weight !== undefined) {
    updates.relevance_weight = body.relevance_weight;
  }
  if (body.reasoning !== undefined) {
    updates.reasoning = body.reasoning;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("edges")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Propagate from the parent node
  const summary = await propagate(supabase, existing.parent_id, id);

  return NextResponse.json({ edge: data, propagation: summary });
}
