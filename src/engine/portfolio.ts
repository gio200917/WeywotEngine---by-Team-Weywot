import type {
  CandidateEvaluation,
  CelestialTarget,
  CrossTargetMatrix,
  CrossTargetMatrixRow,
  DomainKey,
  DomainWeights,
  EarthAnalogSite,
  MissionPresetId,
  MultiTargetAssignment,
  MultiTargetTwoSitePortfolioResult,
  TargetEvaluationDossier,
  TwoSitePortfolioResult,
} from '../types/planetary.js';
import {
  computeHarmonicVersatility,
  computeMeanPairwiseRankDissonance,
} from './math.js';

const DOMAIN_KEYS: DomainKey[] = [
  'geochemistry',
  'morphology',
  'thermal',
  'atmospheric',
  'operations',
];

function computeSplitSiteScore(
  cand: CandidateEvaluation,
  weights: DomainWeights,
  isVacuumRegime: boolean,
  isAstrobiologyPreset: boolean
): number {
  let wSum = 0;
  let weightedDomainScore = 0;
  for (const k of DOMAIN_KEYS) {
    if (k === 'atmospheric' && (isVacuumRegime || cand.domainScores.atmospheric.observedDims === 0)) {
      continue;
    }
    const w = Math.max(0, weights[k]);
    wSum += w;
    weightedDomainScore += w * cand.domainScores[k].scorePct;
  }
  if (wSum <= 1e-9) return 0;
  const domainComposite = weightedDomainScore / wSum;

  // Apply temporal drift & rain cliff scaled to operational/morphological share
  const opsMorphShare = Math.min(
    1,
    (weights.operations + 0.5 * weights.morphology) / wSum
  );
  const adjustedLayerA = Math.max(
    0,
    domainComposite -
      cand.downsideDriftPenalty * opsMorphShare -
      cand.rainCliffPenalty * opsMorphShare
  );

  if (cand.voidEval.active) {
    return Math.max(
      0,
      Math.min(
        100,
        0.50 * adjustedLayerA +
          0.40 * cand.voidEval.scorePct +
          0.10 * cand.processEval.similarityPct
      )
    );
  }
  if (cand.isruEval.active) {
    return Math.max(
      0,
      Math.min(
        100,
        0.60 * adjustedLayerA +
          0.30 * cand.isruEval.scorePct +
          0.10 * cand.processEval.similarityPct
      )
    );
  }
  if (isAstrobiologyPreset && cand.astrobiologyEval.mode !== 'ignore') {
    return Math.max(
      0,
      Math.min(
        100,
        0.65 * adjustedLayerA +
          0.25 * cand.astrobiologyEval.scorePct +
          0.10 * cand.processEval.similarityPct
      )
    );
  }
  if (cand.astrobiologyEval.mode !== 'ignore') {
    return Math.max(
      0,
      Math.min(
        100,
        0.80 * adjustedLayerA +
          0.10 * cand.astrobiologyEval.scorePct +
          0.10 * cand.processEval.similarityPct
      )
    );
  }
  return Math.max(
    0,
    Math.min(100, 0.86 * adjustedLayerA + 0.14 * cand.processEval.similarityPct)
  );
}

/**
 * Solves non-negative 2-site split optimization:
 *   max_{(alpha_A, alpha_B), w_A + w_B = w_mu, w_A,w_B >= 0} min(S(tau, alpha_A | w_A), S(tau, alpha_B | w_B))
 */
