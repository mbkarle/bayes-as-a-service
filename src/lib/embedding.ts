/**
 * Voyage AI embedding client.
 * Uses voyage-3-lite (512 dimensions) for cost-effective semantic search.
 */

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite";
export const EMBEDDING_DIMENSIONS = 512;

function getApiKey(): string {
  const key = process.env.VOYAGER_API_KEY;
  if (!key) throw new Error("VOYAGER_API_KEY is not set");
  return key;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: "document",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage AI API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return json.data.map((d) => d.embedding);
}

export async function embedOne(text: string): Promise<number[]> {
  const [embedding] = await embed([text]);
  return embedding;
}

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      input_type: "query",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage AI API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return json.data[0].embedding;
}
