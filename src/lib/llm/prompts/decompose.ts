import { getAnthropicClient, DEFAULT_MODEL } from "../client";

const SYSTEM_PROMPT = `You are an expert at breaking down complex claims into independent, testable sub-claims for a Bayesian argument mapping system.

Your task: given a claim, decompose it into 2-5 sub-claims that together address the key aspects of whether the claim is true or false.

Guidelines:
- Each sub-claim should be as independent as possible from the others. Avoid sub-claims that share underlying evidence, as this causes double-counting in the Bayesian model.
- Prefer specific, testable sub-claims over vague ones. "Studies show X" is better than "X is generally accepted."
- Sub-claims should be propositions (true/false statements), not questions.
- Consider both sides: include sub-claims that, if false, would undermine the parent claim.

You will also receive a list of EXISTING NODES in the graph that are semantically related to this claim. If any of your proposed sub-claims are equivalent to an existing node, you MUST reuse that node (by referencing its ID) rather than creating a duplicate. This is critical for maintaining a connected knowledge graph.

Respond with a JSON object matching this schema:
{
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
  const parsed = JSON.parse(jsonMatch[1]!.trim()) as DecomposeResult;

  return parsed;
}