export function optimizeTwoSitePortfolio(
  target: CelestialTarget,
  evaluations: CandidateEvaluation[],
  domainWeights: DomainWeights,
  triggeredAutomatically: boolean,
  presetId?: MissionPresetId
): TwoSitePortfolioResult | null {
  if (evaluations.length < 2) return null;

  const singleSiteMaxPct = evaluations[0].missionFitPct;

  // Build candidate pool: top 6 overall + top 2 specialists per domain
  const poolMap = new Map<string, CandidateEvaluation>();
  for (const c of evaluations.slice(0, 6)) {
    poolMap.set(c.site.id, c);
  }
  const isAstrobiologyPreset = (presetId ?? target.defaultPreset) === 'astrobiology';
  for (const k of DOMAIN_KEYS) {
    if (k === 'atmospheric' && target.isVacuumRegime) continue;
    const sortedByDomain = [...evaluations].sort(
      (a, b) => b.domainScores[k].scorePct - a.domainScores[k].scorePct
    );
    for (const c of sortedByDomain.slice(0, 2)) {
      poolMap.set(c.site.id, c);
    }
  }
  const pool = Array.from(poolMap.values());

  // Enumerate all 30 non-trivial binary partitions of the 5 domains (mask 1..30)
  let bestMinimax = -1;
  let bestPair: {
    candA: CandidateEvaluation;
    candB: CandidateEvaluation;
    wA: DomainWeights;
    wB: DomainWeights;
    sA: number;
    sB: number;
  } | null = null;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const candA = pool[i];
      const candB = pool[j];

      for (let mask = 1; mask < 31; mask++) {
        const wA: DomainWeights = {
          geochemistry: 0,
          morphology: 0,
          thermal: 0,
          atmospheric: 0,
          operations: 0,
        };
        const wB: DomainWeights = {
          geochemistry: 0,
          morphology: 0,
          thermal: 0,
          atmospheric: 0,
          operations: 0,
        };

        for (let b = 0; b < 5; b++) {
          const key = DOMAIN_KEYS[b];
          if (key === 'atmospheric' && target.isVacuumRegime) continue;
          if ((mask & (1 << b)) !== 0) {
            wA[key] = domainWeights[key];
          } else {
            wB[key] = domainWeights[key];
          }
        }

        const sumA = DOMAIN_KEYS.reduce((s, k) => s + wA[k], 0);
        const sumB = DOMAIN_KEYS.reduce((s, k) => s + wB[k], 0);
        if (sumA <= 1e-6 || sumB <= 1e-6) continue;

        const sA = computeSplitSiteScore(candA, wA, target.isVacuumRegime, isAstrobiologyPreset);
        const sB = computeSplitSiteScore(candB, wB, target.isVacuumRegime, isAstrobiologyPreset);
        const minimax = Math.min(sA, sB);

        if (minimax > bestMinimax) {
          bestMinimax = minimax;
          bestPair = { candA, candB, wA, wB, sA, sB };
        }
      }
    }
  }

  if (!bestPair) return null;

  // Ensure siteA is the primary operations/morphology anchor for consistent presentation
  let { candA, candB, wA, wB, sA, sB } = bestPair;
  if (wB.morphology + wB.operations > wA.morphology + wA.operations) {
    [candA, candB] = [candB, candA];
    [wA, wB] = [wB, wA];
    [sA, sB] = [sB, sA];
  }

  const allocatedDomainsA = DOMAIN_KEYS.filter((k) => wA[k] > 0);
  const allocatedDomainsB = DOMAIN_KEYS.filter((k) => wB[k] > 0);
  const gainPct = Math.round((bestMinimax - singleSiteMaxPct) * 10) / 10;

  return {
    triggeredAutomatically,
    singleSiteMaxPct: Math.round(singleSiteMaxPct * 10) / 10,
    combinedMinimaxPct: Math.round(bestMinimax * 10) / 10,
    gainPct,
    siteA: candA.site,
    siteB: candB.site,
    weightsA: wA,
    weightsB: wB,
    scoreAPct: Math.round(sA * 10) / 10,
    scoreBPct: Math.round(sB * 10) / 10,
    allocatedDomainsA,
    allocatedDomainsB,
    rationale: `${candA.site.name} covers [${allocatedDomainsA.join(', ')}] (${sA.toFixed(1)}%), while ${candB.site.name} covers [${allocatedDomainsB.join(', ')}] (${sB.toFixed(1)}%) for ${target.name} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}% minimax gain over single-site max).`,
  };
}

