/**
 * Shared types for API responses consumed by the frontend.
 * These mirror the shapes returned by the API routes.
 */

export interface NodeSummary {
  id: string;
  text: string;
  type: "CLAIM" | "EVIDENCE";
  log_odds_prior: number;
  log_odds_posterior: number;
  evidence_weight: number;
  convergence_status: "INITIAL" | "STABLE" | "UNSTABLE";
  source: "USER" | "LLM_DECOMPOSITION" | "LLM_EVIDENCE_SEARCH";
  perspective_id: string;
  created_at: string;
  updated_at: string;
  probability: number;
}

export interface EdgeSummary {
  id: string;
  log_lr_positive: number;
  log_lr_negative: number;
  relevance_weight: number;
  reasoning: string | null;
}

export interface ChildEntry {
  edge: EdgeSummary;
  node: NodeSummary;
}

export interface ParentEntry {
  edge: EdgeSummary;
  node: NodeSummary;
}

export interface NeighborhoodResponse {
  node: NodeSummary;
  children: ChildEntry[];
  parents: ParentEntry[];
}

export interface Contribution {
  edgeId: string;
  childId: string;
  childText: string;
  childType: "CLAIM" | "EVIDENCE";
  weightedLogLR: number;
  relevanceWeight: number;
  childEvidenceWeight: number;
  reasoning: string | null;
}

export interface AnalysisResponse {
  node: NodeSummary;
  contributions: Contribution[];
  loadBearing: Contribution[];
  keyUncertainties: Contribution[];
  conflicts: {
    supporting: Contribution[];
    undermining: Contribution[];
  } | null;
}

export interface AuditEntry {
  id: string;
  node_id: string;
  trigger_edge_id: string | null;
  log_odds_before: number;
  log_odds_after: number;
  evidence_weight_before: number;
  evidence_weight_after: number;
  source: "LLM_DECOMPOSITION" | "LLM_EVIDENCE_EVAL" | "USER_MANUAL" | "PROPAGATION";
  reasoning: string | null;
  created_at: string;
}

export interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface InvestigationResult {
  claimId: string;
  subclaimsCreated: number;
  evidenceCreated: number;
  edgesCreated: number;
  llmCallsUsed: number;
  propagationSummary: {
    nodesVisited: number;
    nodesUpdated: number;
    unstableNodes: string[];
  };
}

export interface EvidenceMetadata {
  node_id: string;
  source_url: string | null;
  source_type: string | null;
  publication_date: string | null;
  authors: string[] | null;
  journal_or_publisher: string | null;
  provenance_tier: number | null;
  methodology_notes: Record<string, unknown> | null;
  content_summary: string | null;
}
