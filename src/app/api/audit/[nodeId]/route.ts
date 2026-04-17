import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const { nodeId } = await params;
  const supabase = createServiceClient();

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const { data, error, count } = await supabase
    .from("update_log")
    .select("*", { count: "exact" })
    .eq("node_id", nodeId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    entries: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
