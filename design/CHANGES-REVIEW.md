# CHANGES-REVIEW.md — Implementation Summary

All changes build cleanly (`npx next build` passes). The backend is functional end-to-end: database schema is deployed, the graph engine computes posteriors, API routes handle CRUD with propagation, and the LLM integration layer is wired up (pending an `ANTHROPIC_API_KEY` in `.env.local`).

---

## What was built

### Phase 1: Project Scaffolding

| File | Purpose |
|---|---|
| `package.json` | Next.js 16 project with dependencies: `@supabase/supabase-js`, `@supabase/ssr`, `@anthropic-ai/sdk`, `@xyflow/react` |
| `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `eslint.config.mjs` | Standard Next.js config (App Router, TypeScript, Tailwind) |
| `src/lib/supabase/client.ts` | Browser-side Supabase client using the publishable key |
| `src/lib/supabase/server.ts` | Server-side Supabase client using the service role key (bypasses RLS) |
| `src/lib/supabase/perspective.ts` | Helper to fetch the default perspective ID (cached) |
| `src/lib/supabase/database.types.ts` | Auto-generated TypeScript types from the Supabase schema |

### Phase 2: Database Schema

| File | Purpose |
|---|---|
| `supabase/migrations/20260412060121_init_db.sql` | Full initial schema — review carefully |
| `supabase/migrations/20260412195522_add_vector_search_function.sql` | `search_claims_by_embedding()` RPC function for pgvector similarity search |

**Schema includes:**
- Extensions: `pgcrypto`, `vector`
- Enums: `node_type`, `node_source`, `convergence_status`, `evidence_source_type`, `update_source`
- Tables: `perspectives`, `nodes`, `edges`, `update_log`, `evidence_metadata`, `claim_metadata`
- Indexes: on edges (parent/child), nodes (perspective, type), update_log (node+time), claim_metadata embedding (HNSW)
- Trigger: auto-update `updated_at` on nodes
- RLS: enabled on all tables with permissive read/write policies for the MVP (all reads public, all writes allowed). The service role key bypasses RLS anyway for server-side operations.
- Seed: one default perspective row inserted

**Both migrations have been pushed to Supabase.**

### Phase 3: Core Graph Engine

| File | Purpose |
|---|---|
| `src/lib/engine/math.ts` | Pure math functions: `sigmoid`, `logit`, `effectiveLR`, `computePosterior` |
| `src/lib/engine/propagation.ts` | Incremental propagation algorithm per MODELING-KNOWLEDGE.md §3.2 |

**Key implementation details:**
- `effectiveLR()` computes the log-odds interpolation from MODELING-KNOWLEDGE.md §3.1: `p * logLrPos + (1-p) * logLrNeg`
- `computePosterior()` implements the full single-node computation (§3.1 Steps 1-4), returns per-edge contributions
- `propagate()` uses per-node visit counts (not a global counter), `highDelta` set for cycle detection, and marks nodes STABLE/UNSTABLE per our discussion
- Propagation writes `update_log` entries and updates `convergence_status`

### Phase 4: API Routes

| Route | File | Methods | Notes |
|---|---|---|---|
| `/api/nodes` | `src/app/api/nodes/route.ts` | POST | Create any node type |
| `/api/nodes/[id]` | `src/app/api/nodes/[id]/route.ts` | GET, PATCH | PATCH triggers propagation if prior changes |
| `/api/edges` | `src/app/api/edges/route.ts` | POST | Stores LRs directly, triggers propagation on parent |
| `/api/edges/[id]` | `src/app/api/edges/[id]/route.ts` | PATCH | Updates LRs/weight, triggers propagation |
| `/api/claims` | `src/app/api/claims/route.ts` | POST | Creates node + claim_metadata |
| `/api/claims/search` | `src/app/api/claims/search/route.ts` | POST | Two-tier similarity search (vector or text fallback) |
| `/api/claims/[id]/neighborhood` | `src/app/api/claims/[id]/neighborhood/route.ts` | GET | Returns node + children + parents with probabilities |
| `/api/claims/[id]/analysis` | `src/app/api/claims/[id]/analysis/route.ts` | GET | Contribution breakdown, load-bearing nodes, uncertainties, conflicts |
| `/api/claims/[id]/investigate` | `src/app/api/claims/[id]/investigate/route.ts` | POST | Triggers LLM investigation with budget |
| `/api/claims/[id]/explore` | `src/app/api/claims/[id]/explore/route.ts` | POST | Explores key uncertainties in existing neighborhood |
| `/api/evidence` | `src/app/api/evidence/route.ts` | POST | Creates evidence node + metadata + edge, triggers propagation |
| `/api/audit/[nodeId]` | `src/app/api/audit/[nodeId]/route.ts` | GET | Paginated audit log for a node |

### Phase 5: LLM Integration

| File | Purpose |
|---|---|
| `src/lib/llm/client.ts` | Anthropic SDK client singleton, default model config |
| `src/lib/llm/prompts/decompose.ts` | Claim decomposition prompt — produces sub-claims, supports reusing existing nodes |
| `src/lib/llm/prompts/assess-edge.ts` | Edge LR assessment prompt — uses the 7-point grading scale, assesses both LR components independently |
| `src/lib/llm/prompts/assess-evidence.ts` | Evidence credibility assessment — produces credibility score, provenance tier, methodology notes |
| `src/lib/llm/prompts/narrate.ts` | Narrative summary generation from structured analysis |
| `src/lib/llm/investigate.ts` | Investigation orchestrator — coordinates decompose → evidence search → assess → create → propagate |

**Investigation flow:**
1. Decompose claim into sub-claims (reusing existing nodes where possible)
2. For each sub-claim, assess edge LRs
3. For each leaf sub-claim, search for evidence
4. For each piece of evidence, assess credibility and edge LRs
5. Create all nodes and edges with assessed LRs
6. Propagate from leaves upward

Budget tracking enforces `maxLlmCalls` across all steps.

---

## What's NOT yet built

- **Frontend views** (Phase 6): The `src/app/page.tsx` is still the default Next.js landing page. Claim view, graph visualization, evidence detail, and audit log views are not yet implemented.
- **Embedding generation**: The `claims/search` route accepts pre-computed embeddings but does not generate them. An embedding model integration (e.g., OpenAI `text-embedding-3-small`) is needed.
- **`ANTHROPIC_API_KEY`**: Must be added to `.env.local` for LLM features to work.
- **Tests**: No test files yet for the math utilities or propagation.
- **Real-time subscriptions**: Not yet wired up in the frontend.
- **Error handling / retries**: LLM calls have no retry logic yet.

---

## To get running

```bash
# Add your Anthropic API key to .env.local
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env.local

