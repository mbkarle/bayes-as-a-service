import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getDefaultPerspectiveId } from "@/lib/supabase/perspective";
import { propagate } from "@/lib/engine/propagation";
import type { Json } from "@/lib/supabase/database.types";

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();

  const {
    text,
    parent_id,
    log_odds_prior,
    log_lr_positive,
    log_lr_negative,
    relevance_weight,
    reasoning,
    metadata,
  } = body as {
    text: string;
    parent_id: string;
    log_odds_prior: number;
    log_lr_positive: number;
    log_lr_negative: number;
    relevance_weight: number;
    reasoning?: string;
    metadata?: {
      source_url?: string;
      source_type?: string;
      publication_date?: string;
      authors?: string[];
      journal_or_publisher?: string;
      provenance_tier?: number;
      methodology_notes?: Json;
      content_summary?: string;
    };
  };

  if (!text || !parent_id || log_odds_prior === undefined || log_lr_positive === undefined || log_lr_negative === undefined || !relevance_weight) {
    return NextResponse.json(
      { error: "text, parent_id, log_odds_prior, log_lr_positive, log_lr_negative, and relevance_weight are required" },
      { status: 400 }
    );
  }

  const perspectiveId = await getDefaultPerspectiveId(supabase);

  // Create evidence node
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      text,
      type: "EVIDENCE" as const,
      log_odds_prior,
      log_odds_posterior: log_odds_prior, // Evidence nodes: posterior = prior
      source: "LLM_EVIDENCE_SEARCH" as const,
      perspective_id: perspectiveId,
    })
    .select()
    .single();

  if (nodeError) {
    return NextResponse.json({ error: nodeError.message }, { status: 500 });
  }

  // Create evidence metadata
  if (metadata) {
    const { error: metaError } = await supabase.from("evidence_metadata").insert({
      node_id: node.id,
      source_url: metadata.source_url ?? null,
      source_type: (metadata.source_type as "JOURNAL_ARTICLE" | "PREPRINT" | "SURVEY" | "NEWS_ARTICLE" | "REPORT" | "BOOK" | "OTHER") ?? null,
      publication_date: metadata.publication_date ?? null,
      authors: (metadata.authors ?? []) as Json,
      journal_or_publisher: metadata.journal_or_publisher ?? null,
      provenance_tier: metadata.provenance_tier ?? null,
      methodology_notes: (metadata.methodology_notes ?? {}) as Json,
      content_summary: metadata.content_summary ?? null,
    });

    if (metaError) {
      console.error("Failed to create evidence metadata:", metaError);
    }
  } else {
    // Create empty metadata row
    const { error: metaError } = await supabase
      .from("evidence_metadata")
      .insert({ node_id: node.id });
    if (metaError) {
      console.error("Failed to create evidence metadata:", metaError);
    }
  }

  // Create edge from evidence to parent claim
  const { data: edge, error: edgeError } = await supabase
    .from("edges")
    .insert({
      parent_id,
      child_id: node.id,
      log_lr_positive,
      log_lr_negative,
      relevance_weight,
      reasoning: reasoning ?? null,
      perspective_id: perspectiveId,
    })
    .select()
    .single();

  if (edgeError) {
    return NextResponse.json({ error: edgeError.message }, { status: 500 });
  }

  // Propagate from the parent claim
  const summary = await propagate(supabase, parent_id, edge.id);

  return NextResponse.json(
    { node, edge, propagation: summary },
    { status: 201 }
  );
}
