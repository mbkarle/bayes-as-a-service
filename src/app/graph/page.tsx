"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
  Position,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { fetchGraph, type GraphResponse } from "@/lib/api";
import { effectiveLogLR, sigmoid } from "@/lib/engine/math";

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

const palette = {
  light: {
    highPos: "#16a34a",
    midPos: "#4ade80",
    highNeg: "#dc2626",
    midNeg: "#f87171",
    neutral: "#a1a1aa",
    evidence: "#2563eb",
    evidenceBorder: "#1d4ed8",
    nodeBorder: "#d4d4d8",
    nodeText: "#fff",
    edgeLabel: "#71717a",
    bgDots: "#e4e4e7",
    miniMapMask: "rgba(250,250,250,0.7)",
  },
  dark: {
    highPos: "#22c55e",
    midPos: "#166534",
    highNeg: "#ef4444",
    midNeg: "#7f1d1d",
    neutral: "#52525b",
    evidence: "#1d4ed8",
    evidenceBorder: "#3b82f6",
    nodeBorder: "#52525b",
    nodeText: "#fafafa",
    edgeLabel: "#a1a1aa",
    bgDots: "#27272a",
    miniMapMask: "rgba(9,9,11,0.7)",
  },
};

function probabilityColor(p: number, dark: boolean): string {
  const c = dark ? palette.dark : palette.light;
  if (p >= 0.75) return c.highPos;
  if (p >= 0.6) return c.midPos;
  if (p <= 0.25) return c.highNeg;
  if (p <= 0.4) return c.midNeg;
  return c.neutral;
}

function edgeColor(
  childLogOdds: number,
  logLrPos: number,
  logLrNeg: number,
  dark: boolean
): string {
  const c = dark ? palette.dark : palette.light;
  const pChild = sigmoid(childLogOdds);
  const eLR = effectiveLogLR(pChild, logLrPos, logLrNeg);
  if (eLR > 0.05) return c.highPos;
  if (eLR < -0.05) return c.highNeg;
  return c.neutral;
}

/**
 * Simple force-directed-ish layout: arrange nodes in layers by depth from roots.
 * Roots = nodes with no parents (no edge targets them).
 */
function layoutNodes(
  graphNodes: GraphResponse["nodes"],
  graphEdges: GraphResponse["edges"]
): Map<string, { x: number; y: number }> {
  const childToParents = new Map<string, string[]>();
  const parentToChildren = new Map<string, string[]>();

  for (const e of graphEdges) {
    childToParents.set(e.child_id, [
      ...(childToParents.get(e.child_id) ?? []),
      e.parent_id,
    ]);
    parentToChildren.set(e.parent_id, [
      ...(parentToChildren.get(e.parent_id) ?? []),
      e.child_id,
    ]);
  }

  const nodeIds = new Set(graphNodes.map((n) => n.id));
  const depths = new Map<string, number>();

  // BFS from roots
  const roots = graphNodes.filter(
    (n) =>
      !childToParents.has(n.id) ||
      childToParents.get(n.id)!.every((pid) => !nodeIds.has(pid))
  );

  const queue: Array<{ id: string; depth: number }> = roots.map((r) => ({
    id: r.id,
    depth: 0,
  }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    depths.set(id, depth);

    for (const childId of parentToChildren.get(id) ?? []) {
      if (!visited.has(childId) && nodeIds.has(childId)) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    }
  }

  // Any disconnected nodes get depth 0
  for (const n of graphNodes) {
    if (!depths.has(n.id)) depths.set(n.id, 0);
  }

  // Group by depth, lay out horizontally
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depths) {
    byDepth.set(d, [...(byDepth.get(d) ?? []), id]);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const xSpacing = 280;
  const ySpacing = 160;

  for (const [depth, ids] of byDepth) {
    const totalWidth = (ids.length - 1) * xSpacing;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: -totalWidth / 2 + i * xSpacing,
        y: depth * ySpacing,
      });
    });
  }

  return positions;
}

export default function GraphExplorerPage() {
  const router = useRouter();
  const dark = useDarkMode();
  const c = dark ? palette.dark : palette.light;

  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = useCallback(async (limit = 200, offset = 0) => {
    try {
      const data = await fetchGraph(limit, offset);
      setGraphData(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!graphData) return { initialNodes: [], initialEdges: [] };

    const positions = layoutNodes(graphData.nodes, graphData.edges);
    const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));

    const rfNodes: Node[] = graphData.nodes.map((n) => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      const isEvidence = n.type === "EVIDENCE";
      const prob = n.probability;
      const label =
        n.text.length > 60 ? n.text.slice(0, 57) + "..." : n.text;

      return {
        id: n.id,
        position: pos,
        data: { label: `${label}\n${(prob * 100).toFixed(1)}%` },
        style: {
          background: isEvidence
            ? c.evidence
            : probabilityColor(prob, dark),
          color: c.nodeText,
          border: isEvidence
            ? `2px dashed ${c.evidenceBorder}`
            : `1px solid ${c.nodeBorder}`,
          borderRadius: isEvidence ? 16 : 8,
          padding: "6px 10px",
          fontSize: 11,
          width: 180,
          textAlign: "center" as const,
          cursor: "pointer",
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    });

    const rfEdges: Edge[] = graphData.edges
      .filter((e) => nodeMap.has(e.parent_id) && nodeMap.has(e.child_id))
      .map((e) => {
        const child = nodeMap.get(e.child_id)!;
        return {
          id: e.id,
          source: e.parent_id,
          target: e.child_id,
          style: {
            stroke: edgeColor(
              child.log_odds_posterior,
              e.log_lr_positive,
              e.log_lr_negative,
              dark
            ),
            strokeWidth: 1.5,
          },
          label: `w=${e.relevance_weight.toFixed(2)}`,
          labelStyle: { fontSize: 9, fill: c.edgeLabel },
        };
      });

    return { initialNodes: rfNodes, initialEdges: rfEdges };
  }, [graphData, dark, c]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when data changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!graphData) return;
      const gNode = graphData.nodes.find((n) => n.id === node.id);
      if (!gNode) return;
      if (gNode.type === "EVIDENCE") {
        router.push(`/evidence/${node.id}`);
      } else {
        router.push(`/claims/${node.id}`);
      }
    },
    [graphData, router]
  );

  const hasMore = graphData ? graphData.offset + graphData.limit < graphData.total : false;

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-[600px] rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Graph Explorer</h1>
          <p className="text-sm text-muted mt-1">
            {graphData?.total ?? 0} nodes total
            {hasMore && " (showing first " + (graphData?.limit ?? 200) + ")"}
          </p>
        </div>
        {hasMore && (
          <button
            onClick={() =>
              loadGraph((graphData?.limit ?? 200) + 100, 0)
            }
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Load more nodes
          </button>
        )}
      </div>

      <div className="h-[700px] w-full rounded-lg border border-border overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          colorMode={dark ? "dark" : "light"}
          nodesDraggable
          nodesConnectable={false}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background color={c.bgDots} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) => {
              const style = node.style as Record<string, string> | undefined;
              return style?.background ?? c.neutral;
            }}
            maskColor={c.miniMapMask}
            style={{ borderRadius: 8 }}
          />
        </ReactFlow>
      </div>

      <div className="flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{ background: c.highPos }}
          />
          High probability
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{ background: c.highNeg }}
          />
          Low probability
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{ background: c.neutral }}
          />
          Neutral / uncertain
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border-2 border-dashed"
            style={{ background: c.evidence, borderColor: c.evidenceBorder }}
          />
          Evidence
        </span>
      </div>
    </div>
  );
}
