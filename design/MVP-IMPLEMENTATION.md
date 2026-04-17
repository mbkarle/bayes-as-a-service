# MVP-IMPLEMENTATION.md — Bayesian Argument Map MVP

## 1. Project Overview

A web application that maintains a Bayesian argument graph — a network of claims and evidence with quantified evidential relationships. Users submit claims in natural language; the system decomposes them into sub-claims, retrieves relevant evidence, assesses likelihood ratios via LLM, and computes posteriors via deterministic propagation. The result is a structured, auditable, and explorable map of belief supported by evidence.

The mathematical and modeling foundations are specified in MODELING-KNOWLEDGE.md. The likelihood grading scale for LLM assessments is specified in LIKELIHOOD-GRADING-SCALE.md.

---

## 2. Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **Frontend framework** | Next.js (App Router) | SSR for shareable claim URLs, API routes co-located with frontend, strong ecosystem |
| **Backend / database** | Supabase (Postgres) | Postgres for relational graph model, pgvector for claim embeddings, row-level security for future tenancy, real-time subscriptions for propagation updates, edge functions for async work, built-in auth |
| **Graph visualization** | React Flow or D3 (TBD) | Interactive node-edge visualization for claim neighborhoods |
| **LLM provider** | Anthropic (Claude) | Claim decomposition, evidence evaluation, LR assessment, narrative summaries |
| **Web search** | TBD (e.g., Tavily, Brave Search API, or Google Custom Search) | Evidence retrieval during investigation |
| **Vector embeddings** | Supabase pgvector + embedding model (TBD) | Claim similarity matching for deduplication |

---

## 3. Data Model

The core schema extends MODELING-KNOWLEDGE.md §2 with metadata tables, a perspective stub for future tenancy, and vector embeddings.

### 3.1 Core Tables (from MODELING-KNOWLEDGE.md)

**`nodes`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() |
| `text` | text | The proposition in natural language |
| `type` | enum('CLAIM', 'EVIDENCE') | |
| `log_odds_prior` | float8 | Default 0.0. For evidence nodes, stores credibility assessment |
| `source` | enum('USER', 'LLM_DECOMPOSITION', 'LLM_EVIDENCE_SEARCH') | |
| `log_odds_posterior` | float8 | Materialized cache |
| `evidence_weight` | float8 | Materialized cache |
| `convergence_status` | enum('INITIAL', 'STABLE', 'UNSTABLE') | Default 'INITIAL' |
| `perspective_id` | uuid | FK → perspectives. Scopes posteriors and priors |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**`edges`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `parent_id` | uuid | FK → nodes |
| `child_id` | uuid | FK → nodes. Constraint: child_id ≠ parent_id |
| `log_lr_positive` | float8 | Raw log-LR as assessed; not normalized |
| `log_lr_negative` | float8 | Raw log-LR as assessed; not normalized |
| `relevance_weight` | float8 | w ∈ (0, 1] |
| `reasoning` | text | LLM justification |
| `perspective_id` | uuid | FK → perspectives |
| `created_at` | timestamptz | |

**`update_log`**

As specified in MODELING-KNOWLEDGE.md §2.3.

### 3.2 Metadata Tables

**`evidence_metadata`** (1:1 with evidence nodes)

| Column | Type | Notes |
|---|---|---|
| `node_id` | uuid | PK, FK → nodes |
| `source_url` | text | |
| `source_type` | enum('JOURNAL_ARTICLE', 'PREPRINT', 'SURVEY', 'NEWS_ARTICLE', 'REPORT', 'BOOK', 'OTHER') | |
| `publication_date` | date | Nullable |
| `authors` | jsonb | Array of strings |
| `journal_or_publisher` | text | |
| `provenance_tier` | int2 | 1–5 per LIKELIHOOD-GRADING-SCALE.md §3.1 |
| `methodology_notes` | jsonb | Structured: sample_size, study_design, statistical_significance, effect_size, confidence_intervals, replication_status, etc. Fields vary by source_type |
| `content_summary` | text | LLM-generated summary of the source |

