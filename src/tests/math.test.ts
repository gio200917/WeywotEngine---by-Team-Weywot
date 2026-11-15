import { describe, expect, it } from 'vitest';
import {
  computeFrontierPct,
  computeHarmonicVersatility,
  computeMeanPairwiseRankDissonance,
  computeObservedSubspaceDistance,
  computeRobustStats,
  studentTKernel,
} from '../engine/math.js';

describe('math.ts — Scale-Normalized Diagonal SPD & Student-t Kernel', () => {
  it('never emits NaN across extreme residuals or degenerate scales', () => {
    const stats = computeRobustStats([10, 10, 10, 10]); // zero IQR
    const d = computeObservedSubspaceDistance([
      { weight: 1.0, targetVal: 10, candidateVal: 1e6, stats },
    ]);
    const score = studentTKernel(d.distanceSq, d.pEff, 2.0);
    expect(Number.isNaN(score)).toBe(false);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Student-t (nu=2.0) preserves positive monotonic discrimination at 10 sigma vs 20 sigma', () => {
    const stats = computeRobustStats([0, 1, 2, 3, 4]);
    const d10 = computeObservedSubspaceDistance([
      { weight: 1.0, targetVal: 0, candidateVal: 10 * stats.scaledIqr, stats },
    ]);
    const d20 = computeObservedSubspaceDistance([
      { weight: 1.0, targetVal: 0, candidateVal: 20 * stats.scaledIqr, stats },
    ]);
    const s10 = studentTKernel(d10.distanceSq, d10.pEff, 2.0);
    const s20 = studentTKernel(d20.distanceSq, d20.pEff, 2.0);

    expect(s10).toBeGreaterThan(0.5);
    expect(s20).toBeGreaterThan(0.1);
    expect(s10).toBeGreaterThan(s20);
  });

  it('Harmonic Versatility penalizes asymmetric collapse (1% / 1.1% near 1%, 100% / 1% near 2%)', () => {
    const nearOne = computeHarmonicVersatility([1.0, 1.1]);
    expect(nearOne).toBeGreaterThan(1.0);
    expect(nearOne).toBeLessThan(1.1);

    const collapsed = computeHarmonicVersatility([100.0, 1.0]);
    expect(collapsed).toBeLessThan(2.5);
  });

  it('observed-subspace masking ignores null features cleanly', () => {
    const stats = computeRobustStats([1, 2, 3, 4, 5]);
    const base = computeObservedSubspaceDistance([
      { weight: 1.5, targetVal: 2, candidateVal: 3, stats },
    ]);
    const withNulls = computeObservedSubspaceDistance([
      { weight: 1.5, targetVal: 2, candidateVal: 3, stats },
      { weight: 2.0, targetVal: null, candidateVal: 4, stats },
      { weight: 2.0, targetVal: 4, candidateVal: null, stats },
    ]);

    expect(withNulls.distanceSq).toBeCloseTo(base.distanceSq, 10);
    expect(withNulls.pEff).toBeCloseTo(base.pEff, 10);
    expect(withNulls.observedDims).toBe(1);
  });

  it('computes Earth Achievable Frontier % and Mean Pairwise Rank Dissonance correctly', () => {
    expect(computeFrontierPct(40, 80)).toBeCloseTo(50, 5);
    expect(computeFrontierPct(80, 80)).toBeCloseTo(100, 5);

    const identical = computeMeanPairwiseRankDissonance([
      [90, 70, 50, 30],
      [85, 65, 45, 25],
    ]);
    expect(identical).toBeCloseTo(0, 5);

    const reversed = computeMeanPairwiseRankDissonance([
      [90, 70, 50, 30],
      [10, 30, 50, 70],
    ]);
    expect(reversed).toBeCloseTo(1, 5);
  });
});
