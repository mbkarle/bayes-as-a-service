# MODELING-KNOWLEDGE.md — Bayesian Argument Map

## 1. Glossary of Terms

**Proposition.** A statement that is either true or false. All nodes in the argument map represent propositions.

**Prior probability, P₀(C).** Our initial belief in a proposition C before considering any evidence. Expressed equivalently as a probability in [0, 1] or as log-odds in (-∞, +∞).

**Posterior probability, P(C | E).** Our updated belief in C after considering evidence E.

**Odds.** An alternative parameterization of probability: O(C) = P(C) / (1 − P(C)). Odds and probability carry identical information. If P(C) = 0.75, then O(C) = 3 (read: "3 to 1 in favor").

**Log-odds.** The natural logarithm of the odds: ℓ(C) = log O(C) = log P(C) − log(1 − P(C)). Log-odds live on (−∞, +∞), with 0 corresponding to P = 0.5 (maximum uncertainty). Positive values indicate "more likely true," negative values "more likely false."

**Sigmoid function.** The inverse of the log-odds transform: P(C) = σ(ℓ) = 1 / (1 + e^(−ℓ)). Converts log-odds back to probability.

**Likelihood ratio (LR).** The ratio P(E | C) / P(E | ¬C). It measures how diagnostic a piece of evidence E is of a proposition C — specifically, how much more likely we are to observe E in worlds where C is true versus worlds where C is false. LR > 1 means E supports C; LR < 1 means E undermines C; LR = 1 means E is uninformative about C.

**Log-likelihood ratio.** log(LR). The additive form of the likelihood ratio used in log-odds updating.

**Relevance weight.** A scalar w ∈ (0, 1] on each edge that attenuates the child's log-LR contribution to the parent. It captures "how much does this child bear on the parent at all?" and has no formal Bayesian analog — it is a pragmatic mechanism for expressing partial relevance. See §4.3 for discussion of tradeoffs.

**Bayes' rule (odds form).** O(C | E) = O(C) · LR. Updating is multiplication of odds by the likelihood ratio. In log-odds: ℓ(C | E) = ℓ(C) + log(LR). Updating is addition.

**Log-odds interpolation.** Computing an effective log-likelihood ratio by interpolating between the positive and negative log-LRs, weighted by the child's posterior probability: log(effective_LR) = P(A) · log(LR_positive) + (1 − P(A)) · log(LR_negative). This is equivalent to a geometric mixture of the likelihood ratios: effective_LR = LR_positive^P(A) · LR_negative^(1−P(A)).

**Evidence weight.** A scalar proxy for how much total evidence underlies a posterior estimate. Computed as the sum of absolute log-LR contributions. Distinguishes "P = 0.5 because we have no evidence" (weight ≈ 0) from "P = 0.5 because evidence is balanced" (weight large).

---

## 2. Data Model

### 2.1 Nodes

A **Node** represents a proposition in the argument graph. There are exactly two types:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `text` | string | The proposition in natural language |
| `type` | enum | `CLAIM` or `EVIDENCE` |
| `log_odds_prior` | float | Prior log-odds, set at creation. Default: 0 (i.e., P₀ = 0.5) |
| `source` | enum | `USER`, `LLM_DECOMPOSITION`, or `LLM_EVIDENCE_SEARCH` |
| `log_odds_posterior` | float | *Materialized cache.* Current posterior log-odds, derived from prior + children |
| `evidence_weight` | float | *Materialized cache.* Sum of |wᵢ · log(effective_LRᵢ)| across all child edges |
| `convergence_status` | enum | `INITIAL`, `STABLE`, or `UNSTABLE` |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**CLAIM** nodes are interior nodes whose posteriors are derived from their children. They may have zero children (unexplored), in which case their posterior equals their prior.

