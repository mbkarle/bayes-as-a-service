import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { propagate } from "@/lib/engine/propagation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("nodes")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({
    ...data,
    probability: 1 / (1 + Math.exp(-data.log_odds_posterior)),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const body = await request.json();

  const updates: { log_odds_prior?: number; text?: string } = {};
  if (body.log_odds_prior !== undefined) {
    updates.log_odds_prior = body.log_odds_prior;
  }
  if (body.text !== undefined) {
    updates.text = body.text;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("nodes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If prior changed, trigger propagation
  if (body.log_odds_prior !== undefined) {
    const summary = await propagate(supabase, id);
    return NextResponse.json({ node: data, propagation: summary });
  }

  return NextResponse.json(data);
}
