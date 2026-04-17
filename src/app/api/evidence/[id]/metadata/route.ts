import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("evidence_metadata")
    .select("*")
    .eq("node_id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Evidence metadata not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
