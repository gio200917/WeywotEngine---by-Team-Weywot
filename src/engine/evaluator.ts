import type {
  CandidateEvaluation,
  CandidateNarrative,
  CelestialTarget,
  DomainKey,
  DomainScoreDetail,
  DomainWeights,
  EarthAnalogSite,
  EphemerisState,
  MissionConfig,
  MissionPresetId,
  MonthlyClimatologyBin,
  TargetEvaluationDossier,
  VoidType,
} from '../types/planetary.js';
import { computeDeficitsAndHardwareSpecs } from './deficits.js';
import {
  computeFrontierPct,
  computeObservedSubspaceDistance,
  computeRobustStats,
  studentTKernel,
  type RobustFeatureStats,
  type WeightedFeatureResidual,
} from './math.js';
import {
  computeEphemerisState,
  computeShaoLuThresholdFrictionVel,
  computeVisualAlienation,
  EARTH_GRAVITY_MS2,
} from './physics.js';
import { optimizeTwoSitePortfolio } from './portfolio.js';
import { optimizeCampaignWindow } from './temporal.js';
import {
  evaluateAstrobiologyModule,
  evaluateIsruModule,
  evaluateProcessAnalogy,
  evaluateVoidModule,
} from './voidAndIsru.js';

export const PRESET_DOMAIN_WEIGHTS: Record<MissionPresetId, DomainWeights> = {
  moon_base_isru: {
    geochemistry: 0.30,
    morphology: 0.24,
    thermal: 0.16,
    atmospheric: 0.04,
    operations: 0.26,
  },
  subsurface_void: {
    geochemistry: 0.20,
    morphology: 0.30,
    thermal: 0.15,
    atmospheric: 0.05,
    operations: 0.30,
  },
  astrobiology: {
    geochemistry: 0.42,
    morphology: 0.14,
    thermal: 0.14,
    atmospheric: 0.08,
    operations: 0.22,
  },
  rover_mobility: {
    geochemistry: 0.22,
    morphology: 0.26,
    thermal: 0.14,
    atmospheric: 0.12,
    operations: 0.26,
  },
  cryogenic_drill: {
    geochemistry: 0.22,
    morphology: 0.28,
    thermal: 0.24,
    atmospheric: 0.08,
    operations: 0.18,
  },
  custom: {
    geochemistry: 0.25,
    morphology: 0.25,
    thermal: 0.18,
    atmospheric: 0.12,
    operations: 0.20,
  },
};

export interface CatalogFeatureStats {
  maficIndex: RobustFeatureStats;
  silicaWtPctLn: RobustFeatureStats;
  tiO2WtPctLn: RobustFeatureStats;
  clayIndex: RobustFeatureStats;
  sulfateIndex: RobustFeatureStats;
  carbonateIndex: RobustFeatureStats;
  wehWtPctLn: RobustFeatureStats;

  medianSlopeDegLn: RobustFeatureStats;
  p95SlopeDegLn: RobustFeatureStats;
  rockCfaK: RobustFeatureStats;
  cohesionKpa: RobustFeatureStats;
  frictionAngleDeg: RobustFeatureStats;
  regolithThicknessMLn: RobustFeatureStats;
  iceTableDepthMLn: RobustFeatureStats;
  sarBackscatterDb: RobustFeatureStats;

  thermalInertiaLn: RobustFeatureStats;
  tMeanK: RobustFeatureStats;
  diurnalDeltaK: RobustFeatureStats;
  albedo: RobustFeatureStats;
  uvAbFluxLn: RobustFeatureStats;

  ambientDensityLn: RobustFeatureStats;
  grainDiameterLn: RobustFeatureStats;
  thresholdVelLn: RobustFeatureStats;

  roadDistanceLn: RobustFeatureStats;
  rfQuietness: RobustFeatureStats;
  visualAlienation: RobustFeatureStats;
  grazingSunHours: RobustFeatureStats;
  clearSkyFraction: RobustFeatureStats;
  logisticsFriction: RobustFeatureStats;
}

function safeLn(x: number, offset = 0): number {
  return Math.log(Math.max(1e-6, x + offset));
}

