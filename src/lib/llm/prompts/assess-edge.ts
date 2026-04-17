import { getAnthropicClient, DEFAULT_MODEL } from "../client";

/**
 * The 7-point likelihood grading scale.
 * See: LIKELIHOOD-GRADING-SCALE.md §2
 */
export const LR_GRADE_MAP: Record<string, number> = {
  negligible: 0.1,
  very_weak: 0.3,
  weak: 0.5,
  moderate: 0.7,
  strong: 1.1,
  very_strong: 1.6,
  decisive: 2.3,
};

const SYSTEM_PROMPT = `You are an expert at assessing evidential relationships for a Bayesian argument mapping system.

Given a PARENT claim and a CHILD proposition (claim or evidence), assess how diagnostic the child's truth-value is of the parent's truth-value.

You must assess TWO quantities independently:

1. **log_lr_positive**: If the child is TRUE, how diagnostic is that of the parent?
   - Positive value means child being true SUPPORTS the parent
   - Negative value means child being true UNDERMINES the parent

2. **log_lr_negative**: If the child is FALSE, how diagnostic is that of the parent?
   - Positive value means child being false SUPPORTS the parent
   - Negative value means child being false UNDERMINES the parent

These are generally asymmetric — do NOT assume one is the negative of the other.

3. **relevance_weight**: How much does this child bear on the parent at all? A value between 0 (exclusive) and 1 (inclusive). Use lower values for tangentially related propositions.

For each LR assessment, use the 7-point scale:
- negligible (0.1): Barely informative
- very_weak (0.3): Slight signal, could be noise
- weak (0.5): Mildly informative
- moderate (0.7): Meaningfully informative, ~2x likelihood ratio
- strong (1.1): Substantially informative, ~3x likelihood ratio
- very_strong (1.6): Highly informative, ~5x likelihood ratio
- decisive (2.3): Near-conclusive, ~10x likelihood ratio

Consider both PROVENANCE (peer-reviewed > preprint > survey > anecdote) and METHODOLOGICAL STRENGTH (sample size, significance, effect size, replication, controls).

Think step-by-step before assigning grades.

Respond with a JSON object:
{
  "reasoning": "Step-by-step reasoning about the evidential relationship",
  "log_lr_positive_grade": "one of: negligible, very_weak, weak, moderate, strong, very_strong, decisive",
  "log_lr_positive_sign": "positive or negative (does child being true support or undermine parent?)",
  "log_lr_negative_grade": "one of the same scale",
  "log_lr_negative_sign": "positive or negative",
  "relevance_weight": 0.7
}`;

export interface AssessEdgeInput {
  parentText: string;
  childText: string;
  childType: "CLAIM" | "EVIDENCE";
}

export interface AssessEdgeResult {
  logLrPositive: number;
  logLrNegative: number;
  relevanceWeight: number;
  reasoning: string;
}

export async function assessEdge(
  input: AssessEdgeInput
): Promise<AssessEdgeResult> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `PARENT CLAIM: "${input.parentText}"\n\nCHILD ${input.childType}: "${input.childText}"`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [
    null,
    text,
  ];
  const parsed = JSON.parse(jsonMatch[1]!.trim()) as {
    reasoning: string;
    log_lr_positive_grade: string;
    log_lr_positive_sign: string;
    log_lr_negative_grade: string;
    log_lr_negative_sign: string;
    relevance_weight: number;
  };

  const positiveMagnitude =
    LR_GRADE_MAP[parsed.log_lr_positive_grade] ?? 0.5;
  const negativeMagnitude =
    LR_GRADE_MAP[parsed.log_lr_negative_grade] ?? 0.5;

  const logLrPositive =
    parsed.log_lr_positive_sign === "negative"
      ? -positiveMagnitude
      : positiveMagnitude;

  const logLrNegative =
    parsed.log_lr_negative_sign === "negative"
      ? -negativeMagnitude
      : negativeMagnitude;

  return {
    logLrPositive,
    logLrNegative,
    relevanceWeight: Math.max(0.01, Math.min(1, parsed.relevance_weight)),
    reasoning: parsed.reasoning,
  };
}
