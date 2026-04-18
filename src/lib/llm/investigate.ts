/**
 * Investigation orchestrator.
 * Coordinates LLM calls for claim decomposition, evidence search, and assessment.
 * See: MVP-IMPLEMENTATION.md §4.1, §4.5
 */

import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { Json } from "../supabase/database.types";
import { getDefaultPerspectiveId } from "../supabase/perspective";
import { logit } from "../engine/math";
import { propagate } from "../engine/propagation";
import { decomposeClaim } from "./prompts/decompose";
import { assessEdge } from "./prompts/assess-edge";
import { assessEvidence } from "./prompts/assess-evidence";
import { getAnthropicClient, DEFAULT_MODEL } from "./client";
import { embedOne } from "../embedding";

export interface InvestigationBudget {
  maxDecompositionDepth: number;
  maxEvidencePerClaim: number;
  maxLlmCalls: number;
}

export const DEFAULT_BUDGET: InvestigationBudget = {
  maxDecompositionDepth: 1,
  maxEvidencePerClaim: 3,
  maxLlmCalls: 10,
};

export interface InvestigationResult {
  claimId: string;
  nodesCreated: Array<{ id: string; text: string; type: string }>;
  edgesCreated: Array<{ id: string; parentId: string; childId: string }>;
  llmCallsUsed: number;
  budgetExhausted: boolean;
}

/**
 * Search for evidence related to a claim using the LLM.
 * Returns a list of evidence descriptions (not yet created in the DB).
 */