export function computeCatalogFeatureStats(
  sites: EarthAnalogSite[]
): CatalogFeatureStats {
  const collectStatic = (
    fn: (s: EarthAnalogSite) => number | null
  ): number[] => {
    const out: number[] = [];
    for (const s of sites) {
      const v = fn(s);
      if (v !== null && Number.isFinite(v)) out.push(v);
    }
    return out;
  };

  const collectMonthly = (
    fn: (s: EarthAnalogSite, m: MonthlyClimatologyBin) => number | null
  ): number[] => {
    const out: number[] = [];
    for (const s of sites) {
      for (const m of s.monthly) {
        const v = fn(s, m);
        if (v !== null && Number.isFinite(v)) out.push(v);
      }
    }
    return out;
  };

  return {
    maficIndex: computeRobustStats(collectStatic((s) => s.geology.maficIndex), 0.12),
    silicaWtPctLn: computeRobustStats(collectStatic((s) => safeLn(s.geology.silicaWtPct, 1)), 0.12),
    tiO2WtPctLn: computeRobustStats(collectStatic((s) => safeLn(s.geology.tiO2WtPct, 0.2)), 0.35),
    clayIndex: computeRobustStats(collectStatic((s) => s.geology.clayIndex), 0.08),
    sulfateIndex: computeRobustStats(collectStatic((s) => s.geology.sulfateIndex), 0.12),
    carbonateIndex: computeRobustStats(collectStatic((s) => s.geology.carbonateIndex), 0.12),
    wehWtPctLn: computeRobustStats(
      collectStatic((s) => safeLn(s.geology.waterEquivalentHydrogenWtPct, 0.2)),
      0.4
    ),

    medianSlopeDegLn: computeRobustStats(
      collectStatic((s) => safeLn(s.morphology.medianSlopeDeg, 1)),
      0.5
    ),
    p95SlopeDegLn: computeRobustStats(
      collectStatic((s) => safeLn(s.morphology.p95SlopeDeg, 1)),
      0.5
    ),
    rockCfaK: computeRobustStats(collectStatic((s) => s.morphology.rockCfaK), 0.08),
    cohesionKpa: computeRobustStats(collectStatic((s) => s.morphology.cohesionKpa), 1.5),
    frictionAngleDeg: computeRobustStats(collectStatic((s) => s.morphology.frictionAngleDeg), 4.0),
    regolithThicknessMLn: computeRobustStats(
      collectStatic((s) =>
        s.morphology.regolithThicknessM !== null ? safeLn(s.morphology.regolithThicknessM, 0.1) : null
      ),
      0.6
    ),
    iceTableDepthMLn: computeRobustStats(
      collectStatic((s) =>
        s.morphology.iceTableDepthM !== null ? safeLn(s.morphology.iceTableDepthM, 0.1) : null
      ),
      0.7
    ),
    sarBackscatterDb: computeRobustStats(
      collectStatic((s) => s.morphology.sarBackscatterSigma0Db),
      3.5
    ),

    thermalInertiaLn: computeRobustStats(
      collectStatic((s) => safeLn(s.thermalStatic.apparentThermalInertia, 1)),
      0.45
    ),
    tMeanK: computeRobustStats(collectMonthly((_s, m) => m.tMeanK), 10.0),
    diurnalDeltaK: computeRobustStats(collectMonthly((_s, m) => m.diurnalDeltaK), 3.5),
    albedo: computeRobustStats(collectStatic((s) => s.thermalStatic.albedo), 0.08),
    uvAbFluxLn: computeRobustStats(
      collectMonthly((_s, m) => safeLn(m.uvAbFluxWm2, 1)),
      0.35
    ),

    ambientDensityLn: computeRobustStats(
      collectMonthly((_s, m) => safeLn(Math.max(0.01, m.ambientDensityKgM3))),
      0.15
    ),
    grainDiameterLn: computeRobustStats(
      collectStatic((s) => safeLn(s.aeolianStatic.medianGrainDiameterUm)),
      0.45
    ),
    thresholdVelLn: computeRobustStats(
      collectMonthly((s, m) => {
        const u = computeShaoLuThresholdFrictionVel(
          s.aeolianStatic.particleDensityKgM3,
          m.ambientDensityKgM3,
          EARTH_GRAVITY_MS2,
          s.aeolianStatic.medianGrainDiameterUm,
          false
        );
        return u !== null ? safeLn(u, 0.05) : null;
      }),
      0.15
    ),

    roadDistanceLn: computeRobustStats(
      collectStatic((s) => safeLn(s.operationsStatic.roadDistanceKm, 1)),
      0.8
    ),
    rfQuietness: computeRobustStats(
      collectStatic((s) => s.operationsStatic.rfQuietnessScore),
      0.18
    ),
    visualAlienation: computeRobustStats(
      collectMonthly((s, m) =>
        computeVisualAlienation(
          s.operationsStatic.ndvi,
          s.operationsStatic.ndwi,
          s.operationsStatic.ndsi,
          m.snowDepthCm,
          false
        )
      ),
      0.22
    ),
    grazingSunHours: computeRobustStats(
      collectMonthly((_s, m) => m.grazingSunHoursPerDay),
      0.6
    ),
    clearSkyFraction: computeRobustStats(
      collectMonthly((_s, m) => m.clearSkyFraction),
      0.15
    ),
    logisticsFriction: computeRobustStats(
      collectStatic((s) => s.operationsStatic.logisticsFrictionIndex),
      0.22
    ),
  };
}

