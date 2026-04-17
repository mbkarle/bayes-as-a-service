import { getAnthropicClient, DEFAULT_MODEL } from "../client";

const SYSTEM_PROMPT = `You are an expert at explaining Bayesian argument analysis results in clear, accessible language.

Given a structured analysis of a claim (its posterior probability, evidence weight, child contributions, and key findings), produce a concise narrative summary that a non-technical user can understand.

Guidelines:
- Lead with the bottom line: what the current evidence suggests about the claim
- Explain which evidence is most influential and why
- Highlight key uncertainties or gaps in the evidence
- Note any conflicts in the evidence
- Use plain language — avoid jargon like "log-odds" or "likelihood ratio"
- Keep the summary to 2-4 paragraphs`;

export interface NarrateInput {
  claimText: string;
  probability: number;
  evidenceWeight: number;
  contributions: Array<{
    childText: string;
    childType: string;
    weightedLogLR: number;
    relevanceWeight: number;
    childEvidenceWeight: number;
  }>;
  keyUncertainties: Array<{ childText: string }>;
  conflicts: {
    supporting: Array<{ childText: string }>;
    undermining: Array<{ childText: string }>;
  } | null;
}

export async function narrateAnalysis(input: NarrateInput): Promise<string> {
  const client = getAnthropicClient();

  const analysisContext = `
CLAIM: "${input.claimText}"
CURRENT PROBABILITY: ${(input.probability * 100).toFixed(1)}%
EVIDENCE WEIGHT: ${input.evidenceWeight.toFixed(2)} (${input.evidenceWeight < 0.3 ? "very little evidence" : input.evidenceWeight < 1 ? "moderate evidence" : "substantial evidence"})

EVIDENCE BREAKDOWN (sorted by influence):
${input.contributions
  .map(
    (c) =>
      `- "${c.childText}" (${c.childType}): ${c.weightedLogLR > 0 ? "supports" : "undermines"} the claim (influence: ${Math.abs(c.weightedLogLR).toFixed(2)}, ${c.childEvidenceWeight < 0.1 ? "UNEXPLORED" : `evidence weight: ${c.childEvidenceWeight.toFixed(2)}`})`
  )
  .join("\n")}

${
  input.keyUncertainties.length > 0
    ? `KEY UNCERTAINTIES (important but uninvestigated):\n${input.keyUncertainties.map((u) => `- "${u.childText}"`).join("\n")}`
    : "No major uncertainties identified."
}

${
  input.conflicts
    ? `CONFLICTING EVIDENCE:\nSupporting: ${input.conflicts.supporting.map((s) => `"${s.childText}"`).join(", ")}\nUndermining: ${input.conflicts.undermining.map((u) => `"${u.childText}"`).join(", ")}`
    : "No conflicting evidence."
}`;

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Write a narrative summary of this analysis:\n\n${analysisContext}`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
