"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface NodeUpdate {
  id: string;
  log_odds_posterior: number;
  evidence_weight: number;
  convergence_status: "INITIAL" | "STABLE" | "UNSTABLE";
}

/**
 * Subscribe to realtime updates on the `nodes` table for a set of node IDs.
 * Returns a map of nodeId → latest update, plus a `propagating` flag that
 * stays true for a short window after any update (for the UI indicator).
 */
export function useRealtimeNodes(nodeIds: string[]) {
  const [updatedNodes, setUpdatedNodes] = useState<Record<string, NodeUpdate>>(
    {}
  );
  const [propagating, setPropagating] = useState(false);
  const propagatingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Stable reference for the IDs to avoid re-subscribing on every render
  const idsKey = nodeIds.slice().sort().join(",");

  const handleUpdate = useCallback((payload: { new: NodeUpdate }) => {
    const updated = payload.new;
    setUpdatedNodes((prev) => ({ ...prev, [updated.id]: updated }));

    // Set propagating indicator
    setPropagating(true);
    if (propagatingTimeout.current) {
      clearTimeout(propagatingTimeout.current);
    }
    propagatingTimeout.current = setTimeout(() => {
      setPropagating(false);
    }, 2000);
  }, []);

  useEffect(() => {
    if (!idsKey) return;

    const supabase = createClient();
    const ids = idsKey.split(",");

    // Subscribe to UPDATE events on the nodes table for the given IDs.
    // Supabase Realtime supports filter on a single column with `in` operator.
    const channel = supabase
      .channel(`nodes-realtime-${idsKey.slice(0, 32)}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "nodes",
          filter: ids.length === 1 ? `id=eq.${ids[0]}` : undefined,
        },
        (payload) => {
          // If we couldn't use a filter (multiple IDs), filter client-side
          const updated = payload.new as NodeUpdate;
          if (ids.includes(updated.id)) {
            handleUpdate({ new: updated });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (propagatingTimeout.current) {
        clearTimeout(propagatingTimeout.current);
      }
    };
  }, [idsKey, handleUpdate]);

  return { updatedNodes, propagating };
}
