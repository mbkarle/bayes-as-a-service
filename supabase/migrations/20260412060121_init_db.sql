-- ============================================================
-- Bayesian Argument Map — Initial Schema
-- See: MODELING-KNOWLEDGE.md §2, MVP-IMPLEMENTATION.md §3
-- ============================================================

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- Enums
-- ============================================================

create type node_type as enum ('CLAIM', 'EVIDENCE');
create type node_source as enum ('USER', 'LLM_DECOMPOSITION', 'LLM_EVIDENCE_SEARCH');
create type convergence_status as enum ('INITIAL', 'STABLE', 'UNSTABLE');
create type evidence_source_type as enum (
  'JOURNAL_ARTICLE', 'PREPRINT', 'SURVEY', 'NEWS_ARTICLE', 'REPORT', 'BOOK', 'OTHER'
);
create type update_source as enum (
  'LLM_DECOMPOSITION', 'LLM_EVIDENCE_EVAL', 'USER_MANUAL', 'PROPAGATION'
);

-- ============================================================
-- Tables
-- ============================================================

-- Perspectives (tenancy stub)
create table perspectives (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  user_id    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Seed the default global perspective
insert into perspectives (name, user_id) values ('default', null);

-- Nodes
create table nodes (
  id                  uuid primary key default gen_random_uuid(),
  text                text not null,
  type                node_type not null,
  log_odds_prior      float8 not null default 0.0,
  source              node_source not null,
  log_odds_posterior  float8 not null default 0.0,
  evidence_weight     float8 not null default 0.0,
  convergence_status  convergence_status not null default 'INITIAL',
  perspective_id      uuid not null references perspectives(id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Edges
create table edges (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid not null references nodes(id) on delete cascade,
  child_id         uuid not null references nodes(id) on delete cascade,
  log_lr_positive  float8 not null,
  log_lr_negative  float8 not null,
  relevance_weight float8 not null,
  reasoning        text,
  perspective_id   uuid not null references perspectives(id) on delete cascade,
  created_at       timestamptz not null default now(),

  constraint edges_no_self_loop check (parent_id != child_id),
  constraint edges_weight_range check (relevance_weight > 0 and relevance_weight <= 1),
  constraint edges_unique_parent_child_perspective unique (parent_id, child_id, perspective_id)
);

-- Update log (append-only audit trail)
create table update_log (
  id                     uuid primary key default gen_random_uuid(),
  node_id                uuid not null references nodes(id) on delete cascade,
  trigger_edge_id        uuid references edges(id) on delete set null,
  log_odds_before        float8 not null,
  log_odds_after         float8 not null,
  evidence_weight_before float8 not null,
  evidence_weight_after  float8 not null,
  source                 update_source not null,
  reasoning              text,
  created_at             timestamptz not null default now()
);

-- Evidence metadata (1:1 with evidence nodes)
create table evidence_metadata (
  node_id              uuid primary key references nodes(id) on delete cascade,
  source_url           text,
  source_type          evidence_source_type,
  publication_date     date,
  authors              jsonb default '[]'::jsonb,
  journal_or_publisher text,
  provenance_tier      smallint check (provenance_tier between 1 and 5),
  methodology_notes    jsonb default '{}'::jsonb,
  content_summary      text
);

-- Claim metadata (1:1 with claim nodes)
create table claim_metadata (
  node_id     uuid primary key references nodes(id) on delete cascade,
  domain_tags jsonb default '[]'::jsonb,
  embedding   vector(1536)
);

-- ============================================================
-- Indexes
-- ============================================================

create index idx_edges_parent_id on edges(parent_id);
create index idx_edges_child_id on edges(child_id);
create index idx_nodes_perspective_id on nodes(perspective_id);
create index idx_nodes_type on nodes(type);
create index idx_update_log_node_id_created on update_log(node_id, created_at desc);

-- Vector similarity index for claim embeddings (using HNSW for better recall)
create index idx_claim_metadata_embedding on claim_metadata
  using hnsw (embedding vector_cosine_ops);

-- ============================================================
-- Trigger: auto-update updated_at on nodes
-- ============================================================

create or replace function update_node_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_nodes_updated_at
  before update on nodes
  for each row execute function update_node_timestamp();

-- ============================================================
-- Row Level Security
-- ============================================================

-- Enable RLS on all tables
alter table perspectives enable row level security;
alter table nodes enable row level security;
alter table edges enable row level security;
alter table update_log enable row level security;
alter table evidence_metadata enable row level security;
alter table claim_metadata enable row level security;

-- For MVP: allow public read access to all tables (global graph).
-- Write access is restricted to authenticated users or service role.
-- The service role key bypasses RLS entirely, so these policies
-- govern browser-client access via the publishable key.

-- Perspectives: anyone can read
create policy "perspectives_select" on perspectives
  for select using (true);

-- Nodes: anyone can read, authenticated users can insert/update
create policy "nodes_select" on nodes
  for select using (true);

create policy "nodes_insert" on nodes
  for insert with check (true);

create policy "nodes_update" on nodes
  for update using (true);

-- Edges: anyone can read, authenticated users can insert/update
create policy "edges_select" on edges
  for select using (true);

create policy "edges_insert" on edges
  for insert with check (true);

create policy "edges_update" on edges
  for update using (true);

-- Update log: anyone can read, insert only (append-only)
create policy "update_log_select" on update_log
  for select using (true);

create policy "update_log_insert" on update_log
  for insert with check (true);

-- Evidence metadata: anyone can read, insert/update allowed
create policy "evidence_metadata_select" on evidence_metadata
  for select using (true);

create policy "evidence_metadata_insert" on evidence_metadata
  for insert with check (true);

create policy "evidence_metadata_update" on evidence_metadata
  for update using (true);

-- Claim metadata: anyone can read, insert/update allowed
create policy "claim_metadata_select" on claim_metadata
  for select using (true);

create policy "claim_metadata_insert" on claim_metadata
  for insert with check (true);

create policy "claim_metadata_update" on claim_metadata
  for update using (true);
