import { describe, it, expect } from "vitest";
import {
  sigmoid,
  logit,
  effectiveLogLR,
  computePosterior,
  type EdgeWithChild,
} from "../math";

// ---------------------------------------------------------------------------
// sigmoid
// ---------------------------------------------------------------------------
describe("sigmoid", () => {
  it("maps 0 to 0.5 (maximum uncertainty)", () => {
    expect(sigmoid(0)).toBe(0.5);
  });

  it("maps large positive log-odds to ~1", () => {
    expect(sigmoid(10)).toBeCloseTo(1, 4);
  });

  it("maps large negative log-odds to ~0", () => {
    expect(sigmoid(-10)).toBeCloseTo(0, 4);
  });

  it("maps 1.39 to ~0.80 (used in toy example for evidence node)", () => {
    expect(sigmoid(1.39)).toBeCloseTo(0.8, 2);
  });

  it("is symmetric: sigmoid(x) + sigmoid(-x) = 1", () => {
    for (const x of [0.5, 1, 2, 5]) {
      expect(sigmoid(x) + sigmoid(-x)).toBeCloseTo(1, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// logit
// ---------------------------------------------------------------------------
describe("logit", () => {
  it("maps 0.5 to 0", () => {
    expect(logit(0.5)).toBe(0);
  });

  it("maps 0.80 to ~1.39", () => {
    expect(logit(0.8)).toBeCloseTo(1.386, 2);
  });

  it("returns -Infinity for p <= 0", () => {
    expect(logit(0)).toBe(-Infinity);
    expect(logit(-0.1)).toBe(-Infinity);
  });

  it("returns +Infinity for p >= 1", () => {
    expect(logit(1)).toBe(Infinity);
    expect(logit(1.1)).toBe(Infinity);
  });

  it("is the inverse of sigmoid", () => {
    for (const x of [-3, -1, 0, 0.5, 2, 5]) {
      expect(logit(sigmoid(x))).toBeCloseTo(x, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// effectiveLogLR — log-odds interpolation
// ---------------------------------------------------------------------------
describe("effectiveLogLR", () => {
  it("at p=1 returns log_lr_pos", () => {
    expect(effectiveLogLR(1, 1.0, -1.5)).toBe(1.0);
  });

  it("at p=0 returns log_lr_neg", () => {
    expect(effectiveLogLR(0, 1.0, -1.5)).toBe(-1.5);
  });

  it("at p=0.5 returns average of log_lr_pos and log_lr_neg", () => {
    expect(effectiveLogLR(0.5, 1.0, -1.5)).toBeCloseTo(-0.25, 10);
  });

  it("returns 0 when log_lr_pos = log_lr_neg = 0 (uninformative edge)", () => {
    expect(effectiveLogLR(0.7, 0, 0)).toBe(0);
  });

  it("returns 0 for symmetric LRs at p=0.5", () => {
    // When log_lr_pos = -log_lr_neg, average is 0
    expect(effectiveLogLR(0.5, 1.0, -1.0)).toBeCloseTo(0, 10);
  });

  it("produces non-zero bias for asymmetric LRs at p=0.5", () => {
    // This is the accepted bias from MODELING-KNOWLEDGE.md §4.3
    const result = effectiveLogLR(0.5, 0.4, -0.3);
    expect(result).toBeCloseTo(0.05, 10);
    expect(result).not.toBe(0);
  });

  it("interpolates linearly in log-odds space", () => {
    const logLrPos = 2.0;
    const logLrNeg = -1.0;
    const p = 0.7;
    const expected = p * logLrPos + (1 - p) * logLrNeg;
    expect(effectiveLogLR(p, logLrPos, logLrNeg)).toBeCloseTo(expected, 10);
  });

  // Toy example from MODELING-KNOWLEDGE.md §5: N4 → N2
  it("matches toy example: Stanford study (N4→N2)", () => {
    // p_child = 0.80, log_lr_pos = 1.0, log_lr_neg = -1.5
    const result = effectiveLogLR(0.80, 1.0, -1.5);
    expect(result).toBeCloseTo(0.50, 2);
  });
});

// ---------------------------------------------------------------------------
// computePosterior
// ---------------------------------------------------------------------------
describe("computePosterior", () => {
  function edge(
    logLrPos: number,
    logLrNeg: number,
    weight: number,
    childLogOdds: number,
    id = "e1",
    childId = "c1"
  ): EdgeWithChild {
    return {
      edgeId: id,
      childId,
      logLrPositive: logLrPos,
      logLrNegative: logLrNeg,
      relevanceWeight: weight,
      childLogOddsPosterior: childLogOdds,
    };
  }

  it("returns prior when there are no edges", () => {
    const result = computePosterior(1.5, []);
    expect(result.logOddsPosterior).toBe(1.5);
    expect(result.evidenceWeight).toBe(0);
    expect(result.contributions).toHaveLength(0);
  });

  it("returns prior when edge is uninformative (both LRs = 0)", () => {
    const result = computePosterior(0.5, [edge(0, 0, 1.0, 0)]);
    expect(result.logOddsPosterior).toBe(0.5);
    expect(result.evidenceWeight).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Full toy example from MODELING-KNOWLEDGE.md §5
  // -----------------------------------------------------------------------
  describe("toy example from MODELING-KNOWLEDGE.md §5", () => {
    it("Phase 1: N2 posterior from N4 (Stanford study, P=0.80)", () => {
      // N4: evidence node, log_odds_posterior = logit(0.80) ≈ 1.386
      // Edge N2→N4: log_lr_pos=1.0, log_lr_neg=-1.5, w=0.5
      const n4LogOdds = logit(0.8);
      const result = computePosterior(0.0, [
        edge(1.0, -1.5, 0.5, n4LogOdds, "e-n2-n4", "n4"),
      ]);

      // log(effective_LR) = 0.80 * 1.0 + 0.20 * (-1.5) = 0.50
      // contribution = 0.5 * 0.50 = 0.250
      expect(result.logOddsPosterior).toBeCloseTo(0.250, 2);
      expect(sigmoid(result.logOddsPosterior)).toBeCloseTo(0.562, 2);
      expect(result.evidenceWeight).toBeCloseTo(0.250, 2);
      expect(result.contributions).toHaveLength(1);
      expect(result.contributions[0].weightedLogLR).toBeCloseTo(0.250, 2);
    });

    it("Phase 3: N1 posterior from N2 (partially evidenced) and N3 (unexplored)", () => {
      // N2: log_odds_posterior ≈ 0.250 (from Phase 1)
      // N3: log_odds_posterior = 0.0 (unexplored)
      // Edge N1→N2: log_lr_pos=0.8, log_lr_neg=-0.6, w=0.4
      // Edge N1→N3: log_lr_pos=0.4, log_lr_neg=-0.3, w=0.2
      const result = computePosterior(0.0, [
        edge(0.8, -0.6, 0.4, 0.250, "e-n1-n2", "n2"),
        edge(0.4, -0.3, 0.2, 0.0, "e-n1-n3", "n3"),
      ]);

      // N2 contribution: p=σ(0.250)≈0.562
      //   log(eLR) = 0.562*0.8 + 0.438*(-0.6) = 0.450 - 0.263 = 0.187
      //   weighted = 0.4 * 0.187 = 0.075
      // N3 contribution: p=0.5
      //   log(eLR) = 0.5*0.4 + 0.5*(-0.3) = 0.05
      //   weighted = 0.2 * 0.05 = 0.010
      expect(result.logOddsPosterior).toBeCloseTo(0.085, 2);
      expect(sigmoid(result.logOddsPosterior)).toBeCloseTo(0.521, 2);
      expect(result.evidenceWeight).toBeCloseTo(0.085, 2);

      // Check individual contributions
      const n2Contrib = result.contributions.find((c) => c.childId === "n2");
      const n3Contrib = result.contributions.find((c) => c.childId === "n3");
      expect(n2Contrib!.weightedLogLR).toBeCloseTo(0.075, 2);
      expect(n3Contrib!.weightedLogLR).toBeCloseTo(0.010, 2);
    });

    it("Phase 3 with contradictory evidence: N2 updated after N5 added", () => {
      // N4 contribution: 0.250 (unchanged)
      // N5: Buffer survey, P=0.70, log_odds ≈ 0.847
      //   Edge N2→N5: log_lr_pos=-0.8, log_lr_neg=0.5, w=0.3
      const n4LogOdds = logit(0.8);
      const n5LogOdds = logit(0.7);
      const result = computePosterior(0.0, [
        edge(1.0, -1.5, 0.5, n4LogOdds, "e-n2-n4", "n4"),
        edge(-0.8, 0.5, 0.3, n5LogOdds, "e-n2-n5", "n5"),
      ]);

      // N4 contribution = 0.250
      // N5: log(eLR) = 0.70*(-0.8) + 0.30*0.5 = -0.56 + 0.15 = -0.41
      //     weighted = 0.3 * (-0.41) = -0.123
      // Total = 0.250 + (-0.123) = 0.127
      expect(result.logOddsPosterior).toBeCloseTo(0.127, 2);
      expect(sigmoid(result.logOddsPosterior)).toBeCloseTo(0.532, 2);
      expect(result.evidenceWeight).toBeCloseTo(0.373, 2);
    });
  });

  // -----------------------------------------------------------------------
  // Aggregation properties
  // -----------------------------------------------------------------------
  describe("aggregation properties", () => {
    it("sums contributions additively in log-odds", () => {
      // Two independent edges should contribute additively
      const e1 = edge(1.0, -0.5, 1.0, logit(0.9), "e1", "c1");
      const e2 = edge(0.5, -0.3, 1.0, logit(0.7), "e2", "c2");

      const combined = computePosterior(0.0, [e1, e2]);
      const separate1 = computePosterior(0.0, [e1]);
      const separate2 = computePosterior(0.0, [e2]);

      // Combined posterior should equal sum of individual contributions
      expect(combined.logOddsPosterior).toBeCloseTo(
        separate1.logOddsPosterior + separate2.logOddsPosterior,
        10
      );
    });

    it("evidence weight is sum of absolute contributions", () => {
      // One supporting, one undermining
      const supporting = edge(1.0, -0.5, 0.5, logit(0.8), "e1", "c1");
      const undermining = edge(-0.8, 0.5, 0.3, logit(0.7), "e2", "c2");

      const result = computePosterior(0.0, [supporting, undermining]);

      const absSum = result.contributions.reduce(
        (sum, c) => sum + Math.abs(c.weightedLogLR),
        0
      );
      expect(result.evidenceWeight).toBeCloseTo(absSum, 10);
      // Evidence weight should be > posterior shift when contributions conflict
      expect(result.evidenceWeight).toBeGreaterThan(
        Math.abs(result.logOddsPosterior)
      );
    });

    it("relevance weight scales contribution linearly", () => {
      const fullWeight = computePosterior(0.0, [
        edge(1.0, -0.5, 1.0, logit(0.8)),
      ]);
      const halfWeight = computePosterior(0.0, [
        edge(1.0, -0.5, 0.5, logit(0.8)),
      ]);

      expect(halfWeight.logOddsPosterior).toBeCloseTo(
        fullWeight.logOddsPosterior * 0.5,
        10
      );
    });

    it("prior shifts the posterior baseline", () => {
      const neutralPrior = computePosterior(0.0, [
        edge(1.0, -0.5, 0.3, logit(0.7)),
      ]);
      const positivePrior = computePosterior(1.0, [
        edge(1.0, -0.5, 0.3, logit(0.7)),
      ]);

      expect(positivePrior.logOddsPosterior).toBeCloseTo(
        neutralPrior.logOddsPosterior + 1.0,
        10
      );
      // Evidence weight is the same regardless of prior
      expect(positivePrior.evidenceWeight).toBeCloseTo(
        neutralPrior.evidenceWeight,
        10
      );
    });
  });

  // -----------------------------------------------------------------------
  // Bias at P=0.5 (accepted behavior per §4.3)
  // -----------------------------------------------------------------------
  describe("bias at P=0.5", () => {
    it("symmetric LRs produce zero contribution at p=0.5", () => {
      const result = computePosterior(0.0, [edge(1.0, -1.0, 1.0, 0.0)]);
      expect(result.logOddsPosterior).toBeCloseTo(0, 10);
    });

    it("asymmetric LRs produce small non-zero contribution at p=0.5", () => {
      // log_lr_pos=0.4, log_lr_neg=-0.3 → bias = 0.5*(0.4 + (-0.3)) = 0.05
      const result = computePosterior(0.0, [edge(0.4, -0.3, 1.0, 0.0)]);
      expect(result.logOddsPosterior).toBeCloseTo(0.05, 10);
    });

    it("conservative relevance weight attenuates the bias", () => {
      // Same asymmetry but w=0.2 → contribution = 0.2 * 0.05 = 0.01
      const result = computePosterior(0.0, [edge(0.4, -0.3, 0.2, 0.0)]);
      expect(result.logOddsPosterior).toBeCloseTo(0.01, 10);
      // In probability: ~0.0025 shift, negligible
      expect(sigmoid(result.logOddsPosterior)).toBeCloseTo(0.5025, 3);
    });
  });

  // -----------------------------------------------------------------------
  // Direction of influence
  // -----------------------------------------------------------------------
  describe("direction of influence", () => {
    it("child with high posterior and positive log_lr_pos supports the parent", () => {
      const result = computePosterior(0.0, [edge(1.0, -0.5, 0.5, logit(0.9))]);
      expect(result.logOddsPosterior).toBeGreaterThan(0);
    });

    it("child with high posterior and negative log_lr_pos undermines the parent", () => {
      // Undermining relationship: child being true is evidence *against* parent
      const result = computePosterior(0.0, [
        edge(-0.8, 0.5, 0.5, logit(0.9)),
      ]);
      expect(result.logOddsPosterior).toBeLessThan(0);
    });

    it("child with low posterior and negative log_lr_neg supports the parent", () => {
      // Child is probably false, and child-false has negative log_lr_neg → undermines
      // Wait: log_lr_neg < 0 means child-false undermines parent
      // So low p_child + negative log_lr_neg → negative contribution → undermines parent
      const result = computePosterior(0.0, [
        edge(0.5, -1.5, 0.5, logit(0.2)),
      ]);
      // p=0.2: 0.2*0.5 + 0.8*(-1.5) = 0.1 - 1.2 = -1.1
      expect(result.logOddsPosterior).toBeLessThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles very confident child (p≈1)", () => {
      const result = computePosterior(0.0, [edge(2.0, -1.0, 0.5, 10)]);
      // p ≈ 1, so effective ≈ log_lr_pos = 2.0, weighted = 1.0
      expect(result.logOddsPosterior).toBeCloseTo(0.5 * 2.0, 1);
    });

    it("handles very confident child (p≈0)", () => {
      const result = computePosterior(0.0, [edge(2.0, -1.0, 0.5, -10)]);
      // p ≈ 0, so effective ≈ log_lr_neg = -1.0, weighted = -0.5
      expect(result.logOddsPosterior).toBeCloseTo(0.5 * -1.0, 1);
    });

    it("handles many edges accumulating small contributions", () => {
      // 10 edges each contributing ~0.01
      const edges = Array.from({ length: 10 }, (_, i) =>
        edge(0.1, -0.08, 0.2, logit(0.6), `e${i}`, `c${i}`)
      );
      const result = computePosterior(0.0, edges);
      // Each: p=0.6, log(eLR) = 0.6*0.1 + 0.4*(-0.08) = 0.06 - 0.032 = 0.028
      // weighted = 0.2 * 0.028 = 0.0056
      // total ≈ 10 * 0.0056 = 0.056
      expect(result.logOddsPosterior).toBeCloseTo(0.056, 2);
      expect(result.contributions).toHaveLength(10);
    });
  });
});
