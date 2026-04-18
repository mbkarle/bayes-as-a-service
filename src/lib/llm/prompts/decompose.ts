import { getAnthropicClient, DEFAULT_MODEL } from "../client";

const SYSTEM_PROMPT = `You are an expert at structuring arguments for a Bayesian argument mapping system.

Decomposition is NOT always appropriate. It is a tool for breaking apart complex or multi-faceted claims that cannot be directly evidenced as a whole. Many claims — especially specific, empirical ones — are better served by direct evidence than by decomposition.

Your task: given a claim, decide whether decomposition is warranted. If so, break it into 2-4 sub-claims.

When to decompose:
- The claim bundles multiple logically distinct dimensions (e.g., "Remote work increases productivity AND improves retention")
- The claim is abstract or high-level and no single study could directly address it
- Different aspects of the claim require fundamentally different types of evidence

When NOT to decompose (return an empty subclaims array):
- The claim is specific and empirically testable as-is (e.g., "Meta-analyses show X improves Y by Z%")
- The claim is already narrow enough that direct evidence would be more informative than sub-claims
- Decomposing would just create sub-claims that rely on the same underlying evidence (double-counting)

Guidelines for sub-claims (when decomposing):
- Each sub-claim should be as independent as possible. Avoid sub-claims that share underlying evidence.
- Prefer specific, testable propositions over vague ones.
- Sub-claims should be propositions (true/false statements), not questions.
- Consider both sides: include sub-claims that, if false, would undermine the parent claim.
- Aim for 2-3 sub-claims. Only use 4 if the claim genuinely has that many independent dimensions.

You will also receive a list of EXISTING NODES in the graph that are semantically related to this claim. If any of your proposed sub-claims are equivalent to an existing node, you MUST reuse that node (by referencing its ID) rather than creating a duplicate.

Respond with a JSON object matching this schema:
{
  "should_decompose": true,
  "decompose_reasoning": "Why decomposition is or isn't appropriate for this claim",
  "subclaims": [
    {
      "text": "The sub-claim proposition text",
      "existing_node_id": "uuid-if-reusing-existing-node or null",
      "reasoning": "Why this sub-claim is relevant and how it bears on the parent"
    }
  ]
}`;

export interface DecomposeInput {
  claimText: string;
  existingChildren: Array<{ id: string; text: string }>;
  relatedNodes: Array<{ id: string; text: string; similarity: number }>;
}

export interface DecomposeResult {
  shouldDecompose: boolean;
  decomposeReasoning: string;
  subclaims: Array<{
    text: string;
    existing_node_id: string | null;
    reasoning: string;
  }>;
}

export async function decomposeClaim(
  input: DecomposeInput
): Promise<DecomposeResult> {
  const client = getAnthropicClient();

  const existingContext =
    input.relatedNodes.length > 0
      ? `\n\nEXISTING RELATED NODES (reuse these instead of creating duplicates):\n${input.relatedNodes
          .map(
            (n) =>
              `- [${n.id}] "${n.text}" (similarity: ${n.similarity.toFixed(2)})`
          )
          .join("\n")}`
      : "";

  const childContext =
    input.existingChildren.length > 0
      ? `\n\nEXISTING CHILDREN (already connected, do not duplicate):\n${input.existingChildren
          .map((c) => `- [${c.id}] "${c.text}"`)
          .join("\n")}`
      : "";

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Decompose this claim into sub-claims:\n\n"${input.claimText}"${existingContext}${childContext}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from the response (handle markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [
    null,
    text,
  ];
  const raw = JSON.parse(jsonMatch[1]!.trim()) as {
    should_decompose?: boolean;
    decompose_reasoning?: string;
    subclaims: DecomposeResult["subclaims"];
  };

  return {
    shouldDecompose: raw.should_decompose ?? raw.subclaims.length > 0,
    decomposeReasoning: raw.decompose_reasoning ?? "",
    subclaims: raw.subclaims ?? [],
  };
}
