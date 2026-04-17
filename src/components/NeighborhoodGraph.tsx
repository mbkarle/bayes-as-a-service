"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NeighborhoodResponse } from "@/lib/types";
import { effectiveLogLR, sigmoid } from "@/lib/engine/math";

interface NeighborhoodGraphProps {
  data: NeighborhoodResponse;
}

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

const colors = {
  light: {
    highPos: "#16a34a",
    midPos: "#4ade80",
    highNeg: "#dc2626",
    midNeg: "#f87171",
    neutral: "#a1a1aa",
    evidence: "#2563eb",
    evidenceBorder: "#1d4ed8",
    nodeBorder: "#d4d4d8",
    centerBorder: "#18181b",
    nodeText: "#fff",
    edgeLabel: "#71717a",
    bgDots: "#e4e4e7",
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
    centerBorder: "#a1a1aa",
    nodeText: "#fafafa",
    edgeLabel: "#a1a1aa",
    bgDots: "#27272a",
  },
};

function probabilityColor(p: number, dark: boolean): string {
  const c = dark ? colors.dark : colors.light;
  if (p >= 0.75) return c.highPos;
  if (p >= 0.6) return c.midPos;
  if (p <= 0.25) return c.highNeg;
  if (p <= 0.4) return c.midNeg;
  return c.neutral;
}

function contributionEdgeColor(childLogOdds: number, logLrPos: number, logLrNeg: number, dark: boolean): string {
  const c = dark ? colors.dark : colors.light;
  const pChild = sigmoid(childLogOdds)
  const effectiveLR = effectiveLogLR(pChild, logLrPos, logLrNeg)
  if (effectiveLR > 0.05) return c.highPos;
  if (effectiveLR < -0.05) return c.highNeg;
  return c.neutral;
}

function nodeSize(evidenceWeight: number): number {
  // Base size 60, scales up with evidence weight, capped at 120
  return Math.min(120, 60 + evidenceWeight * 40);
}

export default function NeighborhoodGraph({ data }: NeighborhoodGraphProps) {
  const router = useRouter();
  const dark = useDarkMode();
  const c = dark ? colors.dark : colors.light;

  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];
    const seen = new Set<string>();

    // Center node
    const centerNode = data.node;
    const centerW = nodeSize(centerNode.evidence_weight);
    rfNodes.push({
      id: centerNode.id,
      position: { x: 300, y: 200 },
      data: {
        label: `${centerNode.text}\n${(centerNode.probability * 100).toFixed(1)}%`,
      },
      style: {
        background: probabilityColor(centerNode.probability, dark),
        color: c.nodeText,
        border: `2px solid ${c.centerBorder}`,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 600,
        width: Math.max(centerW * 2.5, 180),
        textAlign: "center" as const,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
    seen.add(centerNode.id);

    // Children below
    const childCount = data.children.length;
    data.children.forEach((child, i) => {
      if (seen.has(child.node.id)) return;
      seen.add(child.node.id);

      const spacing = 220;
      const totalWidth = (childCount - 1) * spacing;
      const x = 300 - totalWidth / 2 + i * spacing;

      const isEvidence = child.node.type === "EVIDENCE";
      const w = nodeSize(child.node.evidence_weight);

      rfNodes.push({
        id: child.node.id,
        position: { x, y: 420 },
        data: {
          label: `${child.node.text}\n${(child.node.probability * 100).toFixed(1)}%`,
        },
        style: {
          background: isEvidence ? c.evidence : probabilityColor(child.node.probability, dark),
          color: c.nodeText,
          border: isEvidence ? `2px dashed ${c.evidenceBorder}` : `1px solid ${c.nodeBorder}`,
          borderRadius: isEvidence ? 16 : 8,
          padding: "6px 10px",
          fontSize: 11,
          width: Math.max(w * 2.5, 150),
          textAlign: "center" as const,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });

      rfEdges.push({
        id: child.edge.id,
        source: centerNode.id,
        target: child.node.id,
        animated: false,
        style: {
          stroke: contributionEdgeColor(
            child.node.log_odds_posterior,
            child.edge.log_lr_positive,
            child.edge.log_lr_negative,
            dark
          ),
          strokeWidth: 2,
        },
        label: `w=${child.edge.relevance_weight.toFixed(2)}`,
        labelStyle: { fontSize: 10, fill: c.edgeLabel },
      });
    });

    // Parents above
    const parentCount = data.parents.length;
    data.parents.forEach((parent, i) => {
      if (seen.has(parent.node.id)) return;
      seen.add(parent.node.id);

      const spacing = 220;
      const totalWidth = (parentCount - 1) * spacing;
      const x = 300 - totalWidth / 2 + i * spacing;

      rfNodes.push({
        id: parent.node.id,
        position: { x, y: 0 },
        data: {
          label: `${parent.node.text}\n${(parent.node.probability * 100).toFixed(1)}%`,
        },
        style: {
          background: probabilityColor(parent.node.probability, dark),
          color: c.nodeText,
          border: `1px solid ${c.nodeBorder}`,
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          width: 180,
          textAlign: "center" as const,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });

      rfEdges.push({
        id: parent.edge.id,
        source: parent.node.id,
        target: centerNode.id,
        animated: false,
        style: {
          stroke: contributionEdgeColor(
            parent.node.log_odds_posterior,
            parent.edge.log_lr_positive,
            parent.edge.log_lr_negative,
            dark
          ),
          strokeWidth: 2,
        },
        label: `w=${parent.edge.relevance_weight.toFixed(2)}`,
        labelStyle: { fontSize: 10, fill: c.edgeLabel },
      });
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [data, dark, c]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.id === data.node.id) return;
      // Determine if evidence or claim
      const isEvidence = data.children.some(
        (c) => c.node.id === node.id && c.node.type === "EVIDENCE"
      );
      if (isEvidence) {
        router.push(`/evidence/${node.id}`);
      } else {
        router.push(`/claims/${node.id}`);
      }
    },
    [data, router]
  );

  return (
    <div className="h-[500px] w-full rounded-lg border border-border overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        colorMode={dark ? "dark" : "light"}
        nodesDraggable
        nodesConnectable={false}
      >
        <Background color={c.bgDots} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