**EVIDENCE** nodes are leaf nodes representing direct observations or findings. Their posteriors are set directly via credibility assessment (e.g., P = 0.95 for a well-replicated finding, P = 0.6 for a single anecdotal report). They do not have children. For evidence nodes, `log_odds_prior` stores the credibility assessment — since evidence nodes have no children, the propagation formula (§3.1) yields posterior = prior, so the assessed credibility becomes the node's effective posterior. The `type` distinction is functional: it tells the system whether to attempt decomposition (claims) or credibility assessment (evidence), and prevents evidence nodes from having children. Mathematically, the propagation formula treats them identically.

A node is a "root" if it has no parents — this is a graph property, not a stored attribute. Any claim can become a sub-claim of another claim at any time.

### 2.2 Edges

An **Edge** represents an evidential relationship from a child node to a parent node. It encodes: "how diagnostic is the child's truth-value of the parent's truth-value?"

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `parent_id` | UUID | FK → Node. The claim being informed |
| `child_id` | UUID | FK → Node. The claim or evidence providing information |
| `log_lr_positive` | float | log P(child true \| parent true) / P(child true \| parent false) |
| `log_lr_negative` | float | log P(child false \| parent true) / P(child false \| parent false) |
| `relevance_weight` | float | w ∈ (0, 1]. How much this child bears on the parent |
| `reasoning` | text | LLM's justification for the assigned values |
| `created_at` | timestamp | |

**`log_lr_positive`** answers: "How much more likely are we to observe the child being true in worlds where the parent is true vs. false?" Positive values mean the child being true supports the parent. Negative values mean it undermines.

**`log_lr_negative`** answers the same question for the child being *false*. These two values are generally asymmetric — see §4.2.

**`relevance_weight`** attenuates the child's influence on the parent. It captures "how much does this child bear on the parent at all?" and has no formal Bayesian analog — see §4.3.

No `valence` field is needed. The direction of influence (supports vs. undermines) is fully encoded in the signs and magnitudes of the two log-LRs.

**Constraint:** Self-loops are forbidden (parent_id ≠ child_id). Multi-node cycles are permitted — see §3.3.

### 2.3 Update Log

An append-only audit trail recording every change to the graph.

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `node_id` | UUID | FK → Node. The node whose posterior changed |
| `trigger_edge_id` | UUID (nullable) | The edge addition/modification that triggered this update |
| `log_odds_before` | float | |
| `log_odds_after` | float | |
| `evidence_weight_before` | float | |
| `evidence_weight_after` | float | |
| `source` | enum | `LLM_DECOMPOSITION`, `LLM_EVIDENCE_EVAL`, `USER_MANUAL`, `PROPAGATION` |
| `reasoning` | text (nullable) | |
| `created_at` | timestamp | |

---

## 3. Update Algorithms

### 3.1 Single-Node Posterior Computation

Given a node N with children connected via edges E₁, E₂, ..., Eₖ:

**Step 1: Compute each child's effective likelihood ratio.**

For each edge Eᵢ with child Cᵢ:

```
p_child = σ(Cᵢ.log_odds_posterior)
log(effective_LRᵢ) = p_child · Eᵢ.log_lr_positive + (1 − p_child) · Eᵢ.log_lr_negative
```

This interpolates between the positive and negative log-likelihood ratios in log-odds space, weighted by the child's posterior probability. Equivalently, effective_LR = LR_positive^p · LR_negative^(1−p) — a geometric mixture of the two likelihood ratios.

**Note on bias at maximum uncertainty.** When a child's posterior is exactly 0.5 (maximally uncertain), the effective log-LR is 0.5 · (log_lr_pos + log_lr_neg), which is generally non-zero for asymmetric LR pairs. This small bias is accepted as reflecting the inherent asymmetry of the evidential relationship. Conservative relevance weights (see §4.3) ensure this bias remains negligible in practice.

**Step 2: Aggregate in log-odds space.**

```
N.log_odds_posterior = N.log_odds_prior + Σᵢ wᵢ · log(effective_LRᵢ)
```

where wᵢ = Eᵢ.relevance_weight.

**Step 3: Compute evidence weight.**

```
N.evidence_weight = Σᵢ |wᵢ · log(effective_LRᵢ)|
```

**Step 4: Derive display probability.**

