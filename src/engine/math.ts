export interface RobustFeatureStats {
  median: number;
  iqr: number;
  scaledIqr: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sortedAsc.length) {
    return sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base]);
  }
  return sortedAsc[base];
}

export function computeRobustStats(
  values: number[],
  minScaleFloor = 1e-4
): RobustFeatureStats {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    return { median: 0, iqr: 0, scaledIqr: Math.max(1e-4, minScaleFloor) };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const med = quantile(sorted, 0.5);
  const q25 = quantile(sorted, 0.25);
  const q75 = quantile(sorted, 0.75);
  const iqr = Math.max(0, q75 - q25);
  const scaledIqr = Math.max(1e-4, minScaleFloor, 0.7413 * iqr);
  return { median: med, iqr, scaledIqr };
}

export interface WeightedFeatureResidual {
  weight: number;
  targetVal: number | null;
  candidateVal: number | null;
  stats: RobustFeatureStats;
  asymmetricLambda?: number;
  breachCondition?: boolean;
}

/**
 * Computes observed-subspace weighted squared distance d_k^2 and p_eff,k.
 * Null features on either target or candidate are cleanly masked out of O_k.
 */
export function computeObservedSubspaceDistance(
  features: WeightedFeatureResidual[]
): {
  distanceSq: number;
  pEff: number;
  observedDims: number;
} {
  let distanceSq = 0;
  let pEff = 0;
  let observedDims = 0;

  for (const f of features) {
    if (
      f.targetVal === null ||
      f.candidateVal === null ||
      !Number.isFinite(f.targetVal) ||
      !Number.isFinite(f.candidateVal)
    ) {
      continue;
    }
    const scale = Math.max(1e-4, f.stats.scaledIqr);
    const zTarget = (f.targetVal - f.stats.median) / scale;
    const zCand = (f.candidateVal - f.stats.median) / scale;
    let deltaZ = zCand - zTarget;

    if (f.breachCondition && f.asymmetricLambda && f.asymmetricLambda > 1) {
      const mag = Math.max(0.5, Math.abs(deltaZ));
      deltaZ = Math.sign(deltaZ || 1) * mag * f.asymmetricLambda;
    }

    distanceSq += f.weight * deltaZ * deltaZ;
    pEff += f.weight;
    observedDims += 1;
  }

  return {
    distanceSq,
    pEff: Math.max(1e-6, pEff),
    observedDims,
  };
}

/**
 * Heavy-tailed Student-t / Rational-Quadratic kernel (nu = 2.0):
 * S_k = 100 * (1 + d^2 / (nu * p_eff))^(-nu / 2)
 * For nu = 2.0, exponent is -1.0.
 */
export function studentTKernel(
  distanceSq: number,
  pEff: number,
  nu = 2.0
): number {
  const safeDist = Math.max(0, Number.isFinite(distanceSq) ? distanceSq : 0);
  const safePEff = Math.max(1e-6, Number.isFinite(pEff) ? pEff : 1e-6);
  const base = 1 + safeDist / (nu * safePEff);
  const score = 100 * Math.pow(base, -nu / 2);
  return Math.max(0, Math.min(100, score));
}

export function computeFrontierPct(score: number, maxScoreInCatalog: number): number {
  if (maxScoreInCatalog <= 1e-9) return 0;
  return Math.max(0, Math.min(100, (100 * score) / maxScoreInCatalog));
}

/**
 * Harmonic Versatility Index:
 * V(alpha_j) = K / sum_i (1 / max(M_{i,j}, 1e-3))
 */
export function computeHarmonicVersatility(scoresAcrossTargets: number[]): number {
  const k = scoresAcrossTargets.length;
  if (k === 0) return 0;
  let invSum = 0;
  for (const s of scoresAcrossTargets) {
    invSum += 1 / Math.max(s, 1e-3);
  }
  return k / invSum;
}

function rankArray(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) {
      j++;
    }
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export function computeSpearmanRho(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 1;
  const ra = rankArray(a);
  const rb = rankArray(b);
  const n = a.length;
  const meanA = ra.reduce((s, v) => s + v, 0) / n;
  const meanB = rb.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den < 1e-12) return 0;
  return Math.max(-1, Math.min(1, num / den));
}

/**
 * Mean Pairwise Rank Dissonance in [0, 1]:
 * D_rank = (1 / C(K, 2)) * sum_{a < b} (1 - rho_s(M_a, M_b)) / 2
 */
export function computeMeanPairwiseRankDissonance(
  scoreVectorsByTarget: number[][]
): number {
  const k = scoreVectorsByTarget.length;
  if (k < 2) return 0;
  let pairCount = 0;
  let sumDissonance = 0;
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const rho = computeSpearmanRho(scoreVectorsByTarget[a], scoreVectorsByTarget[b]);
      sumDissonance += (1 - rho) / 2;
      pairCount += 1;
    }
  }
  return pairCount > 0 ? sumDissonance / pairCount : 0;
}
