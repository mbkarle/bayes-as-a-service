import { describe, it, expect, beforeEach, vi } from "vitest";
import { propagate } from "../propagation";
import { sigmoid, logit } from "../math";

// ---------------------------------------------------------------------------
// In-memory Supabase mock
// ---------------------------------------------------------------------------

interface MockNode {
  id: string;
  log_odds_prior: number;
  log_odds_posterior: number;
  evidence_weight: number;
  convergence_status: string;
}

interface MockEdge {
  id: string;
  parent_id: string;
  child_id: string;
  log_lr_positive: number;
  log_lr_negative: number;
  relevance_weight: number;
}

interface MockUpdateLog {
  node_id: string;
  trigger_edge_id: string | null;
  log_odds_before: number;
  log_odds_after: number;
  evidence_weight_before: number;
  evidence_weight_after: number;
  source: string;
}

function createMockSupabase(nodes: MockNode[], edges: MockEdge[]) {
  const updateLogs: MockUpdateLog[] = [];

  function findNode(id: string) {
    return nodes.find((n) => n.id === id);
  }

  // Build a chainable query builder that resolves data based on accumulated filters
  function createQueryBuilder(table: string) {
    let filters: Record<string, { column: string; value: string }[]> = {};
    let selectColumns = "*";
    let insertData: Record<string, unknown> | null = null;
    let updateData: Record<string, unknown> | null = null;

    const builder: Record<string, unknown> = {};

    builder.select = (cols?: string) => {
      selectColumns = cols ?? "*";
      return builder;
    };

    builder.eq = (column: string, value: string) => {
      if (!filters.eq) filters.eq = [];
      filters.eq.push({ column, value });
      return builder;
    };

    builder.insert = (data: Record<string, unknown>) => {
      insertData = data;
      if (table === "update_log") {
        updateLogs.push(data as unknown as MockUpdateLog);
        return { error: null };
      }
      return builder;
    };

    builder.update = (data: Record<string, unknown>) => {
      updateData = data;
      return builder;
    };

    builder.single = () => {
      if (table === "nodes") {
        const idFilter = filters.eq?.find((f) => f.column === "id");
        if (idFilter) {
          const node = findNode(idFilter.value);
          if (!node) return { data: null, error: { message: "Not found" } };

          if (updateData) {
            Object.assign(node, updateData);
            return { data: node, error: null };
          }
          return { data: { ...node }, error: null };
        }
      }
      return { data: null, error: { message: "Not found" } };
    };

    // For non-.single() calls: return arrays
    builder.then = undefined; // not a promise

    // When the builder is used without .single(), resolve to array data
    // This happens for edges queries
    if (table === "edges") {
      const originalEq = builder.eq as (
        col: string,
        val: string
      ) => typeof builder;
      builder.eq = (column: string, value: string) => {
        if (!filters.eq) filters.eq = [];
        filters.eq.push({ column, value });

        // For edge queries, resolve immediately based on filters
        const parentFilter = filters.eq.find(
          (f) => f.column === "parent_id"
        );
        const childFilter = filters.eq.find((f) => f.column === "child_id");

        if (parentFilter && selectColumns.includes("nodes")) {
          // fetchChildEdges query
          const matchingEdges = edges.filter(
            (e) => e.parent_id === parentFilter.value
          );
          const data = matchingEdges.map((e) => {
            const childNode = findNode(e.child_id);
            return {
              id: e.id,
              child_id: e.child_id,
              log_lr_positive: e.log_lr_positive,
              log_lr_negative: e.log_lr_negative,
              relevance_weight: e.relevance_weight,
              nodes: {
                log_odds_posterior: childNode?.log_odds_posterior ?? 0,
              },
            };
          });
          // Override the builder to return resolved data
          Object.defineProperty(builder, "_resolved", {
            value: { data, error: null },
            writable: true,
          });
        } else if (childFilter) {
          // fetchParentIds query
          const matchingEdges = edges.filter(
            (e) => e.child_id === childFilter.value
          );
          const data = matchingEdges.map((e) => ({
            parent_id: e.parent_id,
          }));
          Object.defineProperty(builder, "_resolved", {
            value: { data, error: null },
            writable: true,
          });
        }

        return builder;
      };
    }

    if (table === "nodes" && !insertData) {
      const originalEq = builder.eq as (
        col: string,
        val: string
      ) => typeof builder;
      // For node update without .single()
      builder.eq = (column: string, value: string) => {
        if (!filters.eq) filters.eq = [];
        filters.eq.push({ column, value });

        if (updateData) {
          const idFilter = filters.eq.find((f) => f.column === "id");
          if (idFilter) {
            const node = findNode(idFilter.value);
            if (node) Object.assign(node, updateData);
          }
          Object.defineProperty(builder, "_resolved", {
            value: { error: null },
            writable: true,
          });
        }

        return builder;
      };
    }

    // Make it awaitable
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyBuilder = builder as any;
    anyBuilder[Symbol.toStringTag] = "Promise";
    anyBuilder.then = function (
      resolve: (val: unknown) => unknown,
      reject?: (err: unknown) => unknown
    ) {
      const resolved = anyBuilder._resolved;
      if (resolved) return Promise.resolve(resolved).then(resolve, reject);
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    };
    anyBuilder.catch = function (fn: (err: unknown) => unknown) {
      return anyBuilder.then((x: unknown) => x, fn);
    };

    return builder;
  }

  const supabase = {
    from: (table: string) => createQueryBuilder(table),
    _nodes: nodes,
    _edges: edges,
    _updateLogs: updateLogs,
  };

  return supabase as unknown as Parameters<typeof propagate>[0];
}

