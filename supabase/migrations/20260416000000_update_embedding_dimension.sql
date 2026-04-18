-- Update embedding column from 1536 (OpenAI) to 512 (voyage-3-lite) dimensions.
-- Drop and recreate the index and function since the dimension is changing.

drop index if exists idx_claim_metadata_embedding;

alter table claim_metadata
  alter column embedding type vector(512)
  using null;

create index idx_claim_metadata_embedding on claim_metadata
  using hnsw (embedding vector_cosine_ops);

-- Recreate the search function with the correct dimension
create or replace function search_claims_by_embedding(
  query_embedding vector(512),
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