/**
 * Solves joint minimax 2-site campaign split across ALL selected planetary targets:
 *   max_{(A, B), A != B} min_{tau in SelectedTargets} max(S(tau, A), S(tau, B))
 * Enforces zero target averaging by maximizing worst-case coverage across all selected targets.
 */
export function optimizeMultiTargetTwoSitePortfolio(
  dossiers: TargetEvaluationDossier[]
): MultiTargetTwoSitePortfolioResult | null {
  if (dossiers.length < 2) return null;

  const scoreByTarget = new Map<string, Map<string, CandidateEvaluation>>();
  const siteCatalog = new Map<string, EarthAnalogSite>();

  for (const d of dossiers) {
    const m = new Map<string, CandidateEvaluation>();
    for (const c of d.rankedCandidates) {
      m.set(c.site.id, c);
      if (!siteCatalog.has(c.site.id)) {
        siteCatalog.set(c.site.id, c.site);
      }
    }
    scoreByTarget.set(d.target.id, m);
  }

  const commonSiteIds = Array.from(siteCatalog.keys()).filter((sid) =>
    dossiers.every((d) => scoreByTarget.get(d.target.id)?.has(sid))
  );
  if (commonSiteIds.length < 2) return null;

  // Baseline: best single site across all selected targets (minimax)
  let singleSiteMinimax = -1;
  for (const sid of commonSiteIds) {
    let minScore = Infinity;
    for (const d of dossiers) {
      const s = scoreByTarget.get(d.target.id)!.get(sid)!.missionFitPct;
      if (s < minScore) minScore = s;
    }
    if (minScore > singleSiteMinimax) {
      singleSiteMinimax = minScore;
    }
  }

  // Candidate pool: top 6 from each selected target + best portfolio sites
  const poolSet = new Set<string>();
  for (const d of dossiers) {
    for (const c of d.rankedCandidates.slice(0, 6)) {
      if (commonSiteIds.includes(c.site.id)) poolSet.add(c.site.id);
    }
    if (d.portfolio) {
      if (commonSiteIds.includes(d.portfolio.siteA.id)) poolSet.add(d.portfolio.siteA.id);
      if (commonSiteIds.includes(d.portfolio.siteB.id)) poolSet.add(d.portfolio.siteB.id);
    }
  }
  const pool = Array.from(poolSet);
  if (pool.length < 2) return null;

  let bestMinimax = -1;
  let bestMean = -1;
  let bestIdA = pool[0];
  let bestIdB = pool[1];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const idA = pool[i];
      const idB = pool[j];
      let minCover = Infinity;
      let sumCover = 0;
      for (const d of dossiers) {
        const m = scoreByTarget.get(d.target.id)!;
        const sA = m.get(idA)!.missionFitPct;
        const sB = m.get(idB)!.missionFitPct;
        const cover = Math.max(sA, sB);
        if (cover < minCover) minCover = cover;
        sumCover += cover;
      }
      const meanCover = sumCover / dossiers.length;
      if (
        minCover > bestMinimax + 1e-6 ||
        (Math.abs(minCover - bestMinimax) <= 1e-6 && meanCover > bestMean)
      ) {
        bestMinimax = minCover;
        bestMean = meanCover;
        bestIdA = idA;
        bestIdB = idB;
      }
    }
  }

  // Ensure Site A covers at least as many targets as Site B (consistent ordering)
  let countA = 0;
  let countB = 0;
  for (const d of dossiers) {
    const m = scoreByTarget.get(d.target.id)!;
    if (m.get(bestIdA)!.missionFitPct >= m.get(bestIdB)!.missionFitPct) {
      countA++;
    } else {
      countB++;
    }
  }
  if (countB > countA) {
    [bestIdA, bestIdB] = [bestIdB, bestIdA];
  }

  const siteA = siteCatalog.get(bestIdA)!;
  const siteB = siteCatalog.get(bestIdB)!;

  const assignments: MultiTargetAssignment[] = dossiers.map((d) => {
    const m = scoreByTarget.get(d.target.id)!;
    const sA = m.get(bestIdA)!.missionFitPct;
    const sB = m.get(bestIdB)!.missionFitPct;
    const useA = sA >= sB;
    return {
      targetId: d.target.id,
      targetName: d.target.name,
      body: d.target.body,
      assignedSite: useA ? 'A' : 'B',
      assignedSiteId: useA ? siteA.id : siteB.id,
      scorePct: Math.round((useA ? sA : sB) * 10) / 10,
      singleBestPct: Math.round((d.rankedCandidates[0]?.missionFitPct ?? 0) * 10) / 10,
    };
  });

  const gainPct = Math.round((bestMinimax - singleSiteMinimax) * 10) / 10;
  const namesA = assignments
    .filter((a) => a.assignedSite === 'A')
    .map((a) => a.targetName.split(' ').slice(0, 2).join(' '));
  const namesB = assignments
    .filter((a) => a.assignedSite === 'B')
    .map((a) => a.targetName.split(' ').slice(0, 2).join(' '));

  const rationale =
    namesB.length > 0
      ? `${siteA.name} leads [${namesA.join(', ')}], while ${siteB.name} leads [${namesB.join(', ')}] — lifting worst-case target coverage across all ${dossiers.length} selected targets to ${bestMinimax.toFixed(1)}% (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}% vs best single site ${singleSiteMinimax.toFixed(1)}%).`
      : `${siteA.name} leads all ${dossiers.length} selected targets (${bestMinimax.toFixed(1)}% minimax), with ${siteB.name} paired as secondary campaign backup.`;

  return {
    targetCount: dossiers.length,
    singleSiteMinimaxPct: Math.round(singleSiteMinimax * 10) / 10,
    combinedMinimaxPct: Math.round(bestMinimax * 10) / 10,
    gainPct,
    siteA,
    siteB,
    assignments,
    rationale,
  };
}