# Start dev server
npm run dev

# Test a route (e.g., create a claim)
curl -X POST http://localhost:3000/api/claims \
  -H "Content-Type: application/json" \
  -d '{"text": "Remote work increases productivity"}'

# Investigate the claim (requires ANTHROPIC_API_KEY)
curl -X POST http://localhost:3000/api/claims/<id>/investigate \
  -H "Content-Type: application/json" \
  -d '{"max_llm_calls": 10}'
```

---

## Files to review (priority order)

1. **`supabase/migrations/20260412060121_init_db.sql`** — The schema is the foundation. Check RLS policies, constraints, and the default perspective seed.
2. **`src/lib/engine/math.ts`** — Core math must be correct. Verify `effectiveLR` and `computePosterior` against MODELING-KNOWLEDGE.md.
3. **`src/lib/engine/propagation.ts`** — The propagation algorithm. Verify visit-count logic, convergence status assignment, and the queue/highDelta interaction.
4. **`src/lib/llm/investigate.ts`** — The investigation orchestrator. Check the flow, budget enforcement, and node/edge creation.
5. **`src/lib/llm/prompts/assess-edge.ts`** — The LR grading prompt. Verify the 7-point scale mapping matches LIKELIHOOD-GRADING-SCALE.md.
6. **API routes** — Spot-check that propagation is triggered correctly for each mutation type.