**`claim_metadata`** (1:1 with claim nodes)

| Column | Type | Notes |
|---|---|---|
| `node_id` | uuid | PK, FK → nodes |
| `domain_tags` | jsonb | Array of strings, e.g., ["remote-work", "productivity"] |
| `embedding` | vector(1536) | For similarity matching via pgvector. Dimension depends on embedding model |

### 3.3 Perspectives (Tenancy Stub)

**`perspectives`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | e.g., "default", or a user's display name |
| `user_id` | uuid | Nullable FK → auth.users. Null for the global default perspective |
| `created_at` | timestamptz | |

The MVP ships with a single row: the global default perspective. All nodes and edges reference it. This table exists so that future multi-perspective support is "add rows and scope queries" rather than a schema migration.

**Future extension path:** When a user wants personalized beliefs, the system creates a new perspective for them. Their edges can override the global defaults (different LR assessments, different weights). Nodes (propositions) remain shared — the same claim exists once in the graph. A user's posterior on that claim is computed from their perspective's edge values. Users who are uninterested in customizing a particular edge inherit the global default without duplicating it.

---

## 4. User Stories

### 4.1 Investigate a Claim

The primary interaction. The user submits a claim in natural language.

**Flow:**

1. The system computes an embedding of the claim text and searches for similar existing nodes via pgvector (cosine similarity above a threshold).
2. **If a near-duplicate exists** (similarity above a high threshold): present the existing node's posterior, evidence weight, convergence status, and immediate neighborhood. Offer to investigate further if coverage is thin (see §4.5 for the investigation trigger).
3. **If no match:** create a new CLAIM node (prior = 0.5 or LLM-estimated), then trigger a scoped investigation (§4.5) which includes graph integration (see below).
4. **If related but distinct nodes exist** (similarity above a lower threshold, below the near-duplicate threshold): create a new CLAIM node, then during scoped investigation, the system attempts to integrate it into the existing graph (see below).
5. Display results: the claim's posterior probability, a visual neighborhood graph, a breakdown of child contributions, and a narrative summary.

**Graph integration during investigation.** When the LLM decomposes a new claim or searches for evidence, it should check proposed sub-claims and evidence against existing nodes (via embedding similarity). This produces three types of connections:

- **Sub-claim reuse:** A proposed sub-claim matches an existing node. Instead of creating a duplicate, the system creates an edge from the new claim to the existing node. The existing node's posterior (informed by its own evidence subtree) immediately contributes to the new claim's posterior via propagation. For example, if "Remote work reduces burnout" decomposes into "Remote workers report fewer distractions," and that node already exists with evidence, the new claim inherits that evidence without duplication.
- **Evidence reuse:** An existing evidence node is relevant to the new claim or its sub-claims. The LLM assesses a new edge (with its own LR grades and relevance weight) connecting the existing evidence to the new claim's subtree. The evidence node is not duplicated; only a new edge is created.
- **Cross-claim edges:** The new claim itself may be evidentially relevant to an existing claim (or vice versa). The LLM assesses whether an edge should exist between them and in which direction. For example, "Remote work reduces burnout" might be a child of "Remote work improves employee retention" if burnout reduction is diagnostic of retention.

The similarity search during integration uses two thresholds:
- **Near-duplicate threshold** (high, e.g., cosine > 0.95): treat as the same proposition, do not create a new node.
- **Related threshold** (moderate, e.g., cosine > 0.75): flag as a candidate for graph integration. The LLM evaluates whether an evidential relationship exists and proposes edges.

Integration candidates (existing nodes above the related threshold) are provided to the LLM as context during decomposition, so it can decide to link to them, use them as sub-claims, or determine that no edge is warranted.

