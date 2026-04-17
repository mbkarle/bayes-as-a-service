# LIKELIHOOD-GRADING-SCALE.md — Qualitative-to-Quantitative LR Mapping

## 1. Purpose

When the LLM assesses how diagnostic a child node's truth-value is of a parent node, it produces two qualitative judgments: one for the child being true (`log_lr_positive`) and one for the child being false (`log_lr_negative`). Each judgment maps to a **magnitude** on the scale below. The **sign** is determined by the direction of influence — positive if the observation supports the parent, negative if it undermines.

The LLM assigns log-LR values via this scale. These values are stored directly on edges without normalization — see MODELING-KNOWLEDGE.md §4.3 for the rationale on accepting the small bias that asymmetric LRs produce at P = 0.5.

---

## 2. The 7-Point Scale

| Grade | log\|LR\| | \|LR\| | Interpretation |
|---|---|---|---|
| **Negligible** | 0.1 | ~1.1 | Barely worth noting. The observation is marginally more expected under one hypothesis, but not enough to meaningfully update beliefs. |
| **Very weak** | 0.3 | ~1.3 | Slightly informative. A faint signal that nudges beliefs but could easily be noise or artifact. |
| **Weak** | 0.5 | ~1.6 | Mildly informative. Noticeable evidential value, but substantial uncertainty remains about the relationship. |
| **Moderate** | 0.7 | ~2.0 | Meaningfully informative. The observation is roughly twice as likely under one hypothesis as the other. A solid but not conclusive signal. |
| **Strong** | 1.1 | ~3.0 | Substantially informative. The observation is about three times as likely under one hypothesis. Would shift a neutral prior noticeably. |
| **Very strong** | 1.6 | ~5.0 | Highly informative. The observation is about five times as likely under one hypothesis. Difficult to explain away. |
| **Decisive** | 2.3 | ~10.0 | Near-conclusive. The observation is an order of magnitude more likely under one hypothesis. Reserved for overwhelming or logically entailed evidence. |

The scale is logarithmically spaced: each step roughly doubles the linear likelihood ratio relative to the previous step's departure from 1. This means the difference between "negligible" and "very weak" is small in absolute terms, while the difference between "very strong" and "decisive" is large — matching the intuition that extreme confidence should require disproportionately stronger evidence.

---

## 3. Assessment Dimensions

The LLM should evaluate two orthogonal dimensions when selecting a grade, then combine them into an overall judgment.

### 3.1 Provenance

How trustworthy is the source or method that produced this evidence?

| Tier | Examples | Typical ceiling |
|---|---|---|
| **Tier 1: Gold standard** | Peer-reviewed systematic reviews/meta-analyses, large pre-registered RCTs, replicated experimental results, established mathematical/physical laws | Decisive |
| **Tier 2: Strong institutional** | Peer-reviewed original research in reputable journals, government statistical agencies (e.g., census data, BLS), large-scale pre-registered observational studies | Very strong |
| **Tier 3: Credible but limited** | Working papers/preprints, smaller peer-reviewed studies, well-designed industry reports with transparent methodology, credentialed expert testimony | Strong |
| **Tier 4: Informal/partial** | Surveys without rigorous sampling, journalistic investigations, self-reported data, conference presentations, non-peer-reviewed technical reports | Moderate |
| **Tier 5: Anecdotal/unverified** | Blog posts, social media, personal anecdotes, unattributed claims, undisclosed methodology | Very weak |

The "typical ceiling" indicates the maximum grade that provenance alone would usually justify. Exceptional methodological strength can push above the ceiling by one grade; poor methodology can pull well below it.

### 3.2 Methodological Strength

How much should we trust the specific findings, given the source?

| Factor | Stronger | Weaker |
|---|---|---|
| **Sample size** | Large (n > 1000 for surveys, n > 100 per arm for RCTs) | Small (n < 30), or unreported |
| **Statistical significance** | p < 0.01 with appropriate corrections | p > 0.05, or significance not reported |
| **Effect size** | Large, practically meaningful effect | Small effect near the noise floor |
| **Confidence intervals** | Tight, excluding null | Wide, spanning null |
| **Controls/design** | Randomized, blinded, controlled for confounders | Observational, uncontrolled, obvious confounders |
| **Replication** | Independently replicated across settings | Single study, no replication attempts |
| **Generalizability** | Diverse populations, multiple contexts | Single population, narrow context |
| **Potential bias** | Pre-registered, transparent methods, no conflicts | Post-hoc analysis, undisclosed conflicts, selective reporting |

### 3.3 Combining Dimensions

The overall grade is typically the **minimum** of what provenance and methodology would independently suggest, with adjustments:

- Exceptional methodology can raise the grade **one step above** the provenance ceiling (e.g., a brilliantly designed preprint study could reach "strong" despite Tier 3 provenance).
- Poor methodology pulls the grade **down without limit** regardless of provenance (a peer-reviewed study with n=8 and no controls may warrant only "very weak").
- When factors conflict (e.g., large sample but obvious confounders), lean toward the weaker assessment. Overconfidence is more harmful than underconfidence in this system, because relevance weights and evidence aggregation can compound errors.