export function evaluateSiteMonthDomains(
  target: CelestialTarget,
  site: EarthAnalogSite,
  monthBin: MonthlyClimatologyBin,
  ephemeris: EphemerisState,
  stats: CatalogFeatureStats,
  presetId: MissionPresetId
): Record<DomainKey, Omit<DomainScoreDetail, 'frontierPct'>> {
  const isHyperAridTarget =
    target.isAnhydrousRegolith ||
    (target.geology.waterEquivalentHydrogenWtPct < 2.0 &&
      !target.requiresCryogenicIce &&
      target.operationsIdeal.clearSkyFraction >= 0.7);

  // --- Domain 1: Geochemistry & Mineralogy (7 dims) ---
  const clayBreach = target.isAnhydrousRegolith && site.geology.clayIndex > 0.05;
  const d1Features: WeightedFeatureResidual[] = [
    {
      weight: 1.4,
      targetVal: target.geology.maficIndex,
      candidateVal: site.geology.maficIndex,
      stats: stats.maficIndex,
    },
    {
      weight: 1.1,
      targetVal: safeLn(target.geology.silicaWtPct, 1),
      candidateVal: safeLn(site.geology.silicaWtPct, 1),
      stats: stats.silicaWtPctLn,
    },
    {
      weight: target.body === 'moon' ? 1.2 : 0.7,
      targetVal: safeLn(target.geology.tiO2WtPct, 0.2),
      candidateVal: safeLn(site.geology.tiO2WtPct, 0.2),
      stats: stats.tiO2WtPctLn,
    },
    {
      weight: 1.1,
      targetVal: target.geology.clayIndex,
      candidateVal: site.geology.clayIndex,
      stats: stats.clayIndex,
      asymmetricLambda: 3.0,
      breachCondition: clayBreach,
    },
    {
      weight: 0.9,
      targetVal: target.geology.sulfateIndex,
      candidateVal: site.geology.sulfateIndex,
      stats: stats.sulfateIndex,
    },
    {
      weight: 1.0,
      targetVal: target.geology.carbonateIndex,
      candidateVal: site.geology.carbonateIndex,
      stats: stats.carbonateIndex,
    },
    {
      weight: target.requiresCryogenicIce ? 1.4 : 0.8,
      targetVal: safeLn(target.geology.waterEquivalentHydrogenWtPct, 0.2),
      candidateVal: safeLn(site.geology.waterEquivalentHydrogenWtPct, 0.2),
      stats: stats.wehWtPctLn,
    },
  ];
  const d1 = computeObservedSubspaceDistance(d1Features);
  const geoBreaches = clayBreach
    ? [`Anhydrous clay breach (${site.geology.clayIndex.toFixed(2)} > 0.05)`]
    : [];

  // --- Domain 2: Surface & Subsurface Morphology (8 dims) ---
  const iceTarget = target.requiresCryogenicIce
    ? (target.morphology.iceTableDepthM ?? 0.2)
    : null;
  const iceCand = target.requiresCryogenicIce
    ? (site.morphology.iceTableDepthM ?? 50.0) // non-icy site gets deep-dry penalty on cryogenic ice missions
    : null;

  const d2Features: WeightedFeatureResidual[] = [
    {
      weight: 1.5,
      targetVal: safeLn(target.morphology.medianSlopeDeg, 1),
      candidateVal: safeLn(site.morphology.medianSlopeDeg, 1),
      stats: stats.medianSlopeDegLn,
    },
    {
      weight: 1.3,
      targetVal: safeLn(target.morphology.p95SlopeDeg, 1),
      candidateVal: safeLn(site.morphology.p95SlopeDeg, 1),
      stats: stats.p95SlopeDegLn,
    },
    {
      weight: 1.1,
      targetVal: target.morphology.rockCfaK,
      candidateVal: site.morphology.rockCfaK,
      stats: stats.rockCfaK,
    },
    {
      weight: 0.8,
      targetVal: target.morphology.cohesionKpa,
      candidateVal: site.morphology.cohesionKpa,
      stats: stats.cohesionKpa,
    },
    {
      weight: 0.8,
      targetVal: target.morphology.frictionAngleDeg,
      candidateVal: site.morphology.frictionAngleDeg,
      stats: stats.frictionAngleDeg,
    },
    {
      weight: 0.9,
      targetVal:
        target.morphology.regolithThicknessM !== null
          ? safeLn(target.morphology.regolithThicknessM, 0.1)
          : null,
      candidateVal:
        site.morphology.regolithThicknessM !== null
          ? safeLn(site.morphology.regolithThicknessM, 0.1)
          : null,
      stats: stats.regolithThicknessMLn,
    },
    {
      weight: target.requiresCryogenicIce ? 1.8 : 0.0,
      targetVal: iceTarget !== null ? safeLn(iceTarget, 0.1) : null,
      candidateVal: iceCand !== null ? safeLn(iceCand, 0.1) : null,
      stats: stats.iceTableDepthMLn,
      asymmetricLambda: 2.2,
      breachCondition: target.requiresCryogenicIce && site.morphology.iceTableDepthM === null,
    },
    {
      weight: 0.8,
      targetVal: target.morphology.sarBackscatterSigma0Db,
      candidateVal: site.morphology.sarBackscatterSigma0Db,
      stats: stats.sarBackscatterDb,
    },
  ];
  const d2 = computeObservedSubspaceDistance(d2Features);
  const morphBreaches =
    target.requiresCryogenicIce && site.morphology.iceTableDepthM === null
      ? ['No near-surface ice table for cryogenic drill target']
      : [];

  // --- Domain 3: Thermal & Radiative Kinetics (5 dims) ---
  // Note: for subsurface void presets, internal cave delta T is far more representative than surface diurnal swing
  const effectiveSiteDiurnal =
    (presetId === 'subsurface_void' || target.isSubsurfaceVoidTarget) &&
    site.voidProfile.voidType !== 'none' &&
    site.voidProfile.subterraneanDeltaTK !== null
      ? site.voidProfile.subterraneanDeltaTK
      : monthBin.diurnalDeltaK;

  const d3Features: WeightedFeatureResidual[] = [
    {
      weight: 1.0,
      targetVal: safeLn(target.thermalBase.apparentThermalInertia, 1),
      candidateVal: safeLn(site.thermalStatic.apparentThermalInertia, 1),
      stats: stats.thermalInertiaLn,
    },
    {
      weight: 1.3,
      targetVal: ephemeris.targetEffectiveTempK,
      candidateVal: monthBin.tMeanK,
      stats: stats.tMeanK,
    },
    {
      weight: 1.0,
      targetVal: target.thermalBase.diurnalDeltaK,
      candidateVal: effectiveSiteDiurnal,
      stats: stats.diurnalDeltaK,
    },
    {
      weight: 0.9,
      targetVal: target.thermalBase.albedo,
      candidateVal: site.thermalStatic.albedo,
      stats: stats.albedo,
    },
    {
      weight: 0.8,
      targetVal: safeLn(target.thermalBase.uvAbFluxWm2, 1),
      candidateVal: safeLn(monthBin.uvAbFluxWm2, 1),
      stats: stats.uvAbFluxLn,
    },
  ];
  const d3 = computeObservedSubspaceDistance(d3Features);

  // --- Domain 4: Atmospheric & Aeolian Dynamics (3 dims + Vacuum Guard) ---
  let d4: { distanceSq: number; pEff: number; observedDims: number } | null = null;
  if (!target.isVacuumRegime) {
    const siteUStar = computeShaoLuThresholdFrictionVel(
      site.aeolianStatic.particleDensityKgM3,
      monthBin.ambientDensityKgM3,
      EARTH_GRAVITY_MS2,
      site.aeolianStatic.medianGrainDiameterUm,
      false
    );

    const d4Features: WeightedFeatureResidual[] = [
      {
        weight: 1.1,
        targetVal: safeLn(Math.max(0.005, ephemeris.targetEffectiveDensityKgM3)),
        candidateVal: safeLn(Math.max(0.01, monthBin.ambientDensityKgM3)),
        stats: stats.ambientDensityLn,
      },
      {
        weight: 1.2,
        targetVal: safeLn(target.atmosphericBase.medianGrainDiameterUm),
        candidateVal: safeLn(site.aeolianStatic.medianGrainDiameterUm),
        stats: stats.grainDiameterLn,
      },
      {
        weight: 1.0,
        targetVal:
          ephemeris.targetEffectiveThresholdVelMs !== null
            ? safeLn(ephemeris.targetEffectiveThresholdVelMs, 0.05)
            : null,
        candidateVal: siteUStar !== null ? safeLn(siteUStar, 0.05) : null,
        stats: stats.thresholdVelLn,
      },
    ];
    d4 = computeObservedSubspaceDistance(d4Features);
  }

  // --- Domain 5: Operations, Illumination & Logistics (6 dims) ---
  const visualAlien = computeVisualAlienation(
    site.operationsStatic.ndvi,
    site.operationsStatic.ndwi,
    site.operationsStatic.ndsi,
    monthBin.snowDepthCm,
    target.requiresCryogenicIce
  );
  const visualBreach = visualAlien < 0.4;
  const rainBreach = isHyperAridTarget && monthBin.pPrecipGt5Mm > 0.15;

  const d5Features: WeightedFeatureResidual[] = [
    {
      weight: 0.7,
      targetVal: safeLn(target.operationsIdeal.roadDistanceKm, 1),
      candidateVal: safeLn(site.operationsStatic.roadDistanceKm, 1),
      stats: stats.roadDistanceLn,
    },
    {
      weight: 0.9,
      targetVal: target.operationsIdeal.rfQuietnessScore,
      candidateVal: site.operationsStatic.rfQuietnessScore,
      stats: stats.rfQuietness,
    },
    {
      weight: 1.6,
      targetVal: target.operationsIdeal.visualAlienation,
      candidateVal: visualAlien,
      stats: stats.visualAlienation,
      asymmetricLambda: 2.5,
      breachCondition: visualBreach,
    },
    {
      weight: target.operationsIdeal.grazingSunHoursPerDay > 2.5 ? 1.3 : 0.7,
      targetVal: target.operationsIdeal.grazingSunHoursPerDay,
      candidateVal: monthBin.grazingSunHoursPerDay,
      stats: stats.grazingSunHours,
    },
    {
      weight: 1.2,
      targetVal: target.operationsIdeal.clearSkyFraction,
      candidateVal: monthBin.clearSkyFraction,
      stats: stats.clearSkyFraction,
      asymmetricLambda: 2.5,
      breachCondition: rainBreach,
    },
    {
      weight: 0.8,
      targetVal: target.operationsIdeal.logisticsFrictionIndex,
      candidateVal: site.operationsStatic.logisticsFrictionIndex,
      stats: stats.logisticsFriction,
    },
  ];
  const d5 = computeObservedSubspaceDistance(d5Features);
  const opsBreaches: string[] = [];
  if (visualBreach) opsBreaches.push(`Visual/vegetation/water mask breach (alienation=${visualAlien.toFixed(2)})`);
  if (rainBreach) opsBreaches.push(`Hyper-arid precip breach (P_wet>5mm=${(monthBin.pPrecipGt5Mm * 100).toFixed(0)}%)`);

  return {
    geochemistry: {
      domain: 'geochemistry',
      scorePct: studentTKernel(d1.distanceSq, d1.pEff, 2.0),
      distanceSq: d1.distanceSq,
      pEff: d1.pEff,
      observedDims: d1.observedDims,
      breachFlags: geoBreaches,
    },
    morphology: {
      domain: 'morphology',
      scorePct: studentTKernel(d2.distanceSq, d2.pEff, 2.0),
      distanceSq: d2.distanceSq,
      pEff: d2.pEff,
      observedDims: d2.observedDims,
      breachFlags: morphBreaches,
    },
    thermal: {
      domain: 'thermal',
      scorePct: studentTKernel(d3.distanceSq, d3.pEff, 2.0),
      distanceSq: d3.distanceSq,
      pEff: d3.pEff,
      observedDims: d3.observedDims,
      breachFlags: [],
    },
    atmospheric: d4
      ? {
          domain: 'atmospheric',
          scorePct: studentTKernel(d4.distanceSq, d4.pEff, 2.0),
          distanceSq: d4.distanceSq,
          pEff: d4.pEff,
          observedDims: d4.observedDims,
          breachFlags: [],
        }
      : {
          domain: 'atmospheric',
          scorePct: 100,
          distanceSq: 0,
          pEff: 0,
          observedDims: 0,
          breachFlags: ['Vacuum body (atmosphere & wind saltation omitted)'],
        },
    operations: {
      domain: 'operations',
      scorePct: studentTKernel(d5.distanceSq, d5.pEff, 2.0),
      distanceSq: d5.distanceSq,
      pEff: d5.pEff,
      observedDims: d5.observedDims,
      breachFlags: opsBreaches,
    },
  };
}