**Acceptance criteria:**
- User can enter any natural-language claim
- System finds existing near-duplicates, related nodes, or creates a new node
- New claims are integrated into the existing graph where evidential relationships exist
- Existing sub-claims and evidence are reused rather than duplicated
- Scoped investigation produces at least a one-level decomposition with evidence
- Posterior is computed and displayed with evidence weight
- User can drill into any sub-claim to trigger further investigation

### 4.2 Ingest Evidence

The user provides a specific source (URL, pasted text, or document) and a claim it relates to.

**Flow:**

1. The user selects a claim node and provides a source.
2. The LLM reads/summarizes the source, assesses credibility (sets evidence node posterior), and evaluates the evidential relationship (LR grades per LIKELIHOOD-GRADING-SCALE.md).
3. System creates an evidence node, populates evidence_metadata, creates an edge with assessed LRs, and triggers propagation.
4. Display the updated posterior for the parent claim and the change delta.

**Acceptance criteria:**
- User can provide a URL or pasted text
- LLM extracts key findings and assesses credibility
- Evidence metadata is populated (source_url, source_type, provenance_tier, methodology_notes, content_summary)
- Edge LRs are assessed per the grading scale
- Propagation updates all affected ancestors

### 4.3 Analyze a Neighborhood

Given a claim, provide structured analysis of its evidential support.

**Flow:**

1. The user selects a claim node and requests analysis.
2. The backend computes (deterministically):
   - **Contribution breakdown:** each child's `w · log(effective_LR)` contribution to the parent, sorted by magnitude
   - **Load-bearing nodes:** children with the highest absolute contribution — removing these would shift the posterior most
   - **Key uncertainties:** children with high relevance weight but low evidence weight (important but uninvestigated)
   - **Conflicts:** children pulling in opposite directions (some positive contributions, some negative)
3. Optionally, the LLM generates a narrative summary from this structured analysis.
4. Display as a combination of visual graph (highlighting load-bearing paths, uncertainties) and text summary.

**Acceptance criteria:**
- Contribution breakdown is computed and displayed
- Load-bearing nodes and key uncertainties are identified
- Conflicts are flagged
- User can navigate from the analysis to any flagged node

### 4.4 Update via Exploration

The user requests a broader LLM-driven exploration of a claim neighborhood.

**Flow:**

1. The user selects a node and requests "explore further."
2. The LLM, operating within the investigation budget (§4.5), performs some combination of:
   - Decompose unexplored claims into sub-claims
   - Search for evidence relevant to claims with low evidence weight
   - Prioritize high-relevance-weight, low-evidence-weight children (key uncertainties)
3. New nodes and edges are created; propagation runs after each batch.
4. Display the updated neighborhood with new nodes highlighted.

**Acceptance criteria:**
- Exploration respects the configured budget
- New nodes are connected to existing graph structure
- Propagation runs and posteriors update
- User sees what was added and how posteriors changed

### 4.5 Investigation Scope and Budget

Each investigation (whether triggered by a new claim or by "explore further") operates within a configurable budget. Budget parameters should be exposed to the user (e.g., via a settings panel or per-request controls).

**Default MVP budget:**

| Parameter | Default | Description |
|---|---|---|
| `max_decomposition_depth` | 1 | How many levels of sub-claim decomposition per investigation |
| `max_evidence_per_claim` | 3 | Maximum evidence nodes retrieved per leaf claim |
| `max_llm_calls` | 10 | Total LLM invocations per investigation (decomposition + evidence search + assessment) |

These are intentionally small to keep API costs bounded. Users can increase them for deeper investigations.

**Investigation trigger:** after presenting an existing claim's neighborhood, the system should offer further investigation if:
- Any child has evidence_weight = 0 (unexplored)
- The claim's total evidence weight is below a threshold (weakly investigated)
- New evidence sources have been published since the last investigation (future: timestamp-based staleness check)

The system should surface the estimated cost (in LLM calls) before executing, so the user can approve or adjust the budget.

---

## 5. LLM Integration

### 5.1 LLM Responsibilities

