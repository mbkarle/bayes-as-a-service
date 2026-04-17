/**
 * Core mathematical utilities for the Bayesian argument graph.
 * See: MODELING-KNOWLEDGE.md §3.1, §4.3
 */

/** Convert log-odds to probability. P = 1 / (1 + e^(-l)) */
export function sigmoid(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds));
}

/** Convert probability to log-odds. l = log(p / (1 - p)) */
export function logit(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  return Math.log(p / (1 - p));
}

/**
 * Compute the effective log-likelihood ratio for a single edge,
 * interpolating between the positive and negative log-LRs in log-odds space.
 *
 * log(effective_LR) = p_child * log_lr_pos + (1 - p_child) * log_lr_neg
 *
 * See MODELING-KNOWLEDGE.md §3.1.
 */
export function effectiveLogLR(
  pChild: number,
  logLrPos: number,
  logLrNeg: number
): number {
  return pChild * logLrPos + (1 - pChild) * logLrNeg;
}

export interface EdgeContribution {
  edgeId: string;
  childId: string;
  weightedLogLR: number; // w * log(effective_LR)
}

export interface PosteriorResult {
  logOddsPosterior: number;
  evidenceWeight: number;
  contributions: EdgeContribution[];
}

export interface EdgeWithChild {
  edgeId: string;
  childId: string;
  logLrPositive: number;
  logLrNegative: number;
  relevanceWeight: number;
  childLogOddsPosterior: number;
}

/**
 * Compute the posterior for a single node given its prior and child edges.
 * Implements MODELING-KNOWLEDGE.md §3.1 Steps 1-4.
 */
export function computePosterior(
  logOddsPrior: number,
  edges: EdgeWithChild[]
): PosteriorResult {
  const contributions: EdgeContribution[] = [];
  let totalLogOdds = logOddsPrior;
  let evidenceWeight = 0;

  for (const edge of edges) {
    const pChild = sigmoid(edge.childLogOddsPosterior);
    const logELR = effectiveLogLR(pChild, edge.logLrPositive, edge.logLrNegative);
    const weighted = edge.relevanceWeight * logELR;

    contributions.push({
      edgeId: edge.edgeId,
      childId: edge.childId,
      weightedLogLR: weighted,
    });

    totalLogOdds += weighted;
    evidenceWeight += Math.abs(weighted);
  }

  return {
    logOddsPosterior: totalLogOdds,
    evidenceWeight,
    contributions,
  };
}