export function combineDomainScores(
  domainScores: Record<DomainKey, { scorePct: number }>,
  weights: DomainWeights,
  isVacuumRegime = false
): number {
  const keys: DomainKey[] = [
    'geochemistry',
    'morphology',
    'thermal',
    'atmospheric',
    'operations',
  ];
  let wSum = 0;
  let total = 0;
  for (const k of keys) {
    if (k === 'atmospheric' && isVacuumRegime) continue;
    const w = Math.max(0, weights[k]);
    wSum += w;
    total += w * domainScores[k].scorePct;
  }
  return wSum > 1e-9 ? total / wSum : 0;
}

export function blendWithLayersBAndC(
  layerAScorePct: number,
  voidScorePct: number,
  voidActive: boolean,
  isruScorePct: number,
  isruActive: boolean,
  astroScorePct: number,
  astroMode: MissionConfig['astrobiologyMode'],
  processScorePct: number,
  presetId: MissionPresetId
): number {
  if (voidActive) {
    return Math.max(
      0,
      Math.min(100, 0.50 * layerAScorePct + 0.40 * voidScorePct + 0.10 * processScorePct)
    );
  }
  if (isruActive) {
    return Math.max(
      0,
      Math.min(100, 0.60 * layerAScorePct + 0.30 * isruScorePct + 0.10 * processScorePct)
    );
  }
  if (presetId === 'astrobiology' && astroMode !== 'ignore') {
    return Math.max(
      0,
      Math.min(100, 0.65 * layerAScorePct + 0.25 * astroScorePct + 0.10 * processScorePct)
    );
  }
  if (astroMode !== 'ignore') {
    return Math.max(
      0,
      Math.min(100, 0.80 * layerAScorePct + 0.10 * astroScorePct + 0.10 * processScorePct)
    );
  }
  return Math.max(0, Math.min(100, 0.86 * layerAScorePct + 0.14 * processScorePct));
}

