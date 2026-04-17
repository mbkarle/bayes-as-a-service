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

  // Fetch related nodes via text search (vector search requires embedding)
  const { data: relatedNodes } = await supabase
    .from("nodes")
    .select("id, text")
    .eq("type", "CLAIM")
    .neq("id", claimId)
    .limit(10);

  const relatedForDecompose = (relatedNodes ?? []).map((n) => ({
    id: n.id,
    text: n.text,
    similarity: 0.5, // Placeholder until embeddings are available
  }));

  // Step 1: Decompose the claim
  if (llmCallsUsed >= budget.maxLlmCalls) {
    return { claimId, nodesCreated, edgesCreated, llmCallsUsed, budgetExhausted: true };
  }

  const decomposition = await decomposeClaim({
    claimText: claim.text,
    existingChildren,
    relatedNodes: relatedForDecompose,
  });
  llmCallsUsed++;

  // Step 2: Create sub-claim nodes and edges
  const leafClaims: Array<{ id: string; text: string }> = [];

  for (const subclaim of decomposition.subclaims) {
    if (llmCallsUsed >= budget.maxLlmCalls) break;

    let childId: string;

    if (subclaim.existing_node_id) {
      // Reuse existing node
      childId = subclaim.existing_node_id;
    } else {
      // Create new claim node
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

      // Create claim metadata
      await supabase.from("claim_metadata").insert({
        node_id: newNode.id,
        domain_tags: [],
      });
    }

    // Assess the edge relationship
    const edgeAssessment = await assessEdge({
      parentText: claim.text,
      childText: subclaim.text,
      childType: "CLAIM",
    });
    llmCallsUsed++;

    // Create the edge
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

    edgesCreated.push({
      id: newEdge.id,
      parentId: claimId,
      childId,
    });

    leafClaims.push({ id: childId, text: subclaim.text });
  }

  // Step 3: Search for evidence on leaf claims
  for (const leaf of leafClaims) {
    if (llmCallsUsed >= budget.maxLlmCalls) break;

    const evidenceResults = await searchEvidence(leaf.text);
    llmCallsUsed++;

    const evidenceToProcess = evidenceResults.slice(
      0,
      budget.maxEvidencePerClaim
    );

    for (const evidence of evidenceToProcess) {
      if (llmCallsUsed >= budget.maxLlmCalls) break;

      // Assess evidence credibility
      const credAssessment = await assessEvidence({
        evidenceText: evidence.text,
        sourceUrl: evidence.sourceUrl,
      });
      llmCallsUsed++;

      if (llmCallsUsed >= budget.maxLlmCalls) break;

      // Assess edge from evidence to claim
      const edgeAssessment = await assessEdge({
        parentText: leaf.text,
        childText: evidence.text,
        childType: "EVIDENCE",
      });
      llmCallsUsed++;

      // Create evidence node
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

      nodesCreated.push({
        id: evidenceNode.id,
        text: evidence.text,
        type: "EVIDENCE",
      });

      // Create evidence metadata
      await supabase.from("evidence_metadata").insert({
        node_id: evidenceNode.id,
        source_url: evidence.sourceUrl ?? null,
        provenance_tier: credAssessment.provenanceTier,
        methodology_notes: credAssessment.methodologyNotes as unknown as Json,
        content_summary: credAssessment.contentSummary,
      });

      // Create edge
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

      edgesCreated.push({
        id: evidenceEdge.id,
        parentId: leaf.id,
        childId: evidenceNode.id,
      });
    }
  }

  // Step 4: Propagate from the lowest nodes upward
  // Propagate from each leaf claim (their evidence children are already set)
  for (const leaf of leafClaims) {
    await propagate(supabase, leaf.id);
  }
  // Then propagate from the root claim
  await propagate(supabase, claimId);

  return {
    claimId,
    nodesCreated,
    edgesCreated,
    llmCallsUsed,
    budgetExhausted: llmCallsUsed >= budget.maxLlmCalls,
  };
}
