-- Vector similarity search for claims
-- Used by /api/claims/search to find duplicate and related claims

create or replace function search_claims_by_embedding(
  query_embedding vector(1536),
  match_threshold float default 0.75,
  match_count int default 20
)
returns table (
  node_id uuid,
  text text,
  similarity float,
  log_odds_posterior float8,
  evidence_weight float8,
  convergence_status convergence_status
)
language sql stable
as $$
  select
    n.id as node_id,
    n.text,
    1 - (cm.embedding <=> query_embedding) as similarity,
    n.log_odds_posterior,
    n.evidence_weight,
    n.convergence_status
  from claim_metadata cm
  join nodes n on n.id = cm.node_id
  where cm.embedding is not null
    and 1 - (cm.embedding <=> query_embedding) >= match_threshold
  order by cm.embedding <=> query_embedding
  limit match_count;
$$;