export function buildCandidateNarrative(
  target: CelestialTarget,
  site: EarthAnalogSite,
  domainScores: Record<DomainKey, DomainScoreDetail>,
  voidActive: boolean,
  voidScorePct: number,
  isruActive: boolean,
  isruScorePct: number,
  processClass: string,
  rainExceedanceProb: number,
  thermalGapK: number
): CandidateNarrative {
  const sortedDomains = (Object.keys(domainScores) as DomainKey[]).sort(
    (a, b) => domainScores[b].scorePct - domainScores[a].scorePct
  );
  const bestD = sortedDomains[0];
  const secondD = sortedDomains[1];

  let whyItMatches = `Leads on ${bestD} (${domainScores[bestD].scorePct.toFixed(0)}%, ${domainScores[bestD].frontierPct.toFixed(0)}% of Earth limit) and ${secondD} (${domainScores[secondD].scorePct.toFixed(0)}%) as a ${processClass}.`;
  if (voidActive && site.voidProfile.voidType !== 'none') {
    whyItMatches = `Verified ${site.voidProfile.voidType.replace('_', ' ')} structure (Void Fit ${voidScorePct.toFixed(0)}%) with damped subterranean thermal swing (${site.voidProfile.subterraneanDeltaTK?.toFixed(1) ?? '?'} K) and ${bestD} alignment (${domainScores[bestD].scorePct.toFixed(0)}%).`;
  } else if (isruActive) {
    whyItMatches = `Strong ISRU/feedstock match (${isruScorePct.toFixed(0)}%) paired with ${bestD} (${domainScores[bestD].scorePct.toFixed(0)}%) and ${site.geology.simulantNearest ?? site.geology.macrostratLithology ?? 'analog bedrock'}.`;
  }

  const allBreaches = (Object.keys(domainScores) as DomainKey[]).flatMap(
    (k) => domainScores[k].breachFlags
  );
  const weakD = sortedDomains[sortedDomains.length - 1];
  const breakdownParts: string[] = [];
  if (allBreaches.length > 0) breakdownParts.push(allBreaches[0]);
  if (thermalGapK > 45) {
    breakdownParts.push(`${thermalGapK.toFixed(0)} K thermal gap vs ${target.name}`);
  }
  if (rainExceedanceProb > 0.15) {
    breakdownParts.push(`${(rainExceedanceProb * 100).toFixed(0)}% campaign rain exceedance risk`);
  }
  if (breakdownParts.length === 0) {
    breakdownParts.push(
      `Weakest axis is ${weakD} (${domainScores[weakD].scorePct.toFixed(0)}%); terrestrial gravity & UV-C require lab compensation`
    );
  }
  const whereItBreaksDown = breakdownParts.join('; ') + '.';

  let whatExplorationItEnables = `Supports ${target.missionArchetype} field campaigns for ${target.name}`;
  if (voidActive && site.voidProfile.voidType !== 'none') {
    whatExplorationItEnables = `Enables skylight rappel/rover ingress, underground RF-denied SLAM autonomy, and radiation-shielded habitat validation for ${target.name}.`;
  } else if (isruActive) {
    whatExplorationItEnables = `Enables regolith excavation, sintering/oxygen-extraction ISRU prototyping, and dust-mitigation ops for ${target.name}.`;
  } else if (target.requiresCryogenicIce) {
    whatExplorationItEnables = `Enables icy-regolith rotary-percussive drilling, volatile sample sealing, and polar grazing-sun operations for ${target.name}.`;
  } else {
    whatExplorationItEnables = `Qualifies mobility traction, spectrometer calibration, and dusty-terrain operations for ${target.name}.`;
  }

  return {
    whyItMatches,
    whereItBreaksDown,
    whatExplorationItEnables,
  };
}