```
P(N) = σ(N.log_odds_posterior)
```

### 3.2 Incremental Propagation

When the graph changes (a new edge is added, an evidence node's credibility is revised, or an edge's LRs are modified), propagation updates affected nodes without recomputing the entire graph.

The entry point `changed_node_id` depends on the type of change:

- **New edge added** (child C → parent P): pass the parent P (it has a new child to incorporate).
- **Evidence node credibility revised**: pass the evidence node (its parents will be enqueued automatically).
- **Edge LRs or weight modified**: pass the edge's parent (its posterior depends on the modified edge).

```
function propagate(changed_node_id):
    queue = [changed_node_id]
    visit_count = {}            // per-node visit counter
    high_delta = set()          // nodes that changed substantially on last visit
    max_visits_per_node = 50
    convergence_threshold = 0.001

    while queue is not empty:
        node = dequeue(queue)
        visit_count[node.id] = visit_count.get(node.id, 0) + 1

        if visit_count[node.id] > max_visits_per_node:
            high_delta.add(node.id)     // treat as unconverged
            continue                     // stop re-relaxing this node

        old_posterior = node.log_odds_posterior

        recompute_posterior(node)          // §3.1, Steps 1–3

        delta = |node.log_odds_posterior − old_posterior|

        log_update(node, old_posterior)    // write to UpdateLog

        if delta > convergence_threshold:
            high_delta.add(node.id)
            for each edge where edge.child_id = node.id:
                enqueue(queue, edge.parent_id)
        else:
            high_delta.discard(node.id)   // settled on this visit

    // Final status assignment
    for node_id in all visited nodes:
        if (visit_count[node_id] > 1 and node_id in high_delta) or node_id in queue:
            node.convergence_status = UNSTABLE
        else:
            node.convergence_status = STABLE
```

**Convergence statuses:**

| Status | Meaning |
|---|---|
| `INITIAL` | Node has never been through propagation (default at creation) |
| `STABLE` | Posterior is up-to-date and settled |
| `UNSTABLE` | Node is in or affected by an unconverged cycle; displayed value is an approximation |

A node is marked UNSTABLE only if it was visited more than once *and* its last visit still had delta above the convergence threshold, or if it was still in the queue when propagation stopped. This distinguishes normal large first-pass updates (single visit, large delta — just a DAG traversal) from genuinely unconverged cyclic nodes (multiple visits, still changing).

Key properties:

- Each node's posterior is recomputed from *all* its children (not incrementally patched), so there is no accumulated drift.
- The incrementality is in *which nodes* are recomputed: only those reachable upstream from the change, and only those whose posteriors shift by more than the convergence threshold.
- The iteration limit is per-node (not global), so long acyclic paths are not throttled — the safety valve targets cycles specifically.
- The convergence threshold serves a dual role: it terminates cycles that have settled, and it acts as a relevance cutoff for long chains where the signal has attenuated below a meaningful level. At 0.001 log-odds (~0.00025 probability at P=0.5), this cutoff is negligible for display purposes.
- For DAG subgraphs, this terminates in a single pass (one visit per node on the path from the changed node to the roots).
- For cyclic subgraphs, iteration continues until convergence or the per-node safety valve. See §3.3.

### 3.3 Cycles and Convergence

The graph permits cycles. Propagation through cycles uses iterative relaxation (a form of loopy belief propagation):

1. All nodes are initialized with their current cached posteriors.
2. When a change propagates around a cycle, each node is revisited with its children's updated states.
3. Iteration continues until all posteriors stabilize within the convergence threshold, or per-node visit limits are reached.

**Convergence is not guaranteed** for arbitrary cycles with strong influence weights. In practice, convergence is expected within 3–5 iterations for typical argument maps where relevance weights are moderate (w < 1) and log-LRs are coarse-grained (|log_lr| < 2). Nodes that fail to converge are marked `UNSTABLE` and flagged in the UI.

### 3.4 Full Recomputation

For consistency checks, data migrations, or on user request, the system can recompute all posteriors from ground truth:

1. Initialize every node's posterior to its prior.
2. Compute strongly connected components (e.g., via Tarjan's algorithm). The DAG of SCCs defines a processing order.
3. Process SCCs in reverse topological order (leaves first). For singleton SCCs (acyclic nodes), one computation suffices. For multi-node SCCs (cycles), iterate within the SCC until convergence using the same relaxation algorithm as §3.2.
4. Compare results against the materialized cache. Any discrepancies indicate bugs or numerical drift.

---

## 4. Mathematical Foundations and Assumptions

### 4.1 What Is Rigorous

**Bayes' rule in log-odds form.** The core update rule ℓ(C | E) = ℓ(C) + log(LR) is an exact restatement of Bayes' theorem. No approximation.

**Log-odds interpolation over uncertain children.** The formula log(effective_LR) = p · log_lr_pos + (1 − p) · log_lr_neg interpolates between the two diagnostic scenarios in log-odds space, weighted by the child's posterior. This is a geometric (rather than arithmetic) mixture of the likelihood ratios — it is not a formal marginalization, but it produces well-behaved updates: contributions scale smoothly with the child's posterior, and the interpolation is linear in the same log-odds space used for aggregation.

**Log-odds aggregation with independent evidence.** Summing log-LR contributions across children is equivalent to multiplying likelihood ratios, which is the correct Bayesian update for independent evidence. See §4.3 for the independence assumption.

**Sigmoid conversion.** P = σ(ℓ) = 1/(1 + e^(−ℓ)) is the definition of the logistic function and introduces no approximation.

### 4.2 Asymmetric Likelihood Ratios

Each edge stores two separate log-likelihood ratios: one for the child being true, one for it being false. This is necessary because the diagnostic value of a positive vs. negative finding is generally asymmetric.

**Analogy to diagnostic testing.** A medical test with sensitivity 0.95 and specificity 0.90 has LR_positive = 9.5 and LR_negative = 0.056. Using the symmetric assumption (LR_negative = 1/LR_positive = 0.105) would introduce a factor-of-two error on negative results.

The asymmetric model eliminates this error at the cost of requiring the LLM to assess two quantities per edge rather than one.

### 4.3 Assumptions and Shortcuts

**Relevance weights (w).** The weight w ∈ (0, 1] on each edge attenuates the child's log-LR contribution. This has no formal analog in Bayesian inference, where evidence either enters the likelihood function or it does not. The weight is a pragmatic mechanism for expressing partial relevance: "this child bears on the parent, but only somewhat."

Relevance weights are the **primary mitigation tool** against over-adjustment from sub-claims. They should be set to conservative, low values — typically in the range 0.1–0.3 for most evidential relationships. Higher values (0.4–0.5) should be reserved for cases where the child is highly diagnostic and directly relevant to the parent. Values above 0.5 should be rare and require strong justification.

*Tradeoff:* Without weights, every child would exert its full LR on the parent regardless of tangential relevance, producing overconfident posteriors. With weights, the system can express graded relevance at the cost of introducing a non-Bayesian parameter. In practice, relevance weights behave like a soft version of feature selection — they control how much each piece of evidence is "allowed" to influence the posterior. The conservative-by-default philosophy ensures that adding sub-claims to the graph does not cause wild swings in the parent's posterior.

**Bias at maximum uncertainty.** Because the system uses log-odds interpolation (§3.1), a child at P = 0.5 with asymmetric LRs contributes a small non-zero effective log-LR: 0.5 · (log_lr_pos + log_lr_neg). This bias is accepted as reflecting the inherent asymmetry of the evidential relationship — the fact that a positive finding and a negative finding are not equally diagnostic is a real property of the relationship, not an artifact to be removed. Combined with conservative relevance weights, this bias is negligible in practice: an asymmetry of |log_lr_pos + log_lr_neg| = 0.2 with a relevance weight of 0.2 produces a contribution of only 0.02 log-odds (~0.005 probability at P = 0.5).

**Conditional independence.** The log-odds aggregation sums contributions from each child independently. This assumes that the evidence provided by each child is conditionally independent given the parent's truth value. In practice, sub-claims often share underlying evidence or causal structure.

*Tradeoff:* Violating independence leads to double-counting evidence, which produces overconfident posteriors. The system mitigates this by (a) flagging shared evidence in the UI so the user can adjust weights, and (b) setting relevance weights conservatively low as a general damping mechanism. A more sophisticated version could model correlation between children, but this approaches the complexity of a full Bayesian network.

**LLM-estimated likelihood ratios.** The LLM assigns qualitative assessments (strongly supports, moderately undermines, etc.) that are mapped to numeric log-LRs via a predetermined scale. This is the least Bayesian component of the system — the numbers are not derived from data or calibrated probability models.

*Tradeoff:* The system depends on the LLM's ability to make coarse-grained qualitative distinctions about evidential relevance. Empirically, LLMs are reasonable at ordinal judgments (X supports Y more than Z does) even when their cardinal probability estimates are poorly calibrated. The qualitative-to-quantitative mapping is specified in LIKELIHOOD-GRADING-SCALE.md as a 7-point scale from "negligible" (log|LR| = 0.1) to "decisive" (log|LR| = 2.3). The coarse granularity is designed so that moderate miscalibration produces small posterior errors.

**Evidence weight as confidence proxy.** The evidence weight Σ|wᵢ · log(effective_LRᵢ)| is a heuristic, not a Bayesian quantity. It does not correspond to a parameter of a posterior distribution (as a Beta distribution's concentration parameter would).

*Tradeoff:* We sacrifice the ability to express a full posterior distribution over probabilities in exchange for simplicity. The evidence weight is sufficient for the primary UI requirement: distinguishing unexplored nodes from well-investigated ones.

**Loopy belief propagation.** Iterative relaxation through cycles is an approximation. The fixed point of loopy BP is not guaranteed to equal the true marginal posteriors of the corresponding joint distribution, and convergence is not guaranteed in general.

*Tradeoff:* Forbidding cycles would sacrifice expressiveness (many real arguments are circular). Loopy BP is widely used in practice and tends to produce reasonable approximations, especially with moderate-strength interactions. The convergence status flag lets the UI communicate uncertainty about cyclic regions.

### 4.4 What the LLM Does vs. What the Math Does

| Task | Performed by | When |
|---|---|---|
| Decompose a claim into sub-claims | LLM | On user request (lazy) |
| Search for evidence relevant to a claim | LLM | On user request (lazy) |
| Assess log_lr_positive and log_lr_negative for an edge | LLM | At edge creation time (not modified by propagation; may be revised manually by user) |
| Assess relevance_weight for an edge | LLM | At edge creation time (not modified by propagation; may be revised manually by user) |
| Assess credibility of an evidence node (set its posterior) | LLM | At evidence creation time (may be revised) |
| Compute effective_LR from stored LRs and child posterior | Deterministic math | At propagation time |
| Aggregate log-odds contributions | Deterministic math | At propagation time |
| Propagate updates through the graph | Deterministic algorithm | On any graph change |
| Convert log-odds to display probability | Deterministic math | At display time |

---

## 5. Toy Example

### Setup

A user enters the root claim:

> **"Remote work increases productivity."**

The LLM decomposes this into two sub-claims and finds one piece of evidence.

**Nodes:**

| ID | Text | Type | log_odds_prior |
|---|---|---|---|
| N1 | Remote work increases productivity | CLAIM | 0.0 (P₀ = 0.5) |
| N2 | Remote workers report fewer distractions | CLAIM | 0.0 (P₀ = 0.5) |
| N3 | Remote workers work longer hours | CLAIM | 0.0 (P₀ = 0.5) |
| N4 | Stanford 2015 study: call center remote workers showed 13% performance increase | EVIDENCE | 1.39 (P = 0.80) |

Node N4 is an evidence node whose posterior is set directly by the LLM's credibility assessment at P = 0.80 (well-known study, single firm, limited generalizability → not fully certain).

**Edges** (relevance weights set conservatively per §4.3):

| Parent | Child | log_lr_pos | log_lr_neg | weight | Reasoning |
|---|---|---|---|---|---|
| N1 | N2 | 0.8 | −0.6 | 0.4 | Fewer distractions is moderately diagnostic of productivity gains, but productivity has many other drivers |
| N1 | N3 | 0.4 | −0.3 | 0.2 | Longer hours weakly suggests higher output, but could reflect inefficiency |
| N2 | N4 | 1.0 | −1.5 | 0.5 | The Stanford study directly measured a distraction-related outcome; asymmetric because a null finding would be quite informative |

### Step-by-step Computation

**Phase 1: Compute N2's posterior (has one child: N4).**

N4 is an evidence node with P = 0.80, so p_child = 0.80.

```
log(effective_LR) = p_child · log_lr_pos + (1 − p_child) · log_lr_neg
                  = 0.80 · 1.0 + 0.20 · (−1.5)
                  = 0.80 − 0.30
                  = 0.50

contribution = w · log(effective_LR) = 0.5 · 0.50 = 0.250

N2.log_odds_posterior = 0.0 + 0.250 = 0.250
P(N2) = σ(0.250) = 0.562
N2.evidence_weight = |0.250| = 0.250
```

Interpretation: the Stanford study shifts our belief in "fewer distractions" from 50% to about 56%.

**Phase 2: Compute N3's posterior (has no children yet).**

```
N3.log_odds_posterior = N3.log_odds_prior = 0.0
P(N3) = 0.5
N3.evidence_weight = 0
```

N3 is unexplored — no evidence, posterior equals prior.

**Phase 3: Compute N1's posterior (has two children: N2, N3).**

Child N2: p_child = σ(0.250) = 0.562.

```
log(effective_LR₂) = 0.562 · 0.8 + 0.438 · (−0.6)
                    = 0.450 − 0.263
                    = 0.187

contribution₂ = 0.4 · 0.187 = 0.075
```

Child N3: p_child = σ(0.0) = 0.5.

```
log(effective_LR₃) = 0.5 · 0.4 + 0.5 · (−0.3)
                    = 0.20 − 0.15
                    = 0.05

contribution₃ = 0.2 · 0.05 = 0.010
```

N3 is unexplored (posterior = prior = 0.5) but contributes a small non-zero amount (0.010 log-odds ≈ 0.003 probability) due to the asymmetry in its LRs. This bias is negligible thanks to the conservative relevance weight (w = 0.2) — see §4.3.

Aggregate:

```
N1.log_odds_posterior = 0.0 + 0.075 + 0.010 = 0.085
P(N1) = σ(0.085) = 0.521
N1.evidence_weight = |0.075| + |0.010| = 0.085
```

### Result

| Node | Prior P | Posterior P | Evidence Weight | Status |
|---|---|---|---|---|
| N1: Remote work increases productivity | 0.50 | 0.52 | 0.09 | Weakly evidenced |
| N2: Fewer distractions | 0.50 | 0.56 | 0.25 | Partially evidenced |
| N3: Longer hours | 0.50 | 0.50 | 0.00 | Unexplored |
| N4: Stanford study | 0.80 | 0.80 | — | Observed evidence |

### Observations

1. **Conservative weights limit influence.** The relevance weights (0.2–0.5) ensure that no single sub-claim dominates the parent's posterior. The Stanford study — a well-known finding with P = 0.80, flowing through two edges with weights 0.5 and 0.4 — shifts the root claim only from 0.50 to 0.52. This is by design: sub-claims should accumulate evidence gradually, not cause wild swings.

2. **Asymmetric LRs in action.** The edge from N4 to N2 has |log_lr_negative| > log_lr_positive (1.5 vs. 1.0). If the Stanford study had been discredited (N4 posterior dropping to, say, 0.2), the negative finding would shift N2 more than the positive finding did — N2 would drop below 0.5, not merely return to 0.5. The log-odds interpolation: 0.2 · 1.0 + 0.8 · (−1.5) = −1.0, versus the current 0.5 from the positive case.

3. **Bias at P = 0.5 is negligible.** N3 is unexplored (posterior = 0.5) but contributes 0.010 log-odds to N1 — about 0.003 probability — due to the asymmetry in its LR pair (log_lr_pos + log_lr_neg = 0.4 − 0.3 = 0.1). The conservative relevance weight (w = 0.2) reduces this already-small bias to a negligible amount. This is acceptable: the asymmetry reflects a real property of the evidential relationship (longer hours being true is slightly more diagnostic of productivity than longer hours being false).

4. **Evidence weight distinguishes knowledge states.** N2 has evidence_weight 0.25 (partially investigated); N3 has 0.0 (unexplored). Both might have had similar posteriors if N2's evidence had been weak, but the evidence weight reveals which posterior is actually informed by data.

5. **Priors propagate naturally.** If N3's prior had been set to 0.7 (reflecting expert consensus that remote workers do tend to work longer hours), its contribution would increase from 0.010 to 0.2 · (0.7 · 0.4 + 0.3 · (−0.3)) = 0.2 · 0.19 = 0.038 log-odds — still modest, but meaningfully larger. The departure from 0.5 represents genuine prior knowledge flowing upward through the graph.

### Adding Contradictory Evidence

Suppose the user now adds a new piece of evidence that undermines N2:

> **N5:** "Buffer 2023 survey: 27% of remote workers report more distractions at home than office." P = 0.70 (credible survey, self-reported data).

New edge:

| Parent | Child | log_lr_pos | log_lr_neg | weight |
|---|---|---|---|---|
| N2 | N5 | −0.8 | 0.5 | 0.3 |

Note the signs: log_lr_positive is *negative* because observing that remote workers report more distractions is *less likely* in worlds where "fewer distractions" is true. This is an undermining relationship, encoded entirely by the LR signs — no valence flag needed. The weight (0.3) is conservative, reflecting that a self-reported survey is less directly relevant than an experimental study.

Recomputing N2:

```
Child N4: contribution₄ = 0.250 (unchanged from above)

Child N5: p_child = σ(0.847) = 0.70
log(effective_LR₅) = 0.70 · (−0.8) + 0.30 · 0.5
                    = −0.560 + 0.150
                    = −0.410

contribution₅ = 0.3 · (−0.410) = −0.123

N2.log_odds_posterior = 0.0 + 0.250 + (−0.123) = 0.127
P(N2) = σ(0.127) = 0.532
N2.evidence_weight = |0.250| + |0.123| = 0.373
```

N2 drops from 0.56 to 0.53 — the contradictory evidence partially offsets the Stanford study but doesn't overwhelm it (the Stanford study had higher credibility and a higher-weighted edge). Evidence weight *increased* from 0.25 to 0.37, reflecting that we now have *more* information, even though it conflicts. Propagation would then update N1 accordingly.

---

## 6. Open Questions for Future Development

**Evidence double-counting.** If two sub-claims are supported by the same underlying study, the independence assumption causes that study's influence to be counted twice. Possible mitigations: explicit shared-evidence detection, correlation modeling between sibling edges, or user-adjustable weights.

**LR calibration.** The qualitative-to-quantitative mapping is specified in LIKELIHOOD-GRADING-SCALE.md as a 7-point scale (negligible through decisive) with anchoring examples and structured assessment dimensions. The current scale values and grade boundaries are design choices. Empirical calibration studies could refine these mappings, or the system could learn user-specific calibration over time.

**Prior elicitation.** The default prior of P = 0.5 (log_odds = 0) is maximally uninformative but may not reflect genuine prior knowledge. The system could support user-specified priors or LLM-estimated priors based on background knowledge, with appropriate audit logging.

**Cycle stability.** The current convergence analysis is empirical (iterate and check). Formal analysis of convergence conditions for the specific update rule used here could provide guarantees or identify pathological graph structures.

**Evidence node revision.** Currently, evidence credibility is set once. A richer model might allow credibility to be updated if the evidence itself is later challenged (e.g., a study is retracted), with appropriate propagation.