export function buildCrossTargetMatrix(
  dossiers: TargetEvaluationDossier[]
): CrossTargetMatrix {
  if (dossiers.length === 0) {
    return { targetIds: [], rows: [], meanPairwiseRankDissonance: 0 };
  }

  const targetIds = dossiers.map((d) => d.target.id);
  const siteMap = new Map<
    string,
    { siteName: string; region: string; scoresByTargetId: Record<string, number> }
  >();

  for (const dossier of dossiers) {
    for (const c of dossier.rankedCandidates) {
      let entry = siteMap.get(c.site.id);
      if (!entry) {
        entry = {
          siteName: c.site.name,
          region: c.site.region,
          scoresByTargetId: {},
        };
        siteMap.set(c.site.id, entry);
      }
      entry.scoresByTargetId[dossier.target.id] = c.missionFitPct;
    }
  }

  const rows: CrossTargetMatrixRow[] = [];
  for (const [siteId, entry] of siteMap.entries()) {
    const scores = targetIds.map((tid) => entry.scoresByTargetId[tid] ?? 0);
    rows.push({
      siteId,
      siteName: entry.siteName,
      region: entry.region,
      scoresByTargetId: entry.scoresByTargetId,
      harmonicVersatilityIndex:
        Math.round(computeHarmonicVersatility(scores) * 10) / 10,
    });
  }

  rows.sort((a, b) => b.harmonicVersatilityIndex - a.harmonicVersatilityIndex);

  const siteOrder = rows.map((r) => r.siteId);
  const scoreVectorsByTarget = targetIds.map((tid) =>
    siteOrder.map((sid) => siteMap.get(sid)?.scoresByTargetId[tid] ?? 0)
  );

  const meanPairwiseRankDissonance =
    Math.round(computeMeanPairwiseRankDissonance(scoreVectorsByTarget) * 1000) / 1000;

  return {
    targetIds,
    rows,
    meanPairwiseRankDissonance,
  };
}