export function evaluateCandidateScoreOnly(
  target: CelestialTarget,
  site: EarthAnalogSite,
  ephemeris: EphemerisState,
  stats: CatalogFeatureStats,
  weights: DomainWeights,
  config: MissionConfig,
  cachedMonthlyDomains?: Array<Record<DomainKey, Omit<DomainScoreDetail, 'frontierPct'>>>
): {
  missionFitPct: number;
  monthlyDomains: Array<Record<DomainKey, Omit<DomainScoreDetail, 'frontierPct'>>>;
  monthlyScores: number[];
  windowResult: ReturnType<typeof optimizeCampaignWindow>;
  voidEval: ReturnType<typeof evaluateVoidModule>;
  isruEval: ReturnType<typeof evaluateIsruModule>;
  astroEval: ReturnType<typeof evaluateAstrobiologyModule>;
  processEval: ReturnType<typeof evaluateProcessAnalogy>;
} {
  const monthlyDomains =
    cachedMonthlyDomains ??
    site.monthly.map((m) =>
      evaluateSiteMonthDomains(target, site, m, ephemeris, stats, config.presetId)
    );

  const monthlyLayerAScores = monthlyDomains.map((md) =>
    combineDomainScores(md, weights, target.isVacuumRegime)
  );

  const hydroWeight =
    target.isAnhydrousRegolith ||
    (target.geology.waterEquivalentHydrogenWtPct < 3.0 && !target.requiresCryogenicIce)
      ? 1.0
      : 0.4;

  const windowResult = optimizeCampaignWindow(
    monthlyLayerAScores,
    site.monthly,
    config.durationDays,
    hydroWeight
  );

  const voidEval = evaluateVoidModule(target, site, config.presetId);
  const isruEval = evaluateIsruModule(target, site, config.presetId);
  const astroEval = evaluateAstrobiologyModule(target, site, config.astrobiologyMode);
  const processEval = evaluateProcessAnalogy(target, site);

  const monthlyCompositeScores = monthlyLayerAScores.map((sA) =>
    blendWithLayersBAndC(
      sA,
      voidEval.scorePct,
      voidEval.active,
      isruEval.scorePct,
      isruEval.active,
      astroEval.scorePct,
      config.astrobiologyMode,
      processEval.similarityPct,
      config.presetId
    )
  );

  const missionFitPct = blendWithLayersBAndC(
    windowResult.finalScorePct,
    voidEval.scorePct,
    voidEval.active,
    isruEval.scorePct,
    isruEval.active,
    astroEval.scorePct,
    config.astrobiologyMode,
    processEval.similarityPct,
    config.presetId
  );

  return {
    missionFitPct,
    monthlyDomains,
    monthlyScores: monthlyCompositeScores,
    windowResult,
    voidEval,
    isruEval,
    astroEval,
    processEval,
  };
}

