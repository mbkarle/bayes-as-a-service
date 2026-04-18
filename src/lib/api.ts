/**
 * Client-side API fetch helpers.
 */

import type {
  NeighborhoodResponse,
  AnalysisResponse,
  AuditResponse,
  InvestigationResult,
  EvidenceMetadata,
  NodeSummary,
} from "./types";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function fetchNeighborhood(id: string) {
  return fetchJSON<NeighborhoodResponse>(`/api/claims/${id}/neighborhood`);
}

export function fetchAnalysis(id: string) {
  return fetchJSON<AnalysisResponse>(`/api/claims/${id}/analysis`);
}

export function fetchAudit(nodeId: string, limit = 50, offset = 0) {
  return fetchJSON<AuditResponse>(
    `/api/audit/${nodeId}?limit=${limit}&offset=${offset}`
  );
}

export function investigateClaim(
  id: string,
  budget?: {
    max_decomposition_depth?: number;
    max_evidence_per_claim?: number;
    max_llm_calls?: number;
  }
) {
  return fetchJSON<InvestigationResult>(`/api/claims/${id}/investigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(budget ?? {}),
  });
}

export function exploreClaim(id: string) {
  return fetchJSON<InvestigationResult>(`/api/claims/${id}/explore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function createClaim(text: string) {
  // API returns the node directly, not wrapped in { node }
  const node = await fetchJSON<NodeSummary>("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { node };
}

export async function searchClaims(text: string) {
  const raw = await fetchJSON<{
    duplicates: Array<Record<string, unknown>>;
    related: Array<Record<string, unknown>>;
    search_type?: string;
  }>("/api/claims/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  // Normalize: text fallback returns full node rows (id, text, ...),
  // vector search returns (node_id, text, similarity, ...).
  function normalize(row: Record<string, unknown>) {
    return {
      node_id: (row.node_id ?? row.id) as string,
      text: row.text as string,
      similarity: (row.similarity as number) ?? undefined,
    };
  }

  return {
    duplicates: (raw.duplicates ?? []).map(normalize),
    related: (raw.related ?? []).map(normalize),
  };
}

export function fetchNode(id: string) {
  return fetchJSON<NodeSummary>(`/api/nodes/${id}`);
}

export function patchNode(id: string, updates: { log_odds_prior?: number; text?: string }) {
  return fetchJSON<{ node: NodeSummary }>(`/api/nodes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export function patchEdge(
  id: string,
  updates: {
    log_lr_positive?: number;
    log_lr_negative?: number;
    relevance_weight?: number;
  }
) {
  return fetchJSON(`/api/edges/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export function fetchEvidenceMetadata(nodeId: string) {
  return fetchJSON<EvidenceMetadata>(`/api/evidence/${nodeId}/metadata`);
}

export interface GraphResponse {
  nodes: NodeSummary[];
  edges: Array<{
    id: string;
    parent_id: string;
    child_id: string;
    log_lr_positive: number;
    log_lr_negative: number;
    relevance_weight: number;
    reasoning: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
}

export function fetchGraph(limit = 200, offset = 0) {
  return fetchJSON<GraphResponse>(`/api/graph?limit=${limit}&offset=${offset}`);
}
