import { getAnthropicClient, DEFAULT_MODEL } from "../client";

const SYSTEM_PROMPT = `You are an expert at assessing the credibility of evidence for a Bayesian argument mapping system.

Given a piece of evidence (a study, article, report, or other source), assess:

1. **Credibility**: How likely is it that this evidence is accurate/true? Express as a probability between 0 and 1.
   - 0.95+: Well-replicated, gold-standard evidence
   - 0.80-0.95: Strong single study or credible report
   - 0.60-0.80: Moderate credibility, some methodological concerns
   - 0.40-0.60: Low credibility, significant concerns
   - Below 0.40: Likely unreliable

2. **Provenance tier** (1-5):
   - 1: Gold standard (systematic reviews, large pre-registered RCTs, established laws)
   - 2: Strong institutional (peer-reviewed original research, government statistics)
   - 3: Credible but limited (preprints, smaller studies, industry reports)
   - 4: Informal/partial (surveys without rigorous sampling, journalism)
   - 5: Anecdotal/unverified (blog posts, social media, personal anecdotes)

3. **Methodology notes**: Structured assessment of sample size, study design, statistical significance, effect size, replication status, and potential biases.

4. **Content summary**: A concise summary of what the evidence shows.

Think step-by-step about credibility before assigning a score.

Respond with a JSON object:
{
  "reasoning": "Step-by-step credibility assessment",
  "credibility": 0.80,
  "provenance_tier": 2,
  "methodology_notes": {
    "study_design": "RCT",
    "sample_size": "n=300",
    "statistical_significance": "p<0.01",
    "effect_size": "moderate",
    "replication_status": "not yet replicated",
    "potential_biases": "single firm, limited generalizability"
  },
  "content_summary": "Brief summary of key findings"
}`;

export interface AssessEvidenceInput {
  evidenceText: string;
  sourceUrl?: string;
}

export interface AssessEvidenceResult {
  credibility: number;
  provenanceTier: number;
  methodologyNotes: Record<string, string>;
  contentSummary: string;
  reasoning: string;
}

export async function assessEvidence(
  input: AssessEvidenceInput
): Promise<AssessEvidenceResult> {
  const client = getAnthropicClient();

  const sourceContext = input.sourceUrl
    ? `\nSource URL: ${input.sourceUrl}`
    : "";

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Assess the credibility of this evidence:\n\n"${input.evidenceText}"${sourceContext}`,
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
    credibility: number;
    provenance_tier: number;
    methodology_notes: Record<string, string>;
    content_summary: string;
  };

  return {
    credibility: Math.max(0.01, Math.min(0.99, parsed.credibility)),
    provenanceTier: Math.max(1, Math.min(5, parsed.provenance_tier)),
    methodologyNotes: parsed.methodology_notes,
    contentSummary: parsed.content_summary,
    reasoning: parsed.reasoning,
  };
}
