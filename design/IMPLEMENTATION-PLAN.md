# IMPLEMENTATION-PLAN.md — Step-by-Step Build Guide

This plan breaks the MVP (see MVP-IMPLEMENTATION.md) into concrete, ordered implementation steps. Each phase produces a working increment that can be tested before moving on.

---

## Environment & Conventions

- **Project directory:** `/Users/mkarle/FreeRealEstate/Projects/bayes-as-a-service/`
- **Supabase:** Already linked (project ref `zbxncbcrmypalauizjsj`). Env vars in `.env.local`.
  - `NEXT_PUBLIC_SUPABASE_URL` — public Supabase URL
  - `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY` — publishable key (replaces deprecated "anon" key; functionally equivalent)
  - `SUPABASE_SECRET_KEY` — server-side only, for API routes and edge functions
- **Initial migration:** `supabase/migrations/20260412060121_init_db.sql` (edit in place)
- **Future migrations:** `npx supabase migration new "<descriptive_name>"`
- **Push migrations:** `npx supabase db push`

---

## Phase 1: Project Scaffolding

**Goal:** Next.js app running locally with Supabase client configured.

### 1.1 Initialize Next.js

Initialize a Next.js project in the current directory (App Router, TypeScript, Tailwind CSS, ESLint). Since the directory already contains files, use `--no-git` and ensure existing files (docs, supabase/, .env.local) are preserved.

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-git --use-npm
```

If `create-next-app` refuses to run in a non-empty directory, initialize in a temp subdirectory and move files up. Verify `npm run dev` starts on `localhost:3000`.

### 1.2 Install Dependencies

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install @anthropic-ai/sdk
npm install reactflow                    # graph visualization
npm install --save-dev @types/node
```

### 1.3 Supabase Client Setup

Create two Supabase client utilities:

- **`lib/supabase/client.ts`** — browser client using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY`.
- **`lib/supabase/server.ts`** — server client (for API routes) using `SUPABASE_SECRET_KEY`. This bypasses RLS for backend operations.

### 1.4 Verify

- `npm run dev` serves a page
- Browser client can reach Supabase (e.g., a health check query)

---

## Phase 2: Database Schema

**Goal:** All tables from MVP-IMPLEMENTATION.md §3 exist in Supabase. The propagation algorithm can be tested against the DB.

### 2.1 Write Initial Migration

Edit `supabase/migrations/20260412060121_init_db.sql` with the full schema:

**Extensions:**
```sql
create extension if not exists "pgcrypto";    -- gen_random_uuid()
create extension if not exists "vector";       -- pgvector for embeddings
```

**Enums:**
```sql
create type node_type as enum ('CLAIM', 'EVIDENCE');
create type node_source as enum ('USER', 'LLM_DECOMPOSITION', 'LLM_EVIDENCE_SEARCH');
create type convergence_status as enum ('INITIAL', 'STABLE', 'UNSTABLE');
create type evidence_source_type as enum (
  'JOURNAL_ARTICLE', 'PREPRINT', 'SURVEY', 'NEWS_ARTICLE', 'REPORT', 'BOOK', 'OTHER'
);
create type update_source as enum (
  'LLM_DECOMPOSITION', 'LLM_EVIDENCE_EVAL', 'USER_MANUAL', 'PROPAGATION'
);
```

**Tables** (in dependency order):

1. `perspectives` — with a seeded default row
2. `nodes` — FK to perspectives, check constraints on weight/status
3. `edges` — FKs to nodes and perspectives, check constraint `parent_id != child_id`, check `relevance_weight > 0 AND relevance_weight <= 1`
4. `update_log` — FKs to nodes and edges
5. `evidence_metadata` — FK to nodes, check that referenced node is type EVIDENCE
6. `claim_metadata` — FK to nodes, with `embedding vector(1536)`

**Indexes:**
- `edges(parent_id)` — fetch children of a node
- `edges(child_id)` — fetch parents of a node (for propagation)
- `nodes(perspective_id)` — scope queries by perspective
- `claim_metadata` using ivfflat or hnsw on `embedding` column for vector similarity search
- `update_log(node_id, created_at)` — audit log queries

**Seed data:**
```sql
insert into perspectives (id, name, user_id)
values (gen_random_uuid(), 'default', null);
```

### 2.2 Push Migration

```bash
npx supabase db push
```

Verify tables exist via Supabase dashboard or `psql`.

### 2.3 Generate TypeScript Types

```bash
npx supabase gen types typescript --project-id zbxncbcrmypalauizjsj > lib/supabase/database.types.ts
```

This gives type-safe access to all tables from the application code.

---

## Phase 3: Core Graph Engine

**Goal:** The propagation algorithm and posterior computation from MODELING-KNOWLEDGE.md §3 work correctly, tested against the database.

### 3.1 Math Utilities (`lib/engine/math.ts`)

Implement pure functions:

- `sigmoid(logOdds: number): number` — log-odds to probability
- `logit(p: number): number` — probability to log-odds
- `effectiveLR(pChild: number, logLrPos: number, logLrNeg: number): number` — compute effective log-LR for one edge via log-odds interpolation (§3.1)
- `computePosterior(logOddsPrior: number, edges: EdgeWithChild[]): { logOddsPosterior: number, evidenceWeight: number }` — full single-node computation (§3.1)

### 3.2 Propagation (`lib/engine/propagation.ts`)

Implement the incremental propagation algorithm from MODELING-KNOWLEDGE.md §3.2:

- `propagate(supabase, changedNodeId)` — the main function
- Reads edges and child posteriors from the database
- Maintains `visitCount` and `highDelta` per the pseudocode
- Writes updated `log_odds_posterior`, `evidence_weight`, `convergence_status` back to nodes
- Writes `update_log` entries for each change
- Returns a summary of what changed (for API responses)

### 3.3 Tests

Write tests for:

- Math utilities: known inputs/outputs, log-odds interpolation verification
- Propagation on a toy graph matching the example in MODELING-KNOWLEDGE.md §5
- Cycle detection: a small cycle converges within the visit limit
- Unexplored child (P=0.5) contributes small bias consistent with LR asymmetry (see §4.3)

Use the Supabase test project or a local Postgres for integration tests.

---

## Phase 4: API Routes — Graph CRUD

**Goal:** API routes for creating/reading/editing nodes and edges, with propagation triggered on mutations.

### 4.1 Nodes API

**`app/api/nodes/route.ts`** — POST: create a node (claim or evidence). Returns the created node.

**`app/api/nodes/[id]/route.ts`**
- GET: return node with posterior, evidence weight, status
- PATCH: update prior (claims) or credibility (evidence), then call `propagate()`

### 4.2 Edges API

**`app/api/edges/route.ts`** — POST: create an edge. Validate LR values, write directly. Call `propagate()` on the parent node. Returns the created edge.

**`app/api/edges/[id]/route.ts`** — PATCH: update LRs or weight. Call `propagate()` on the parent.

### 4.3 Claims API

**`app/api/claims/route.ts`** — POST: create a claim node + claim_metadata (with embedding). Thin wrapper around nodes API that also handles metadata.

**`app/api/claims/search/route.ts`** — POST: accept a text query, compute embedding, run pgvector cosine similarity search. Return two tiers:
- `duplicates`: cosine > 0.95
- `related`: cosine > 0.75

**`app/api/claims/[id]/neighborhood/route.ts`** — GET: return the claim, its child edges, child nodes (with their posteriors), and optionally one more hop. Used by the graph visualization.

**`app/api/claims/[id]/analysis/route.ts`** — GET: compute contribution breakdown, load-bearing nodes, key uncertainties, conflicts (per MVP-IMPLEMENTATION.md §6.3). Pure computation over cached posteriors.

### 4.4 Evidence API

**`app/api/evidence/route.ts`** — POST: create evidence node + evidence_metadata + edge to parent claim. Normalize LRs, call `propagate()`.

### 4.5 Audit Log API

**`app/api/audit/[nodeId]/route.ts`** — GET: return update_log entries for a node, ordered by `created_at` descending.

### 4.6 Verify

Test each route via `curl` or a REST client. Confirm:
- Creating a claim produces a node + metadata row
- Creating an evidence node with an edge triggers propagation and updates the parent's posterior
- Editing an edge's LRs triggers re-propagation
- The analysis endpoint returns correct contribution breakdowns

---

## Phase 5: LLM Integration

**Goal:** The LLM can decompose claims, search for evidence, and assess LRs. This is the intelligence layer — prior phases are deterministic.

### 5.1 Anthropic Client (`lib/llm/client.ts`)

Set up the Anthropic SDK client. Add `ANTHROPIC_API_KEY` to `.env.local`.

### 5.2 Prompt Templates (`lib/llm/prompts/`)

Create structured prompts for each LLM task. Each prompt should use JSON structured output (via tool_use or JSON mode).

**`decompose.ts`** — System prompt includes:
- Instructions to produce independent, testable sub-claims
- List of related existing nodes (passed at call time) with instructions to reuse where appropriate
- Output schema: `{ subclaims: Array<{ text: string, existing_node_id?: string, reasoning: string }> }`

**`assess-evidence.ts`** — System prompt includes:
- The full LIKELIHOOD-GRADING-SCALE.md content (§2–§5)
- Instructions for step-by-step reasoning before grading
- Output schema: `{ credibility: number, provenance_tier: number, methodology_notes: object, content_summary: string }`

**`assess-edge.ts`** — System prompt includes:
- The grading scale
- Instructions for independent assessment of positive and negative LRs
- Output schema: `{ log_lr_positive_grade: string, log_lr_negative_grade: string, relevance_weight: number, reasoning: string }`
- The grade strings map to numeric values via a lookup table

**`narrate.ts`** — System prompt for generating human-readable analysis summaries from structured data.

### 5.3 Investigation Orchestrator (`lib/llm/investigate.ts`)

The orchestrator implements the investigation flow from MVP-IMPLEMENTATION.md §4.1:

```typescript
async function investigate(claimId: string, budget: InvestigationBudget): Promise<InvestigationResult>
```

Steps:
1. Fetch the claim and its current children
2. Call decompose prompt with related existing nodes as context
3. For each sub-claim: create node (or link to existing), create edge with assessed LRs
4. For each leaf sub-claim (within budget): search for evidence via web search tool, assess each piece of evidence, create evidence nodes + edges
5. Run propagation from the lowest new nodes upward
6. Return a summary of what was created and how posteriors changed

Budget tracking: count LLM calls, enforce `max_decomposition_depth`, `max_evidence_per_claim`, `max_llm_calls`.

### 5.4 Investigation API Routes

**`app/api/claims/[id]/investigate/route.ts`** — POST: accept budget params, call the orchestrator, return results. This is a potentially long-running request; for MVP, it can run synchronously with a generous timeout. If latency is an issue, move to a background job pattern later.

**`app/api/claims/[id]/explore/route.ts`** — POST: similar to investigate but operates on an existing neighborhood, prioritizing key uncertainties.

### 5.5 Embedding Generation

Choose an embedding model (e.g., OpenAI `text-embedding-3-small` for 1536-dim, or an Anthropic-compatible option). Create a utility:

```typescript
async function generateEmbedding(text: string): Promise<number[]>
```

Called when creating claim nodes, and when performing similarity search on user input.

### 5.6 Verify

- Decompose a test claim, confirm sub-claims are created with edges
- Ingest a test URL, confirm evidence metadata is populated
- Run a full investigation, confirm posteriors update end-to-end
- Submit a claim related to an existing node, confirm graph integration (reuse, not duplication)

---

## Phase 6: Frontend — Core Views

**Goal:** A usable UI for the primary interaction patterns.

### 6.1 Layout and Navigation (`app/layout.tsx`)

Minimal shell: header with app name, main content area. No complex navigation for MVP — the claim view is the primary (and initially only) page.

### 6.2 Claim Search / Entry (`app/page.tsx`)

The landing page and primary entrypoint:

- A prominent search bar where users type a claim
- On submit: call `/api/claims/search` with the text
- Display results in three categories:
  - **Exact/near matches** — link to existing claim view
  - **Related claims** — show with similarity score, link to existing claim view
  - **No match** — offer to create and investigate
- "Investigate" button creates the claim and triggers investigation

### 6.3 Claim Detail View (`app/claims/[id]/page.tsx`)

The main claim page, showing:

- **Header:** claim text, posterior probability (large, prominent), evidence weight, convergence status badge
- **Probability display:** both as percentage and a visual bar/gauge. Color-coded (e.g., green for high confidence, yellow for moderate, gray for low evidence weight)
- **Neighborhood graph:** React Flow component showing the claim and its immediate children (one hop). Nodes display their posterior. Edges display direction (supports/undermines) via color.
- **Child list:** tabular breakdown of each child's contribution (`w · log(effective_LR)`), sorted by magnitude. Each row links to the child's own detail page.
- **Actions:**
  - "Investigate further" — triggers `/api/claims/[id]/investigate` with budget controls
  - "Ingest evidence" — opens a form to paste a URL or text
  - "Analyze" — triggers the analysis endpoint and displays results
  - "Edit prior" — inline edit of `log_odds_prior`

### 6.4 Graph Visualization Component (`components/NeighborhoodGraph.tsx`)

A reusable React Flow component:

- Accepts a set of nodes and edges
- Nodes are colored by posterior (red ↔ green spectrum) and sized by evidence weight
- Evidence nodes are visually distinct from claim nodes (different shape or icon)
- Edges show direction and are colored by contribution sign (green = supports, red = undermines)
- Clicking a node navigates to its detail page
- Supports pan/zoom

### 6.5 Evidence Detail View (`app/evidence/[id]/page.tsx`)

For evidence nodes:

- Evidence text / content summary
- Metadata: source URL (linked), authors, publication date, journal, provenance tier, methodology notes
- Credibility (posterior probability)
- Parent edges: which claims this evidence informs, with LR grades and contribution

### 6.6 Audit Log View (`app/claims/[id]/audit/page.tsx`)

- Table of update_log entries for the node
- Columns: timestamp, posterior before/after, evidence weight before/after, source (LLM/user/propagation), trigger edge
- Each trigger edge links to the relevant edge/node

### 6.7 Real-time Updates

Subscribe to Supabase Realtime on the `nodes` table, filtered to nodes currently visible on screen. When a node's `log_odds_posterior` or `convergence_status` changes (from propagation), update the UI live. Show a subtle "propagating..." indicator while any visible node has recently changed.

### 6.8 Verify

- Enter a claim, see investigation results with graph visualization
- Click through to sub-claims and evidence
- Edit an edge's LRs, see propagation update the parent in real-time
- Ingest evidence via URL, see the graph update
- Check audit log shows the history of changes

---

## Phase 7: Polish and Integration Testing

**Goal:** End-to-end flows work reliably. Rough edges are smoothed.

### 7.1 Investigation Budget UI

- Expose budget parameters (max_decomposition_depth, max_evidence_per_claim, max_llm_calls) in the investigation dialog
- Show estimated LLM call count before execution
- Show progress during investigation (nodes created so far)

### 7.2 Edge Editing UI

- Click an edge in the graph or child list to open an edit panel
- Display current LR grades with the 7-point scale as reference
- Allow user to select new grades from dropdowns
- Show the grading scale descriptions inline for guidance
- On save: re-normalize, call PATCH, propagation runs

### 7.3 Error Handling

- LLM call failures: retry once, then surface error to user
- Propagation failures: mark affected nodes as UNSTABLE, surface in UI
- Web search failures during investigation: skip that evidence source, continue with remaining budget

### 7.4 End-to-End Test Scenarios

1. **New claim, full investigation:** Enter "Coffee consumption reduces risk of type 2 diabetes." Verify decomposition, evidence retrieval, posterior computation, graph display.
2. **Related claim, graph integration:** Enter "Caffeine improves insulin sensitivity." Verify it links to shared sub-claims/evidence from scenario 1.
3. **Contradictory evidence:** Ingest an article contradicting a sub-claim. Verify posterior shifts in the expected direction and evidence weight increases.
4. **Manual override:** Edit an edge's LRs. Verify propagation and audit log.
5. **Cycle handling (if applicable):** Manually create a cycle by adding a cross-claim edge. Verify propagation converges or marks nodes UNSTABLE.

---

## Dependency Graph

```
Phase 1 (Scaffolding)
  ↓
