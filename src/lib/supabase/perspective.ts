import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let cachedDefaultPerspectiveId: string | null = null;

/**
 * Get the default perspective ID. Cached after first fetch.
 */
export async function getDefaultPerspectiveId(
  supabase: SupabaseClient<Database>
): Promise<string> {
  if (cachedDefaultPerspectiveId) return cachedDefaultPerspectiveId;

  const { data, error } = await supabase
    .from("perspectives")
    .select("id")
    .eq("name", "default")
    .single();

  if (error || !data) throw new Error("Default perspective not found");
  cachedDefaultPerspectiveId = data.id;
  return data.id;
}