// ---------------------------------------------------------------------------
// Helper to build test graphs
// ---------------------------------------------------------------------------
function makeNode(
  id: string,
  prior: number,
  posterior?: number
): MockNode {
  return {
    id,
    log_odds_prior: prior,
    log_odds_posterior: posterior ?? prior,
    evidence_weight: 0,
    convergence_status: "INITIAL",
  };
}

function makeEdge(
  id: string,
  parentId: string,
  childId: string,
  logLrPos: number,
  logLrNeg: number,
  weight: number
): MockEdge {
  return {
    id,
    parent_id: parentId,
    child_id: childId,
    log_lr_positive: logLrPos,
    log_lr_negative: logLrNeg,
    relevance_weight: weight,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("propagation", () => {
  describe("single parent-child (DAG, no cycle)", () => {
    it("updates a parent when its evidence child has a non-default posterior", async () => {
      // Evidence node N4 at P=0.80, edge to claim N2
      const n4 = makeNode("n4", logit(0.8), logit(0.8));
      const n2 = makeNode("n2", 0);
      const e1 = makeEdge("e1", "n2", "n4", 1.0, -1.5, 0.5);

      const supabase = createMockSupabase([n2, n4], [e1]);
      const summary = await propagate(supabase, "n2", "e1");

      expect(summary.nodesVisited).toBe(1);
      expect(summary.nodesUpdated).toBe(1);
      expect(summary.unstableNodes).toHaveLength(0);

      // N2 should now be at ~0.250 log-odds (P ≈ 0.562)
      expect(n2.log_odds_posterior).toBeCloseTo(0.250, 2);
      expect(n2.convergence_status).toBe("STABLE");
    });

    it("does not propagate past a node with no parents", async () => {
      const child = makeNode("child", logit(0.9), logit(0.9));
      const root = makeNode("root", 0);
      const e = makeEdge("e1", "root", "child", 1.0, -0.5, 0.3);

      const supabase = createMockSupabase([root, child], [e]);
      const summary = await propagate(supabase, "root", "e1");

      // Only root visited (it's a root, no parents to propagate to)
      expect(summary.nodesVisited).toBe(1);
    });
  });

  describe("chain propagation (A → B → C)", () => {
    it("propagates through a two-level chain", async () => {
      // C (evidence, P=0.9) → B (claim) → A (root claim)
      const nodeC = makeNode("C", logit(0.9), logit(0.9));
      const nodeB = makeNode("B", 0);
      const nodeA = makeNode("A", 0);

      const eBC = makeEdge("eBC", "B", "C", 0.8, -0.5, 0.4);
      const eAB = makeEdge("eAB", "A", "B", 0.6, -0.4, 0.3);

      const supabase = createMockSupabase(
        [nodeA, nodeB, nodeC],
        [eBC, eAB]
      );

      // Propagate starting from B (e.g. edge eBC just added)
      const summary = await propagate(supabase, "B", "eBC");

      // B should be updated, then A should be updated
      expect(summary.nodesVisited).toBeGreaterThanOrEqual(2);

      // B gets contribution from C
      // C: p=0.9, logLR = 0.9*0.8 + 0.1*(-0.5) = 0.72 - 0.05 = 0.67
      // weighted = 0.4 * 0.67 = 0.268
      expect(nodeB.log_odds_posterior).toBeCloseTo(0.268, 2);

      // A gets contribution from updated B
      // B: p=σ(0.268)≈0.567, logLR = 0.567*0.6 + 0.433*(-0.4) = 0.340 - 0.173 = 0.167
      // weighted = 0.3 * 0.167 = 0.050
      expect(nodeA.log_odds_posterior).toBeCloseTo(0.050, 2);

      expect(nodeA.convergence_status).toBe("STABLE");
      expect(nodeB.convergence_status).toBe("STABLE");
    });
  });

  describe("multiple children", () => {
    it("aggregates contributions from multiple children", async () => {
      // Two evidence nodes feeding into one claim
      const ev1 = makeNode("ev1", logit(0.8), logit(0.8));
      const ev2 = makeNode("ev2", logit(0.7), logit(0.7));
      const claim = makeNode("claim", 0);

      const e1 = makeEdge("e1", "claim", "ev1", 0.9, -0.5, 0.4);
      const e2 = makeEdge("e2", "claim", "ev2", 0.6, -0.3, 0.3);

      const supabase = createMockSupabase([claim, ev1, ev2], [e1, e2]);
      const summary = await propagate(supabase, "claim");

      // ev1: p=0.8, logLR = 0.8*0.9 + 0.2*(-0.5) = 0.72-0.10 = 0.62, w=0.4 → 0.248
      // ev2: p=0.7, logLR = 0.7*0.6 + 0.3*(-0.3) = 0.42-0.09 = 0.33, w=0.3 → 0.099
      // total = 0.248 + 0.099 = 0.347
      expect(claim.log_odds_posterior).toBeCloseTo(0.347, 2);
      expect(claim.evidence_weight).toBeCloseTo(0.347, 2);
    });
  });

  describe("convergence and delta threshold", () => {
    it("does not propagate when the update is below the convergence threshold", async () => {
      // A child with posterior barely above 0.5, symmetric LRs, tiny weight
      // This should produce a near-zero delta that stops propagation
      const child = makeNode("child", 0.001, 0.001); // barely off 0.5
      const parent = makeNode("parent", 0);
      const grandparent = makeNode("gp", 0);

      // Edge with symmetric LRs and low weight → tiny contribution
      const e1 = makeEdge("e1", "parent", "child", 0.01, -0.01, 0.1);
      const e2 = makeEdge("e2", "gp", "parent", 0.5, -0.3, 0.2);

      const supabase = createMockSupabase(
        [child, parent, grandparent],
        [e1, e2]
      );
      const summary = await propagate(supabase, "parent");

      // Parent update is tiny (child barely off 0.5, small LRs, low weight)
      // p ≈ 0.50025, logLR ≈ 0.50025*0.01 + 0.49975*(-0.01) ≈ 0.000005
      // weighted ≈ 0.0000005 — well below 0.001 threshold
      // So grandparent should NOT be visited
      expect(summary.nodesVisited).toBe(1);
    });
  });

  describe("toy example end-to-end", () => {
    it("reproduces MODELING-KNOWLEDGE.md §5 through propagation", async () => {
      // Full graph: N4 → N2 → N1 ← N3
      const n4 = makeNode("n4", logit(0.8), logit(0.8)); // evidence
      const n3 = makeNode("n3", 0, 0); // unexplored claim
      const n2 = makeNode("n2", 0, 0);
      const n1 = makeNode("n1", 0, 0);

      const eN2N4 = makeEdge("eN2N4", "n2", "n4", 1.0, -1.5, 0.5);
      const eN1N2 = makeEdge("eN1N2", "n1", "n2", 0.8, -0.6, 0.4);
      const eN1N3 = makeEdge("eN1N3", "n1", "n3", 0.4, -0.3, 0.2);

      const supabase = createMockSupabase(
        [n1, n2, n3, n4],
        [eN2N4, eN1N2, eN1N3]
      );

      // Propagate from N2 (as if edge eN2N4 was just added)
      const summary = await propagate(supabase, "n2", "eN2N4");

      // N2: 0.250 log-odds, P ≈ 0.562
      expect(n2.log_odds_posterior).toBeCloseTo(0.250, 2);

      // N1: 0.085 log-odds, P ≈ 0.521
      expect(n1.log_odds_posterior).toBeCloseTo(0.085, 2);

      // N3 should be untouched (it's a child, not a parent of anything that changed)
      expect(n3.log_odds_posterior).toBe(0);

      // Both N2 and N1 should be stable
      expect(n2.convergence_status).toBe("STABLE");
      expect(n1.convergence_status).toBe("STABLE");
    });
  });

  describe("cycle handling", () => {
    it("converges on a simple two-node cycle with weak coupling", async () => {
      // A ↔ B with low relevance weights — should converge
      const nodeA = makeNode("A", 0.5, 0.5); // slight initial lean
      const nodeB = makeNode("B", 0, 0);

      // A → B: B is a child of A
      // B → A: A is a child of B
      const eAB = makeEdge("eAB", "A", "B", 0.3, -0.2, 0.15);
      const eBA = makeEdge("eBA", "B", "A", 0.2, -0.1, 0.1);

      const supabase = createMockSupabase([nodeA, nodeB], [eAB, eBA]);
      const summary = await propagate(supabase, "A");

      // With weak coupling (weights 0.15 and 0.1), should converge
      expect(summary.unstableNodes).toHaveLength(0);
      // Both should be STABLE
      expect(nodeA.convergence_status).toBe("STABLE");
      expect(nodeB.convergence_status).toBe("STABLE");
    });
  });

  describe("audit log", () => {
    it("writes update_log entries for each node update", async () => {
      const child = makeNode("child", logit(0.8), logit(0.8));
      const parent = makeNode("parent", 0);
      const e = makeEdge("e1", "parent", "child", 1.0, -0.5, 0.3);

      const supabase = createMockSupabase([parent, child], [e]);
      await propagate(supabase, "parent", "e1");

      const logs = (supabase as unknown as { _updateLogs: MockUpdateLog[] })
        ._updateLogs;
      expect(logs.length).toBeGreaterThanOrEqual(1);

      const parentLog = logs.find((l) => l.node_id === "parent");
      expect(parentLog).toBeDefined();
      expect(parentLog!.trigger_edge_id).toBe("e1");
      expect(parentLog!.log_odds_before).toBe(0);
      expect(parentLog!.log_odds_after).not.toBe(0);
      expect(parentLog!.source).toBe("PROPAGATION");
    });
  });
});