async function searchEvidence(
  claimText: string
): Promise<Array<{ text: string; sourceUrl?: string }>> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: `You are a research assistant finding evidence for or against a claim. For each piece of evidence, provide the key finding as a factual statement and a source URL if you can identify one.

Find 2-3 pieces of evidence. Include evidence on BOTH sides (supporting and contradicting) if available. Prioritize peer-reviewed sources.

Respond with a JSON array:
[
  {
    "text": "Factual description of the finding or evidence",
    "source_url": "URL if available, or null"
  }
]`,
    messages: [
      {
        role: "user",
        content: `Find evidence relevant to this claim:\n\n"${claimText}"`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "[]";
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  return JSON.parse(jsonMatch[1]!.trim()) as Array<{
    text: string;
    source_url?: string;
  }>;
}

/**
 * Run a scoped investigation of a claim.
 * Decomposes the claim, searches for evidence, assesses everything,
 * and creates nodes + edges in the database.
 */
export async function investigate(
  supabase: SupabaseClient<Database>,
  claimId: string,
  budget: InvestigationBudget = DEFAULT_BUDGET
): Promise<InvestigationResult> {
  let llmCallsUsed = 0;
  const nodesCreated: InvestigationResult["nodesCreated"] = [];
  const edgesCreated: InvestigationResult["edgesCreated"] = [];
  const perspectiveId = await getDefaultPerspectiveId(supabase);

  // Fetch the claim
  const { data: claim, error: claimError } = await supabase
    .from("nodes")
    .select("id, text, type")
    .eq("id", claimId)
    .single();

  if (claimError || !claim) {
    throw new Error(`Claim ${claimId} not found`);
  }

  // Fetch existing children
  const { data: existingEdges } = await supabase
    .from("edges")
    .select("child_id, nodes!edges_child_id_fkey(id, text)")
    .eq("parent_id", claimId);

  const existingChildren = (existingEdges ?? []).map((e) => {
    const child = e.nodes as unknown as { id: string; text: string };
    return { id: child.id, text: child.text };
  });

  // Fetch related nodes — prefer vector search, fall back to text
  let relatedForDecompose: Array<{ id: string; text: string; similarity: number }> = [];
  try {
    const claimEmbedding = await embedOne(claim.text);
    const embeddingStr = `[${claimEmbedding.join(",")}]`;
    const { data: vectorResults } = await supabase.rpc("search_claims_by_embedding", {
      query_embedding: embeddingStr,
      match_threshold: 0.5,
      match_count: 10,
    });
    if (vectorResults && vectorResults.length > 0) {
      relatedForDecompose = (vectorResults as Array<{ node_id: string; text: string; similarity: number }>)
        .filter((r) => r.node_id !== claimId)
        .map((r) => ({ id: r.node_id, text: r.text, similarity: r.similarity }));
    }
  } catch {
    // Fall back to simple text search
    const { data: relatedNodes } = await supabase
      .from("nodes")
      .select("id, text")
      .eq("type", "CLAIM")
      .neq("id", claimId)
      .limit(10);

    relatedForDecompose = (relatedNodes ?? []).map((n) => ({
      id: n.id,
      text: n.text,
      similarity: 0.5,
    }));
  }

  // ── Step 1: Search for DIRECT evidence on the root claim first ──
  // Direct evidence is preferred over decomposition when the claim is
  // specific enough to be directly evidenced.
  if (llmCallsUsed >= budget.maxLlmCalls) {
    return { claimId, nodesCreated, edgesCreated, llmCallsUsed, budgetExhausted: true };
  }

  const directEvidence = await searchEvidence(claim.text);
  llmCallsUsed++;

  const directEvidenceToProcess = directEvidence.slice(0, budget.maxEvidencePerClaim);

  for (const evidence of directEvidenceToProcess) {
    if (llmCallsUsed >= budget.maxLlmCalls) break;

    const credAssessment = await assessEvidence({
      evidenceText: evidence.text,
      sourceUrl: evidence.sourceUrl,
    });
    llmCallsUsed++;

    if (llmCallsUsed >= budget.maxLlmCalls) break;

    const edgeAssessment = await assessEdge({
      parentText: claim.text,
      childText: evidence.text,
      childType: "EVIDENCE",
    });
    llmCallsUsed++;

    const credLogOdds = logit(credAssessment.credibility);

    const { data: evidenceNode, error: evidenceNodeError } = await supabase
      .from("nodes")
      .insert({
        text: evidence.text,
        type: "EVIDENCE" as const,
        log_odds_prior: credLogOdds,
        log_odds_posterior: credLogOdds,
        source: "LLM_EVIDENCE_SEARCH" as const,
        perspective_id: perspectiveId,
      })
      .select()
      .single();

    if (evidenceNodeError || !evidenceNode) {
      console.error("Failed to create evidence node:", evidenceNodeError);
      continue;
    }

    nodesCreated.push({ id: evidenceNode.id, text: evidence.text, type: "EVIDENCE" });

    await supabase.from("evidence_metadata").insert({
      node_id: evidenceNode.id,
      source_url: evidence.sourceUrl ?? null,
      provenance_tier: credAssessment.provenanceTier,
      methodology_notes: credAssessment.methodologyNotes as unknown as Json,
      content_summary: credAssessment.contentSummary,
    });

    const { data: evidenceEdge, error: evidenceEdgeError } = await supabase
      .from("edges")
      .insert({
        parent_id: claimId,
        child_id: evidenceNode.id,
        log_lr_positive: edgeAssessment.logLrPositive,
        log_lr_negative: edgeAssessment.logLrNegative,
        relevance_weight: edgeAssessment.relevanceWeight,
        reasoning: edgeAssessment.reasoning,
        perspective_id: perspectiveId,
      })
      .select()
      .single();

    if (evidenceEdgeError) {
      console.error("Failed to create evidence edge:", evidenceEdgeError);
      continue;
    }

    edgesCreated.push({ id: evidenceEdge.id, parentId: claimId, childId: evidenceNode.id });
  }

  // ── Step 2: Conditionally decompose ──
  // Ask the LLM whether this claim warrants decomposition. If the claim is
  // specific and empirically testable, the direct evidence above may suffice.
  const leafClaims: Array<{ id: string; text: string }> = [];

  if (llmCallsUsed < budget.maxLlmCalls && budget.maxDecompositionDepth > 0) {
    const decomposition = await decomposeClaim({
      claimText: claim.text,
      existingChildren,
      relatedNodes: relatedForDecompose,
    });
    llmCallsUsed++;

    if (decomposition.shouldDecompose) {
      for (const subclaim of decomposition.subclaims) {
        if (llmCallsUsed >= budget.maxLlmCalls) break;

        let childId: string;

        if (subclaim.existing_node_id) {
          childId = subclaim.existing_node_id;
        } else {
          const { data: newNode, error: newNodeError } = await supabase
            .from("nodes")
            .insert({
              text: subclaim.text,
              type: "CLAIM" as const,
              log_odds_prior: 0.0,
              log_odds_posterior: 0.0,
              source: "LLM_DECOMPOSITION" as const,
              perspective_id: perspectiveId,
            })
            .select()
            .single();

          if (newNodeError || !newNode) {
            console.error("Failed to create subclaim:", newNodeError);
            continue;
          }

          childId = newNode.id;
          nodesCreated.push({ id: newNode.id, text: subclaim.text, type: "CLAIM" });

          // Generate embedding for the new subclaim (non-blocking on failure)
          let subclaimEmbedding: number[] | null = null;
          try {
            subclaimEmbedding = await embedOne(subclaim.text);
          } catch (e) {
            console.warn("Failed to embed subclaim:", e);
          }

          await supabase.from("claim_metadata").insert({
            node_id: newNode.id,
            domain_tags: [],
            ...(subclaimEmbedding ? { embedding: `[${subclaimEmbedding.join(",")}]` } : {}),
          });
        }

        const edgeAssessment = await assessEdge({
          parentText: claim.text,
          childText: subclaim.text,
          childType: "CLAIM",
        });
        llmCallsUsed++;

        const { data: newEdge, error: edgeError } = await supabase
          .from("edges")
          .insert({
            parent_id: claimId,
            child_id: childId,
            log_lr_positive: edgeAssessment.logLrPositive,
            log_lr_negative: edgeAssessment.logLrNegative,
            relevance_weight: edgeAssessment.relevanceWeight,
            reasoning: edgeAssessment.reasoning,
            perspective_id: perspectiveId,
          })
          .select()
          .single();

        if (edgeError) {
          console.error("Failed to create edge:", edgeError);
          continue;
        }

        edgesCreated.push({ id: newEdge.id, parentId: claimId, childId });
        leafClaims.push({ id: childId, text: subclaim.text });
      }

      // ── Step 3: Search for evidence on leaf sub-claims ──
      for (const leaf of leafClaims) {
        if (llmCallsUsed >= budget.maxLlmCalls) break;

        const evidenceResults = await searchEvidence(leaf.text);
        llmCallsUsed++;

        const evidenceToProcess = evidenceResults.slice(0, budget.maxEvidencePerClaim);

        for (const evidence of evidenceToProcess) {
          if (llmCallsUsed >= budget.maxLlmCalls) break;

          const credAssessment = await assessEvidence({
            evidenceText: evidence.text,
            sourceUrl: evidence.sourceUrl,
          });
          llmCallsUsed++;

          if (llmCallsUsed >= budget.maxLlmCalls) break;

          const edgeAssessment = await assessEdge({
            parentText: leaf.text,
            childText: evidence.text,
            childType: "EVIDENCE",
          });
          llmCallsUsed++;

          const credLogOdds = logit(credAssessment.credibility);

          const { data: evidenceNode, error: evidenceNodeError } = await supabase
            .from("nodes")
            .insert({
              text: evidence.text,
              type: "EVIDENCE" as const,
              log_odds_prior: credLogOdds,
              log_odds_posterior: credLogOdds,
              source: "LLM_EVIDENCE_SEARCH" as const,
              perspective_id: perspectiveId,
            })
            .select()
            .single();

          if (evidenceNodeError || !evidenceNode) {
            console.error("Failed to create evidence node:", evidenceNodeError);
            continue;
          }

          nodesCreated.push({ id: evidenceNode.id, text: evidence.text, type: "EVIDENCE" });

          await supabase.from("evidence_metadata").insert({
            node_id: evidenceNode.id,
            source_url: evidence.sourceUrl ?? null,
            provenance_tier: credAssessment.provenanceTier,
            methodology_notes: credAssessment.methodologyNotes as unknown as Json,
            content_summary: credAssessment.contentSummary,
          });

          const { data: evidenceEdge, error: evidenceEdgeError } = await supabase
            .from("edges")
            .insert({
              parent_id: leaf.id,
              child_id: evidenceNode.id,
              log_lr_positive: edgeAssessment.logLrPositive,
              log_lr_negative: edgeAssessment.logLrNegative,
              relevance_weight: edgeAssessment.relevanceWeight,
              reasoning: edgeAssessment.reasoning,
              perspective_id: perspectiveId,
            })
            .select()
            .single();

          if (evidenceEdgeError) {
            console.error("Failed to create evidence edge:", evidenceEdgeError);
            continue;
          }

          edgesCreated.push({ id: evidenceEdge.id, parentId: leaf.id, childId: evidenceNode.id });
        }
      }
    }
  }

  // ── Step 4: Propagate from the lowest nodes upward ──
  for (const leaf of leafClaims) {
    await propagate(supabase, leaf.id);
  }
  await propagate(supabase, claimId);

  return {
    claimId,
    nodesCreated,
    edgesCreated,
    llmCallsUsed,
    budgetExhausted: llmCallsUsed >= budget.maxLlmCalls,
  };
}
