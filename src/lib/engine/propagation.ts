/**
 * Incremental propagation algorithm.
 * See: MODELING-KNOWLEDGE.md §3.2
 */

import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { computePosterior, sigmoid, type EdgeWithChild } from "./math";

const MAX_VISITS_PER_NODE = 50;
const CONVERGENCE_THRESHOLD = 0.001;

export interface PropagationSummary {
  nodesVisited: number;
  nodesUpdated: number;
  unstableNodes: string[];
  changes: Array<{
    nodeId: string;
    logOddsBefore: number;
    logOddsAfter: number;
    probabilityBefore: number;
    probabilityAfter: number;
  }>;
}

/**
 * Fetch all child edges for a node with their children's current posteriors.
 */
async function fetchChildEdges(
  supabase: SupabaseClient<Database>,
  nodeId: string
): Promise<EdgeWithChild[]> {
  const { data: edges, error } = await supabase
    .from("edges")
    .select(
      `
      id,
      child_id,
      log_lr_positive,
      log_lr_negative,
      relevance_weight,
      nodes!edges_child_id_fkey (
        log_odds_posterior
      )
    `
    )
    .eq("parent_id", nodeId);

  if (error) throw new Error(`Failed to fetch edges for node ${nodeId}: ${error.message}`);
  if (!edges) return [];

  return edges.map((edge) => {
    const childNode = edge.nodes as unknown as { log_odds_posterior: number };
    return {
      edgeId: edge.id,
      childId: edge.child_id,
      logLrPositive: edge.log_lr_positive,
      logLrNegative: edge.log_lr_negative,
      relevanceWeight: edge.relevance_weight,
      childLogOddsPosterior: childNode.log_odds_posterior,
    };
  });
}

/**
 * Fetch parent node IDs for a given node (nodes where this node is a child).
 */
async function fetchParentIds(
  supabase: SupabaseClient<Database>,
  nodeId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("edges")
    .select("parent_id")
    .eq("child_id", nodeId);

  if (error) throw new Error(`Failed to fetch parents for node ${nodeId}: ${error.message}`);
  return (data ?? []).map((e) => e.parent_id);
}

/**
 * Recompute a single node's posterior from its children and persist the result.
 * Returns the delta (absolute change in log-odds).
 */
async function recomputeAndPersist(
  supabase: SupabaseClient<Database>,
  nodeId: string,
  triggerEdgeId: string | null
): Promise<{
  delta: number;
  logOddsBefore: number;
  logOddsAfter: number;
  evidenceWeightBefore: number;
  evidenceWeightAfter: number;
}> {
  // Fetch current state
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("log_odds_prior, log_odds_posterior, evidence_weight")
    .eq("id", nodeId)
    .single();

  if (nodeError || !node)
    throw new Error(`Failed to fetch node ${nodeId}: ${nodeError?.message}`);

  const logOddsBefore = node.log_odds_posterior;
  const evidenceWeightBefore = node.evidence_weight;

  // Fetch child edges and recompute
  const childEdges = await fetchChildEdges(supabase, nodeId);
  const result = computePosterior(node.log_odds_prior, childEdges);

  const delta = Math.abs(result.logOddsPosterior - logOddsBefore);

  // Persist updated posterior and evidence weight
  const { error: updateError } = await supabase
    .from("nodes")
    .update({
      log_odds_posterior: result.logOddsPosterior,
      evidence_weight: result.evidenceWeight,
    })
    .eq("id", nodeId);

  if (updateError)
    throw new Error(`Failed to update node ${nodeId}: ${updateError.message}`);

  // Write audit log entry
  const { error: logError } = await supabase.from("update_log").insert({
    node_id: nodeId,
    trigger_edge_id: triggerEdgeId,
    log_odds_before: logOddsBefore,
    log_odds_after: result.logOddsPosterior,
    evidence_weight_before: evidenceWeightBefore,
    evidence_weight_after: result.evidenceWeight,
    source: "PROPAGATION" as const,
  });

  if (logError)
    console.error(`Failed to write update log for node ${nodeId}:`, logError);

  return {
    delta,
    logOddsBefore,
    logOddsAfter: result.logOddsPosterior,
    evidenceWeightBefore,
    evidenceWeightAfter: result.evidenceWeight,
  };
}

/**
 * Run incremental propagation starting from a changed node.
 *
 * Entry point depends on the type of change:
 * - New edge added: pass the parent node ID
 * - Evidence credibility revised: pass the evidence node ID
 * - Edge LRs/weight modified: pass the edge's parent node ID
 *
 * See MODELING-KNOWLEDGE.md §3.2 for the full algorithm.
 */
export async function propagate(
  supabase: SupabaseClient<Database>,
  changedNodeId: string,
  triggerEdgeId: string | null = null
): Promise<PropagationSummary> {
  const queue: string[] = [changedNodeId];
  const visitCount = new Map<string, number>();
  const highDelta = new Set<string>();
  const changes: PropagationSummary["changes"] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    visited.add(nodeId);

    const count = (visitCount.get(nodeId) ?? 0) + 1;
    visitCount.set(nodeId, count);

    if (count > MAX_VISITS_PER_NODE) {
      highDelta.add(nodeId);
      continue;
    }

    const result = await recomputeAndPersist(supabase, nodeId, triggerEdgeId);

    if (result.delta > 0) {
      changes.push({
        nodeId,
        logOddsBefore: result.logOddsBefore,
        logOddsAfter: result.logOddsAfter,
        probabilityBefore: sigmoid(result.logOddsBefore),
        probabilityAfter: sigmoid(result.logOddsAfter),
      });
    }

    if (result.delta > CONVERGENCE_THRESHOLD) {
      highDelta.add(nodeId);
      const parentIds = await fetchParentIds(supabase, nodeId);
      for (const parentId of parentIds) {
        if (!queue.includes(parentId)) {
          queue.push(parentId);
        }
      }
    } else {
      highDelta.delete(nodeId);
    }
  }

  // Final status assignment
  const unstableNodes: string[] = [];

  for (const nodeId of visited) {
    const count = visitCount.get(nodeId) ?? 0;
    const isUnstable =
      (count > 1 && highDelta.has(nodeId)) || queue.includes(nodeId);
    const status = isUnstable ? "UNSTABLE" : "STABLE";

    if (isUnstable) unstableNodes.push(nodeId);

    await supabase
      .from("nodes")
      .update({ convergence_status: status as "STABLE" | "UNSTABLE" })
      .eq("id", nodeId);
  }

  return {
    nodesVisited: visited.size,
    nodesUpdated: changes.length,
    unstableNodes,
    changes,
  };
}
