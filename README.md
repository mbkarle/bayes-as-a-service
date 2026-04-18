# Bayesian Argument Map

A web application for structured reasoning about claims. Enter any claim and the system will decompose it (when appropriate), find evidence, assess likelihood ratios, and compute a Bayesian posterior probability — all visualized as an interactive argument graph.

## How it works

1. **Claims** are propositions that can be true or false. Each has a prior and posterior probability maintained in log-odds space.
2. **Evidence** nodes represent specific findings (studies, data, observations) that bear on claims.
3. **Edges** encode the evidential relationship between a child and parent node via two independent likelihood ratios (LR when child is true, LR when child is false) and a **relevance weight** that controls how much of the parent's truth-value the child accounts for.
4. **Bayesian propagation** updates posteriors incrementally when any node or edge changes, using log-odds interpolation to combine likelihood ratios with the child's own uncertainty.

The system uses Claude to assess evidential relationships and a 7-point likelihood grading scale (negligible through decisive). Relevance weights are intentionally conservative — a typical sub-claim gets 0.05–0.25, reflecting that it is one of many factors rather than fully explanatory on its own.

## Tech stack

- **Next.js 16** (App Router, React 19)
- **Supabase** (Postgres with pgvector, Realtime subscriptions)
- **Claude API** (claim decomposition, evidence search, edge assessment)
- **Voyage AI** (semantic embeddings for duplicate detection and related-claim search)
- **React Flow** (@xyflow/react) for graph visualization
- **Tailwind CSS v4**

## Quick start

### Prerequisites

- Node.js 20+
- A Supabase project with the migrations applied
- An Anthropic API key
- A Voyage AI API key

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLIC_KEY,
#          SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, VOYAGER_API_KEY

# Apply database migrations
npx supabase db push

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a claim, and click **Search**. If no existing match is found, click **Create & Investigate** to kick off the LLM pipeline.

### Running tests

```bash
npm test
```

## Project structure

```
src/
  app/                    # Next.js App Router pages and API routes
    api/
      claims/             # CRUD, search, investigate, explore
      nodes/, edges/      # Direct node/edge operations
      audit/, evidence/   # Audit log and evidence metadata
    claims/[id]/          # Claim detail + audit views
    evidence/[id]/        # Evidence detail view
  components/             # React components (graph, posterior display, etc.)
  hooks/                  # Realtime subscription hooks
  lib/
    engine/               # Bayesian math (log-odds, propagation)
    llm/                  # LLM orchestration (decompose, assess, investigate)
    supabase/             # Supabase client and helpers
    embedding.ts          # Voyage AI embedding client
    api.ts                # Client-side fetch helpers
    types.ts              # Shared TypeScript types
supabase/
  migrations/             # SQL migrations (schema, vector search, etc.)
design/                   # Design docs and modeling knowledge
```