Phase 2 (Database Schema)
  ↓
Phase 3 (Graph Engine) ←——————————————————┐
  ↓                                        │
Phase 4 (API Routes) ——→ Phase 5 (LLM)    │
  ↓                        ↓               │
Phase 6 (Frontend) ←———————┘               │
  ↓                                        │
Phase 7 (Polish) ——————————————————————————┘
```

Phases 1–3 are strictly sequential. Phase 4 and Phase 5 can be partially parallelized (API routes for CRUD don't depend on LLM; investigation routes do). Phase 6 depends on API routes existing. Phase 7 ties everything together.

---

## Files Created per Phase

| Phase | Key files |
|---|---|
| 1 | `package.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, `tailwind.config.ts` |
| 2 | `supabase/migrations/20260412060121_init_db.sql`, `lib/supabase/database.types.ts` |
| 3 | `lib/engine/math.ts`, `lib/engine/propagation.ts`, `lib/engine/__tests__/math.test.ts`, `lib/engine/__tests__/propagation.test.ts` |
| 4 | `app/api/nodes/route.ts`, `app/api/nodes/[id]/route.ts`, `app/api/edges/route.ts`, `app/api/edges/[id]/route.ts`, `app/api/claims/route.ts`, `app/api/claims/search/route.ts`, `app/api/claims/[id]/neighborhood/route.ts`, `app/api/claims/[id]/analysis/route.ts`, `app/api/evidence/route.ts`, `app/api/audit/[nodeId]/route.ts` |
| 5 | `lib/llm/client.ts`, `lib/llm/prompts/decompose.ts`, `lib/llm/prompts/assess-evidence.ts`, `lib/llm/prompts/assess-edge.ts`, `lib/llm/prompts/narrate.ts`, `lib/llm/investigate.ts`, `lib/llm/embeddings.ts`, `app/api/claims/[id]/investigate/route.ts`, `app/api/claims/[id]/explore/route.ts` |
| 6 | `app/page.tsx` (updated), `app/claims/[id]/page.tsx`, `app/evidence/[id]/page.tsx`, `app/claims/[id]/audit/page.tsx`, `components/NeighborhoodGraph.tsx`, `components/PosteriorDisplay.tsx`, `components/ChildContributionList.tsx`, `components/InvestigationDialog.tsx` |
| 7 | `components/EdgeEditor.tsx`, `components/BudgetControls.tsx`, updates across existing files |