The LLM performs qualitative reasoning. It does **not** perform graph traversal, propagation, or posterior computation.

| Task | Inputs | Outputs |
|---|---|---|
| **Decompose a claim** | Claim text, existing children (to avoid duplicates), related existing nodes from embedding search (to enable graph integration) | List of sub-claim texts, with flags indicating reuse of existing nodes vs. new nodes |
| **Search for evidence** | Claim text, existing evidence nodes in the neighborhood (to avoid duplicates) | Evidence descriptions + source URLs (via web search tool) |
| **Assess evidence credibility** | Evidence text, source metadata | Credibility probability (→ log_odds_prior for evidence node), provenance tier, methodology notes |
| **Assess edge LRs** | Parent claim text, child text, child type | Qualitative grade for log_lr_positive and log_lr_negative per LIKELIHOOD-GRADING-SCALE.md, relevance weight, reasoning |
| **Narrate analysis** | Structured analysis results (contributions, uncertainties, conflicts) | Human-readable summary paragraph |

### 5.2 Prompting Strategy

Each LLM task uses a structured system prompt that includes:

- The relevant sections of LIKELIHOOD-GRADING-SCALE.md (for LR assessment tasks)
- The output schema (JSON structured output)
- Instructions to reason step-by-step before assigning grades (chain-of-thought improves calibration)
- Examples anchoring each grade level

For claim decomposition, the prompt should instruct the LLM to:
- Review the provided list of related existing nodes and reuse them as sub-claims where appropriate, rather than creating duplicates. This is critical for graph integration — it allows a new claim to immediately benefit from existing evidence subtrees
- Produce sub-claims that are as independent as possible (mitigating the conditional independence assumption from MODELING-KNOWLEDGE.md §4.3)
- Avoid overlapping sub-claims that would cause evidence double-counting
- Prefer specific, testable sub-claims over vague ones
- Consider whether the new claim should be linked as a child of any existing claim (cross-claim edges), and propose such edges with reasoning

For evidence search, the LLM has access to a web search tool and should:
- Prioritize high-provenance sources (Tier 1–3)
- Search for evidence on both sides of the claim (supporting and undermining)
- Report when evidence is ambiguous or conflicting rather than cherry-picking

### 5.3 Tool Access

| Tool | Used by | Purpose |
|---|---|---|
| Web search | Evidence search task | Find relevant studies, articles, data |
| URL fetch | Evidence ingestion (§4.2) | Read user-provided source content |

The LLM does **not** have tools for reading or writing the graph database. All graph mutations flow through the backend API, which validates inputs and triggers propagation.

---

## 6. Backend Architecture

### 6.1 API Routes

| Route | Method | Description |
|---|---|---|
| `/api/claims/search` | POST | Embedding similarity search for existing claims. Returns results in two tiers: near-duplicates (cosine > 0.95) and related nodes (cosine > 0.75) |
| `/api/claims` | POST | Create a new claim node |
| `/api/claims/[id]` | GET | Get claim with posterior, evidence weight, status |
| `/api/claims/[id]/neighborhood` | GET | Get claim with children, edges, and their posteriors |
| `/api/claims/[id]/analysis` | GET | Compute contribution breakdown, load-bearing nodes, uncertainties, conflicts |
| `/api/claims/[id]/investigate` | POST | Trigger scoped LLM investigation with budget params |
| `/api/claims/[id]/explore` | POST | Trigger LLM-driven exploration of existing neighborhood |
| `/api/evidence` | POST | Ingest evidence: create node + metadata + edge, trigger propagation |
| `/api/edges/[id]` | PATCH | User-edit LRs or weight on an edge, trigger propagation |
| `/api/nodes/[id]` | PATCH | User-edit prior or evidence credibility, trigger propagation |
| `/api/audit/[node_id]` | GET | Get update log history for a node |

### 6.2 Propagation Architecture

Propagation may visit many nodes and should not block API responses. Architecture:

1. A graph mutation (new node, new edge, edited edge/prior) writes to the database and enqueues a propagation job.
2. The propagation worker (Supabase edge function or background job) executes the algorithm from MODELING-KNOWLEDGE.md §3.2, writing updated posteriors and update_log entries.
3. The frontend subscribes to real-time updates on relevant node rows (Supabase Realtime). As each node's posterior is updated, the UI reflects the change.
4. The API response returns immediately with the new/modified entity. The frontend shows a "propagating..." indicator until affected nodes settle.

### 6.3 Analysis Endpoints

The `/api/claims/[id]/analysis` endpoint computes the following deterministically from the graph:

**Contribution breakdown:**
```sql
-- For each child edge of the claim, compute w * log(effective_LR)
-- Return sorted by |contribution| descending
```

**Load-bearing nodes:** top N children by `|contribution|`. These are the nodes whose removal would most shift the posterior.

**Key uncertainties:** children where `relevance_weight > threshold` AND `evidence_weight < threshold`. High-relevance but uninvestigated.

**Conflicts:** children with contributions of opposite sign to the majority direction.

These are SQL queries or lightweight application code over the materialized posterior/weight caches — no LLM involvement.

---

## 7. Frontend Architecture

### 7.1 Key Views

**Claim view (primary):** The main interface. A search/entry bar at top. Below, the selected claim's posterior displayed prominently (probability, log-odds, evidence weight, status). Below that, a graph visualization of the immediate neighborhood (one or two hops). Nodes are colored/sized by posterior and evidence weight. Edges show LR direction (supports/undermines) and weight.

**Graph explorer:** A wider view of the graph, navigable by pan/zoom. Useful for seeing how claims connect across topics. Lower priority for MVP but should be architecturally possible (the graph visualization component should support both focused and wide views).

**Audit log view:** For a selected node, show the update history: when the posterior changed, by how much, what triggered it (which edge addition or modification). Tabular format with timestamps.

**Evidence detail view:** For a selected evidence node, show the metadata (source, authors, publication date, methodology notes, provenance tier, content summary) alongside the node's credibility and its edges to parent claims.

### 7.2 Interaction Patterns

- **Enter a claim:** type in the search bar, see matches or create new
- **Investigate:** one-click from any claim to trigger scoped investigation, with budget controls visible
- **Ingest evidence:** from a claim's detail view, paste a URL or text
- **Edit assessments:** click an edge to view/edit LRs and weight (with the grading scale as reference). Click a node to edit its prior or evidence credibility
- **Analyze:** from a claim's detail view, request analysis. Results shown as highlighted graph + text summary
- **Explore:** from a claim or analysis view, request further LLM-driven exploration with budget preview

---

## 8. Deferred to Future Iterations

**Multi-perspective tenancy.** The `perspectives` table is in the schema but only one perspective (global default) exists. Future: per-user perspectives with edge-level overrides, inheriting global defaults for edges the user hasn't customized.

**Browser extension.** A thin client for in-tab fact-checking and evidence ingestion, posting to the same backend API.

**Evidence double-counting detection.** Automated detection of shared evidence across sibling sub-claims, with suggested weight adjustments. See MODELING-KNOWLEDGE.md §6.

**Correlation modeling.** Modeling dependencies between sibling edges rather than assuming conditional independence.

**Staleness detection.** Timestamp-based detection of claims or evidence that may be outdated, triggering re-investigation offers.

**LLM graph navigation.** Giving the LLM direct tools to query and traverse the graph for more sophisticated analysis. MVP handles analysis deterministically.

**Prior elicitation.** LLM-estimated priors based on background knowledge rather than defaulting to 0.5. See MODELING-KNOWLEDGE.md §6.

**Calibration learning.** Tracking posterior accuracy over time to refine the qualitative-to-quantitative LR mapping.

**Academic API integration.** Direct access to Semantic Scholar, PubMed, or similar APIs for higher-quality evidence retrieval.