/**
 * Isolated single-target evaluation pipeline P(tau_i).
 * Never mixes or averages multiple celestial targets.
 */
export function evaluateTargetIsolated(
  target: CelestialTarget,
  allSites: EarthAnalogSite[],
  config: MissionConfig,
  precomputedStats?: CatalogFeatureStats
): TargetEvaluationDossier {
  const t0 = performance.now();
  const stats = precomputedStats ?? computeCatalogFeatureStats(allSites);
  const ephemeris = computeEphemerisState(target, config.epochDateIso);

  // Filter sites by Permit Tiers & pre-Stage-2 maxSlopeFilterDeg
  const eligibleSites = allSites.filter((site) => {
    if (
      config.allowedPermitTiers.length > 0 &&
      !config.allowedPermitTiers.includes(site.permitTier)
    ) {
      return false;
    }
    if (
      config.maxSlopeFilterDeg !== undefined &&
      site.morphology.medianSlopeDeg > config.maxSlopeFilterDeg
    ) {
      return false;
    }
    return true;
  });

  const weights = config.domainWeights;

  const rawEvals = eligibleSites.map((site) => {
    const res = evaluateCandidateScoreOnly(
      target,
      site,
      ephemeris,
      stats,
      weights,
      config
    );
    return { site, ...res };
  });

  // Sort descending by missionFitPct
  rawEvals.sort((a, b) => b.missionFitPct - a.missionFitPct);

  // Compute max domain scores & max overall score across eligible Earth sites for Earth Achievable Frontier %
  const domainKeys: DomainKey[] = [
    'geochemistry',
    'morphology',
    'thermal',
    'atmospheric',
    'operations',
  ];
  const maxDomainScore: Record<DomainKey, number> = {
    geochemistry: 1e-6,
    morphology: 1e-6,
    thermal: 1e-6,
    atmospheric: 1e-6,
    operations: 1e-6,
  };
  let maxOverallScore = 1e-6;

  // Representative month for domain breakdown is the bestStartDayOfYear's month
  const siteRepDomains = rawEvals.map((ev) => {
    const bestMonthIdx = Math.max(
      0,
      Math.min(11, Math.floor(((ev.windowResult.bestStartDayOfYear - 1) / 365) * 12))
    );
    const md = ev.monthlyDomains[bestMonthIdx];
    for (const k of domainKeys) {
      if (md[k].scorePct > maxDomainScore[k]) {
        maxDomainScore[k] = md[k].scorePct;
      }
    }
    if (ev.missionFitPct > maxOverallScore) {
      maxOverallScore = ev.missionFitPct;
    }
    return md;
  });

  // Deterministic +-15% weight perturbation sensitivity check across Top 5
  const perturbedWeightsList: DomainWeights[] = [];
  for (const k of domainKeys) {
    for (const factor of [0.85, 1.15]) {
      const pw: DomainWeights = { ...weights, [k]: weights[k] * factor };
      const sum = domainKeys.reduce((s, d) => s + pw[d], 0);
      if (sum > 0) {
        for (const d of domainKeys) pw[d] /= sum;
      }
      perturbedWeightsList.push(pw);
    }
  }

  const nominalTop3Ids = new Set(rawEvals.slice(0, 3).map((e) => e.site.id));
  const sensitivityRanges = new Map<string, [number, number]>();
  const top3RetentionCounts = new Map<string, number>();

  for (const ev of rawEvals.slice(0, 5)) {
    sensitivityRanges.set(ev.site.id, [ev.missionFitPct, ev.missionFitPct]);
    top3RetentionCounts.set(ev.site.id, 0);
  }

  const sensitivityPool = rawEvals.slice(0, 25);
  let allTop3PreservedCount = 0;
  for (const pw of perturbedWeightsList) {
    const pRanked = sensitivityPool
      .map((ev) => {
        const pr = evaluateCandidateScoreOnly(
          target,
          ev.site,
          ephemeris,
          stats,
          pw,
          config,
          ev.monthlyDomains
        );
        return { id: ev.site.id, score: pr.missionFitPct };
      })
      .sort((a, b) => b.score - a.score);

    const pTop3Ids = new Set(pRanked.slice(0, 3).map((p) => p.id));
    let allPreserved = true;
    for (const nid of nominalTop3Ids) {
      if (!pTop3Ids.has(nid)) allPreserved = false;
    }
    if (allPreserved) allTop3PreservedCount += 1;

    for (const p of pRanked) {
      const range = sensitivityRanges.get(p.id);
      if (range) {
        range[0] = Math.min(range[0], p.score);
        range[1] = Math.max(range[1], p.score);
        if (pTop3Ids.has(p.id)) {
          top3RetentionCounts.set(p.id, (top3RetentionCounts.get(p.id) ?? 0) + 1);
        }
      }
    }
  }

  const top3RobustnessPct = Math.round(
    (allTop3PreservedCount / Math.max(1, perturbedWeightsList.length)) * 100
  );

  const rankedCandidates: CandidateEvaluation[] = rawEvals.map((ev, idx) => {
    const repMd = siteRepDomains[idx];
    const domainScores = {} as Record<DomainKey, DomainScoreDetail>;
    for (const k of domainKeys) {
      domainScores[k] = {
        ...repMd[k],
        scorePct: Math.round(repMd[k].scorePct * 10) / 10,
        frontierPct:
          Math.round(computeFrontierPct(repMd[k].scorePct, maxDomainScore[k]) * 10) / 10,
      };
    }

    const { deficits, hardwareSpecs } = computeDeficitsAndHardwareSpecs(
      target,
      ev.site,
      ephemeris,
      ev.windowResult.bestStartDayOfYear
    );

    const narrative = buildCandidateNarrative(
      target,
      ev.site,
      domainScores,
      ev.voidEval.active,
      ev.voidEval.scorePct,
      ev.isruEval.active,
      ev.isruEval.scorePct,
      ev.processEval.classification,
      ev.windowResult.rainExceedanceProb,
      hardwareSpecs.thermalGapK
    );

    const sRange = sensitivityRanges.get(ev.site.id) ?? [
      ev.missionFitPct,
      ev.missionFitPct,
    ];
    const siteRetention =
      idx < 5
        ? Math.round(
            ((top3RetentionCounts.get(ev.site.id) ?? 0) /
              Math.max(1, perturbedWeightsList.length)) *
              100
          )
        : 0;

    return {
      site: ev.site,
      targetId: target.id,
      missionFitPct: Math.round(ev.missionFitPct * 10) / 10,
      earthFrontierPct:
        Math.round(computeFrontierPct(ev.missionFitPct, maxOverallScore) * 10) / 10,
      baseWindowMeanPct: Math.round(ev.windowResult.windowMeanPct * 10) / 10,
      downsideDriftPenalty: Math.round(ev.windowResult.driftPenalty * 10) / 10,
      rainCliffPenalty: Math.round(ev.windowResult.rainCliffPenalty * 10) / 10,
      rainExceedanceProb: Math.round(ev.windowResult.rainExceedanceProb * 1000) / 1000,
      bestStartDayOfYear: ev.windowResult.bestStartDayOfYear,
      monthlyScores: ev.monthlyScores.map((s) => Math.round(s * 10) / 10),
      domainScores,
      voidEval: {
        ...ev.voidEval,
        scorePct: Math.round(ev.voidEval.scorePct * 10) / 10,
      },
      isruEval: {
        ...ev.isruEval,
        scorePct: Math.round(ev.isruEval.scorePct * 10) / 10,
      },
      astrobiologyEval: {
        ...ev.astroEval,
        scorePct: Math.round(ev.astroEval.scorePct * 10) / 10,
      },
      processEval: ev.processEval,
      sensitivityRange: [
        Math.round(sRange[0] * 10) / 10,
        Math.round(sRange[1] * 10) / 10,
      ],
      top3RobustnessPct: siteRetention,
      deficits,
      hardwareSpecs,
      narrative,
      rank: idx + 1,
    };
  });

  // Always compute 2-site portfolio; auto-trigger when single-site max < 72%
  const singleMax = rankedCandidates[0]?.missionFitPct ?? 0;
  const triggeredAutomatically = singleMax < 72.0;
  const portfolio = optimizeTwoSitePortfolio(
    target,
    rankedCandidates,
    weights,
    triggeredAutomatically,
    config.presetId
  );

  // Extract anti-analog spotlight (from ranked or full catalog)
  const antiAnalogSpotlight =
    rankedCandidates.find((c) => c.site.isAntiAnalog) ?? null;

  const evaluationMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    target,
    ephemeris,
    rankedCandidates,
    antiAnalogSpotlight,
    portfolio,
    top3RobustnessPct,
    evaluationMs,
    qualifiedLocationsCount: rankedCandidates.length,
  };
}

export function evaluateAllTargetsIsolated(
  targets: CelestialTarget[],
  allSites: EarthAnalogSite[],
  config: MissionConfig
): TargetEvaluationDossier[] {
  const stats = computeCatalogFeatureStats(allSites);
  const selectedTargets = targets.filter((t) => config.targetIds.includes(t.id));
  return selectedTargets.map((target) =>
    evaluateTargetIsolated(target, allSites, config, stats)
  );
}

export type VoidTypeLookup = Record<number, VoidType>;
export const VOID_CODE_MAP: VoidTypeLookup = {
  0: 'none',
  1: 'lava_tube',
  2: 'karst_cave',
  3: 'mine_shaft',
};