---

## 4. Anchoring Examples

Each example illustrates the grade for a *specific* evidential relationship, not a blanket assessment of the source.

### Negligible (log|LR| = 0.1)

- An informal blog post recounts a personal anecdote tangentially related to the claim. The post has no data, no methodology, and the connection to the claim requires several inferential leaps.
- A social media poll (self-selected respondents, n ≈ 200) asks a question adjacent to but not directly about the claim.

### Very Weak (log|LR| = 0.3)

- A small convenience-sample survey (n = 40, no controls) reports results directionally consistent with the claim. Published as a conference poster.
- An industry expert mentions a relevant trend in a podcast interview without citing specific data or studies.

### Weak (log|LR| = 0.5)

- A peer-reviewed case study (n = 1 organization) documents outcomes consistent with the claim. Credible source, but no generalizability or controls.
- A correlational study (n = 500) published in a mid-tier journal finds a statistically significant association (p = 0.03), but with obvious potential confounders uncontrolled.

### Moderate (log|LR| = 0.7)

- A well-designed observational study (n = 2,000) with reasonable controls finds a moderate effect size. Published in a reputable peer-reviewed journal. Not randomized, so causal inference is limited.
- A meta-analysis of 8 heterogeneous studies finds a pooled effect in the expected direction, but with high between-study variance (I² > 60%).

### Strong (log|LR| = 1.1)

- An RCT (n = 300 per arm) with pre-registration finds a statistically significant result (p < 0.01) and a practically meaningful effect size. Published in a top-tier journal. Single study, awaiting replication.
- A systematic review of 15 studies finds consistent effects (I² < 30%) across varied settings, with a pooled effect size excluding null.

### Very Strong (log|LR| = 1.6)

- Three independent RCTs across different populations all find large, statistically significant effects (p < 0.001) with tight confidence intervals. All pre-registered, no conflicts of interest.
- A well-replicated laboratory finding (5+ independent replications) with a clear causal mechanism and large effect size.

### Decisive (log|LR| = 2.3)

- Overwhelming scientific consensus backed by dozens of high-quality studies, multiple systematic reviews, and established theory. Comparable to the evidence that smoking causes lung cancer or that antibiotics treat bacterial infections.
- A direct logical or mathematical entailment: if the child proposition is true, the parent follows by necessity (or near-necessity given well-understood physical laws).

---

## 5. Applying the Scale to Both LR Components

Each edge requires two independent assessments:

1. **log_lr_positive:** "If the child is *true*, how diagnostic is that of the parent?" Evaluate the grade, determine the sign (positive if the child being true supports the parent, negative if it undermines), and assign `±grade_magnitude`.

2. **log_lr_negative:** "If the child is *false*, how diagnostic is that of the parent?" Evaluate independently — do not assume symmetry. A study finding a positive result may be "strong" evidence for the parent, while a null result from the same study may be only "weak" evidence against (e.g., due to low statistical power).

**Common asymmetry patterns:**

| Pattern | Typical LR relationship | Example |
|---|---|---|
| Strong positive, weak negative | \|log_lr_pos\| > \|log_lr_neg\| | A positive RCT result strongly supports efficacy, but a null result could reflect underpowering rather than true inefficacy |
| Weak positive, strong negative | \|log_lr_pos\| < \|log_lr_neg\| | A survey showing satisfaction is only weakly informative (self-report bias), but widespread reported dissatisfaction would be strongly diagnostic |
| Symmetric | \|log_lr_pos\| ≈ \|log_lr_neg\| | A well-powered, pre-registered study where both positive and null results are equally interpretable |

---

## 6. Worked Example

**Claim (parent):** "Remote workers report fewer distractions."
**Evidence (child):** "Stanford 2015 study: call center remote workers showed 13% performance increase." P = 0.80.

**Assessment of log_lr_positive** (child true → parent):

- *Provenance:* Peer-reviewed study in a reputable journal (Tier 2). Ceiling: very strong.
- *Methodology:* Randomized (lottery-based), reasonable sample (n ≈ 250), single firm, single country, call center workers only. Moderate effect size. Statistically significant.
- *Relevance:* The study measured performance, not distractions directly, though the authors attributed gains partly to fewer distractions. Inferential step required.
- *Combined:* Methodology is solid but narrow generalizability and indirect measurement of the parent claim. One step below ceiling → **strong** for the direct finding, but the indirect link to "fewer distractions" reduces to **moderate**.
- **Grade: moderate (positive).** log_lr_pos = +0.7.

**Assessment of log_lr_negative** (child false → parent):

- If the study's findings were false (retracted, failed replication), what would that tell us about distractions?
- A failed replication would be quite informative: a well-designed study that *should* have detected a distraction-related effect didn't. This is more diagnostic than the positive case because a null result from a well-powered study is harder to explain away.
- **Grade: strong (negative).** log_lr_neg = −1.1.

These values are stored directly on the edge without normalization.
