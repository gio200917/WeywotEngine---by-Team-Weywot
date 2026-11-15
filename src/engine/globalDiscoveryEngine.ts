import type { CatalogFeatureStats } from './evaluator.js';
import {
  blendWithLayersBAndC,
  buildCandidateNarrative,
  combineDomainScores,
  evaluateCandidateScoreOnly,
  evaluateTargetIsolated,
} from './evaluator.js';
import { resolveEarthRegion } from './earthRegionResolver.js';
import {
  computeFrontierPct,
  computeRobustStats,
  studentTKernel,
  type RobustFeatureStats,
} from './math.js';
import {
  computeEphemerisState,
  computeEarthGrazingSunHoursPerDay,
  computeShaoLuThresholdFrictionVel,
  computeVisualAlienation,
  EARTH_GRAVITY_MS2,
} from './physics.js';
import {
  buildCrossTargetMatrix,
  optimizeMultiTargetTwoSitePortfolio,
} from './portfolio.js';
import { computeDeficitsAndHardwareSpecs } from './deficits.js';
import type {
  AstrobiologyMode,
  CandidateEvaluation,
  CelestialTarget,
  CrossTargetMatrix,
  DataLineageItem,
  DiscoveryCellResult,
  DomainKey,
  DomainScoreDetail,
  EarthAnalogSite,
  ExtremophileGuild,
  GlobalDiscoveryGridFile,
  LiveTelemetryPatch,
  MissionConfig,
  MonthlyClimatologyBin,
  MultiTargetTwoSitePortfolioResult,
  PermitTier,
  ProcessTag,
  TargetEvaluationDossier,
  VoidType,
} from '../types/planetary.js';

export function makeLiveCoordKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

export function applyLivePatchToSite(
  site: EarthAnalogSite,
  patch: LiveTelemetryPatch
): EarthAnalogSite {
  const nextLineage = [...site.dataLineage];
  if (patch.powerLive && patch.monthly) {
    nextLineage.push({
      domain: 'thermal',
      source: 'NASA POWER Climatology API (Verified)',
      detail: `Live 20-yr climatology · albedo ${(patch.meanAlbedo ?? site.thermalStatic.albedo).toFixed(2)} · wind p95=${patch.wind95Ms ?? 0} m/s`,
      resolutionOrPeriod: '0.5° × 0.625° / 20-yr climatology',
    });
  }
  if (patch.demLive) {
    if (patch.medianSlopeDeg !== null && !patch.elevationOnly) {
      nextLineage.push({
        domain: 'morphology',
        source:
          patch.demSource === 'terrarium'
            ? 'AWS Mapzen Terrarium DEM (3×3 Stitched, Verified)'
            : 'Open-Meteo High-Res Elevation (Verified)',
        detail: `Elev=${patch.elevationM ?? site.elevationM} m · medSlope=${patch.medianSlopeDeg}° · p95=${patch.p95SlopeDeg ?? site.morphology.p95SlopeDeg}°`,
        resolutionOrPeriod: `${patch.dtmResolutionM ?? site.morphology.dtmResolutionM} m/px`,
      });
    } else if (patch.elevationM !== null) {
      nextLineage.push({
        domain: 'morphology',
        source: 'Open-Meteo Polar Elevation (Elevation Only)',
        detail: `Polar |lat|>85°: elevation ${patch.elevationM} m verified; high-res DEM slope unavailable (retaining 1° prior ${site.morphology.medianSlopeDeg.toFixed(1)}°).`,
        resolutionOrPeriod: 'Polar elevation point sample',
      });
    }
  }
  if (patch.macroLive && patch.geologyPatch) {
    nextLineage.push({
      domain: 'geochemistry',
      source: 'Macrostrat v2 Geologic Polygons (Verified)',
      detail:
        patch.geologyPatch.macrostratLithology ??
        site.geology.macrostratLithology ??
        'Mapped bedrock unit (subsurface void unconfirmed)',
      resolutionOrPeriod: 'Regional geologic polygon',
    });
  }

  // Never fabricate subsurface caves/lava tubes from surface lithology keywords;
  // only confirmed analog catalog or WHYMAP void records retain void geometry.
  const nextVoidProfile = site.voidProfile;

  const hasFullDemSlope = patch.demLive && patch.medianSlopeDeg !== null && !patch.elevationOnly;
  const liveStatus =
    patch.powerLive && hasFullDemSlope
      ? 'verified'
      : patch.powerLive || patch.demLive || patch.macroLive
        ? 'partial'
        : 'grid_baseline';

  return {
    ...site,
    elevationM:
      patch.demLive && patch.elevationM !== null ? patch.elevationM : site.elevationM,
    provenanceTier:
      liveStatus === 'verified'
        ? 'tier2_live_probe'
        : liveStatus === 'partial'
          ? 'tier2_best_effort_fallback'
          : site.provenanceTier,
    liveStatus,
    verifiedSources: patch.verifiedSources,
    permitTier: patch.osmLive && patch.permitTier ? patch.permitTier : site.permitTier,
    geology:
      patch.macroLive && patch.geologyPatch
        ? {
            ...site.geology,
            ...patch.geologyPatch,
            // Preserve grid/permafrost WEH baseline cleanly
            waterEquivalentHydrogenWtPct: site.geology.waterEquivalentHydrogenWtPct,
          }
        : site.geology,
    morphology:
      hasFullDemSlope
        ? {
            ...site.morphology,
            medianSlopeDeg: patch.medianSlopeDeg!,
            p95SlopeDeg: patch.p95SlopeDeg ?? site.morphology.p95SlopeDeg,
            dtmResolutionM: patch.dtmResolutionM ?? site.morphology.dtmResolutionM,
          }
        : site.morphology,
    thermalStatic: {
      apparentThermalInertia:
        patch.thermalInertia ?? site.thermalStatic.apparentThermalInertia,
      albedo:
        patch.powerLive && patch.meanAlbedo !== null
          ? patch.meanAlbedo
          : site.thermalStatic.albedo,
    },
    operationsStatic: {
      ...site.operationsStatic,
      roadDistanceKm:
        patch.osmLive && patch.roadDistanceKm !== null
          ? patch.roadDistanceKm
          : site.operationsStatic.roadDistanceKm,
      rfQuietnessScore:
        patch.osmLive && patch.rfQuietnessScore !== null
          ? patch.rfQuietnessScore
          : site.operationsStatic.rfQuietnessScore,
    },
    monthly: patch.powerLive && patch.monthly ? patch.monthly : site.monthly,
    voidProfile: nextVoidProfile,
    dataLineage: nextLineage,
  };
}

interface GridCellCacheItem {
  row: number[];
  lat: number;
  lon: number;
  elevM: number;
  slopeMed: number;
  mafic: number;
  clay: number;
  weh: number;
  albedo: number;
  ndvi: number;
  isClassicRegion: boolean;
  voidCode: number;
  qTemps: [number, number, number, number];
  qPrecs: [number, number, number, number];
  qClds: [number, number, number, number];
  meanTempK: number;
  meanPrecip: number;
  permitTier: PermitTier;
  iceTableDepthM: number | null;
  // Precomputed Stage-2 parity scalars
  silicaWtPctLn: number;
  tiO2WtPctLn: number;
  sulfateIdx: number;
  carbonateIdx: number;
  wehLn: number;
  slopeMedLn: number;
  p95SlopeLn: number;
  rockCfa: number;
  cohesion: number;
  frictionAngle: number;
  regolithLn: number;
  iceTableDepthLn: number | null;
  sarDb: number;
  tiLn: number;
  visualAlienNonCryo: number;
  visualAlienCryo: number;
  roadDistanceLn: number;
  rfQuietness: number;
  logisticsFric: number;
  qDiurnal: [number, number, number, number];
  qUvLn: [number, number, number, number];
  qDensityLn: [number, number, number, number];
  grainUmLn: number;
  qUStarLn: [number, number, number, number];
  qGrazing: [number, number, number, number];
  qClearSky: [number, number, number, number];
  // Layer B / C parity scalars
  ilmenitePotential: number;
  feedstockSuitability: number;
  plumeHazard: number;
  dtePct: number;
  tocWtPct: number;
  waterActivityAw: number;
  surfacePh: number;
  preservationIdx: number;
  voidSubterraneanDeltaT: number;
  voidSkylightSlope: number;
  activeProcesses: ProcessTag[];
  relictProcesses: ProcessTag[];
  guilds: ExtremophileGuild[];
}

const DOMAIN_KEYS: DomainKey[] = [
  'geochemistry',
  'morphology',
  'thermal',
  'atmospheric',
  'operations',
];

const VOID_CODE_TO_TYPE: Record<number, VoidType> = {
  0: 'none',
  1: 'lava_tube',
  2: 'karst_cave',
  3: 'mine_shaft',
};

const MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const QUARTER_MONTH_CENTER = [1, 4, 7, 10]; // Jan, Apr, Jul, Oct

let cachedGridSource: GlobalDiscoveryGridFile | null = null;
let cachedStats: CatalogFeatureStats | null = null;
let cachedCells: GridCellCacheItem[] | null = null;

function safeLn(x: number, offset = 0): number {
  return Math.log(Math.max(1e-6, x + offset));
}

export function haversineEarthKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function interpolateSeasonalQuarter(
  qVals: [number, number, number, number],
  month1to12: number
): number {
  const shifted = (month1to12 - 1 + 12) % 12;
  const qIdx = Math.floor(shifted / 3) % 4;
  const nextQIdx = (qIdx + 1) % 4;
  const frac = (shifted % 3) / 3;
  return qVals[qIdx] * (1 - frac) + qVals[nextQIdx] * frac;
}

function relProxScore(targetVal: number, siteVal: number, scaleFallback: number): number {
  const denom = Math.max(scaleFallback, Math.abs(targetVal) * 0.65);
  const ratio = Math.abs(siteVal - targetVal) / denom;
  return 100 / (1 + ratio * ratio);
}

function getPreparedGrid(grid: GlobalDiscoveryGridFile): {
  stats: CatalogFeatureStats;
  items: GridCellCacheItem[];
} {
  if (cachedGridSource === grid && cachedStats && cachedCells) {
    return { stats: cachedStats, items: cachedCells };
  }

  const items: GridCellCacheItem[] = new Array(grid.cells.length);
  const maficArr: number[] = [];
  const silicaLnArr: number[] = [];
  const tiO2LnArr: number[] = [];
  const clayArr: number[] = [];
  const sulfateArr: number[] = [];
  const carbonateArr: number[] = [];
  const wehLnArr: number[] = [];
  const slopeMedLnArr: number[] = [];
  const p95SlopeLnArr: number[] = [];
  const cfaArr: number[] = [];
  const cohesionArr: number[] = [];
  const frictionArr: number[] = [];
  const regolithLnArr: number[] = [];
  const iceLnArr: number[] = [];
  const sarArr: number[] = [];
  const tiLnArr: number[] = [];
  const tMeanArr: number[] = [];
  const diurnalArr: number[] = [];
  const albedoArr: number[] = [];
  const uvLnArr: number[] = [];
  const densityLnArr: number[] = [];
  const grainLnArr: number[] = [];
  const uStarLnArr: number[] = [];
  const roadLnArr: number[] = [];
  const rfArr: number[] = [];
  const visualArr: number[] = [];
  const grazingArr: number[] = [];
  const clearArr: number[] = [];
  const frictionLogArr: number[] = [];

  for (let i = 0; i < grid.cells.length; i++) {
    const row = grid.cells[i];
    const [
      lat,
      lon,
      elevM,
      slopeMed,
      mafic,
      clay,
      weh,
      albedo,
      ndvi,
      isClassicFlag,
      voidCode,
      q1T,
      q2T,
      q3T,
      q4T,
      q1P,
      q2P,
      q3P,
      q4P,
      q1Cld,
      q2Cld,
      q3Cld,
      q4Cld,
    ] = row;

    const absLat = Math.abs(lat);
    const meanTempK = (q1T + q2T + q3T + q4T) / 4;
    const meanPrecip = (q1P + q2P + q3P + q4P) / 4;
    const isIce = meanTempK < 268.0 || (absLat > 64 && meanTempK < 271.5);
    const iceTableDepthM = isIce
      ? Number(Math.max(0.15, 0.25 + Math.max(0, meanTempK - 250) * 0.04).toFixed(2))
      : null;

    const resolved = resolveEarthRegion(lat, lon, voidCode);

    const silicaWtPct =
      voidCode === 2 ? 22.0 : voidCode === 1 ? 47.8 : Math.max(44, 62 - mafic * 28);
    const tiO2WtPct =
      voidCode === 1 ? 2.4 : mafic >= 0.45 ? 1.8 : mafic >= 0.34 ? 1.1 : 0.55;
    const sulfateIdx = meanPrecip < 0.06 && voidCode !== 2 ? 0.35 : 0.06;
    const carbonateIdx = voidCode === 2 ? 0.72 : meanPrecip < 0.08 ? 0.14 : 0.05;
    const p95Slope = Math.min(48, slopeMed * 2.25 + 2.5);
    const rockCfa = Math.min(0.35, 0.03 + slopeMed * 0.008 + (voidCode === 1 ? 0.08 : 0));
    const cohesion = isIce ? 4.2 : 0.6 + clay * 3.5;
    const frictionAngle = Math.min(41, 29 + slopeMed * 0.32);
    const regolithThickness = slopeMed > 15 ? 0.45 : voidCode === 1 ? 0.9 : 2.1;
    const sarDb = -13.5 + slopeMed * 0.25 + (voidCode === 1 ? 2.8 : 0);
    const ti = 175 + slopeMed * 13 + (isIce ? 85 : 0) + (voidCode === 1 ? 90 : 0);
    const pressureKpa =
      101.325 *
      Math.pow(
        Math.max(0.1, 1 - 2.25577e-5 * Math.min(8500, Math.max(-200, elevM))),
        5.25588
      );
    const particleDensity = mafic >= 0.4 ? 2880 : 2650;
    const grainUm = slopeMed > 12 || voidCode === 1 ? 240 : 145;
    const meanDensity = (pressureKpa * 1000) / (287.058 * Math.max(150, meanTempK));
    const meanUStar = computeShaoLuThresholdFrictionVel(
      particleDensity,
      meanDensity,
      EARTH_GRAVITY_MS2,
      grainUm,
      false
    );

    const qTemps: [number, number, number, number] = [q1T, q2T, q3T, q4T];
    const qPrecs: [number, number, number, number] = [q1P, q2P, q3P, q4P];
    const qClds: [number, number, number, number] = [q1Cld, q2Cld, q3Cld, q4Cld];

    const qDiurnal: [number, number, number, number] = [0, 0, 0, 0];
    const qUvLn: [number, number, number, number] = [0, 0, 0, 0];
    const qDensityLn: [number, number, number, number] = [0, 0, 0, 0];
    const qUStarLn: [number, number, number, number] = [0, 0, 0, 0];
    const qGrazing: [number, number, number, number] = [0, 0, 0, 0];
    const qClearSky: [number, number, number, number] = [0, 0, 0, 0];

    for (let q = 0; q < 4; q++) {
      const tQ = qTemps[q];
      const pQ = Math.max(0, Math.min(0.9, qPrecs[q]));
      const clrQ = Math.max(0, Math.min(1, 1 - qClds[q] / 100));
      const densQ = (pressureKpa * 1000) / (287.058 * Math.max(150, tQ));
      const diurnQ = Math.max(
        3.5,
        Math.min(22, 6.0 + 10.0 * clrQ + (elevM > 1500 ? 3.0 : 0) - pQ * 6.0)
      );
      const doy = MID_MONTH_DOY[QUARTER_MONTH_CENTER[q] - 1];
      const declDeg = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365.25);
      const solarScale = Math.max(0.08, Math.cos(((lat - declDeg) * Math.PI) / 180));
      const uvQ = Math.max(
        0.5,
        clrQ * (34 - absLat * 0.22) * (1 + Math.max(0, elevM) / 9000) * solarScale
      );
      const uStarQ = computeShaoLuThresholdFrictionVel(
        particleDensity,
        densQ,
        EARTH_GRAVITY_MS2,
        grainUm,
        false
      );
      qClearSky[q] = clrQ;
      qDiurnal[q] = diurnQ;
      qUvLn[q] = safeLn(uvQ, 1);
      qDensityLn[q] = safeLn(Math.max(0.01, densQ));
      qUStarLn[q] = uStarQ !== null ? safeLn(uStarQ, 0.05) : safeLn(0.35, 0.05);
      qGrazing[q] = computeEarthGrazingSunHoursPerDay(lat, QUARTER_MONTH_CENTER[q], clrQ);
    }

    const meanClear = (qClearSky[0] + qClearSky[1] + qClearSky[2] + qClearSky[3]) / 4;
    const diurnalMean = (qDiurnal[0] + qDiurnal[1] + qDiurnal[2] + qDiurnal[3]) / 4;
    const uvMeanBase = Math.max(
      1.5,
      meanClear * (34 - absLat * 0.28) * (1 + Math.max(0, elevM) / 9000)
    );
    const ndsi = meanTempK < 267 ? 0.45 : 0.0;
    const snowCm = meanTempK < 271 && absLat > 55 ? 8 : 0;
    const visualAlienNonCryo = computeVisualAlienation(ndvi, -0.35, ndsi, snowCm, false);
    const visualAlienCryo = computeVisualAlienation(ndvi, -0.35, ndsi, snowCm, true);
    const grazingMean = computeEarthGrazingSunHoursPerDay(lat, 4, meanClear);

    const permitBase =
      resolved.permitTier === 'open_public'
        ? 0.92
        : resolved.permitTier === 'regulated_research'
          ? 0.72
          : resolved.permitTier === 'protected_park'
            ? 0.45
            : 0.28;
    const logisticsFric = Math.max(
      0.1,
      permitBase - Math.min(0.25, resolved.roadDistanceKm / 120)
    );

    const activeProcesses: ProcessTag[] = [];
    const relictProcesses: ProcessTag[] = [];
    if (isIce) activeProcesses.push('cryogenic_sublimation_permafrost');
    if (meanPrecip < 0.1 && ndvi < 0.15) activeProcesses.push('aeolian_saltation');
    if (slopeMed > 8 && meanPrecip < 0.08) activeProcesses.push('dust_devils_storms');
    if (meanPrecip < 0.06 && albedo > 0.28) activeProcesses.push('evaporite_brine_precipitation');
    if (activeProcesses.length === 0) activeProcesses.push('aeolian_saltation');

    if (voidCode === 1) {
      relictProcesses.push('lava_tube_inflation', 'effusive_basalt_volcanism');
    } else if (voidCode === 2) {
      relictProcesses.push('pit_collapse_karst');
    } else if (mafic >= 0.35) {
      relictProcesses.push('effusive_basalt_volcanism');
    } else if (clay >= 0.15) {
      relictProcesses.push('fluvial_deltaic_sedimentation');
    } else {
      relictProcesses.push('impact_shock_ejecta');
    }

    const silicaWtPctLn = safeLn(silicaWtPct, 1);
    const tiO2WtPctLn = safeLn(tiO2WtPct, 0.2);
    const wehLn = safeLn(weh, 0.2);
    const slopeMedLn = safeLn(slopeMed, 1);
    const p95SlopeLn = safeLn(p95Slope, 1);
    const regolithLn = safeLn(regolithThickness, 0.1);
    const iceTableDepthLn = iceTableDepthM !== null ? safeLn(iceTableDepthM, 0.1) : null;
    const tiLn = safeLn(ti, 1);
    const grainUmLn = safeLn(grainUm);
    const roadDistanceLn = safeLn(resolved.roadDistanceKm, 1);

    const item: GridCellCacheItem = {
      row,
      lat,
      lon,
      elevM,
      slopeMed,
      mafic,
      clay,
      weh,
      albedo,
      ndvi,
      isClassicRegion: isClassicFlag === 1,
      voidCode,
      qTemps,
      qPrecs,
      qClds,
      meanTempK,
      meanPrecip,
      permitTier: resolved.permitTier,
      iceTableDepthM,
      silicaWtPctLn,
      tiO2WtPctLn,
      sulfateIdx,
      carbonateIdx,
      wehLn,
      slopeMedLn,
      p95SlopeLn,
      rockCfa,
      cohesion,
      frictionAngle,
      regolithLn,
      iceTableDepthLn,
      sarDb,
      tiLn,
      visualAlienNonCryo,
      visualAlienCryo,
      roadDistanceLn,
      rfQuietness: resolved.rfQuietnessScore,
      logisticsFric,
      qDiurnal,
      qUvLn,
      qDensityLn,
      grainUmLn,
      qUStarLn,
      qGrazing,
      qClearSky,
      ilmenitePotential: Number(Math.min(0.92, tiO2WtPct / 4.2).toFixed(2)),
      feedstockSuitability: Number(Math.max(0.25, Math.min(0.94, 0.88 - clay * 1.1)).toFixed(2)),
      plumeHazard: Number(Math.max(0.18, Math.min(0.75, 0.32 + (1 - ndvi) * 0.15)).toFixed(2)),
      dtePct: absLat < 70 ? 92 : 76,
      tocWtPct: Number(
        Math.max(0.008, Math.min(1.6, ndvi * 1.45 + meanPrecip * 0.25 + (isIce ? 0.004 : 0.015))).toFixed(3)
      ),
      waterActivityAw: Number(Math.max(0.15, Math.min(0.9, 0.22 + meanPrecip * 1.2)).toFixed(2)),
      surfacePh: voidCode === 2 ? 7.9 : meanPrecip < 0.08 ? 7.4 : 6.7,
      preservationIdx: Number(Math.min(0.9, sulfateIdx * 0.6 + carbonateIdx * 0.5 + 0.22).toFixed(2)),
      voidSubterraneanDeltaT: voidCode === 1 ? 2.0 : 2.2,
      voidSkylightSlope: Number(Math.max(35, Math.min(75, slopeMed * 2.5 + 28)).toFixed(1)),
      activeProcesses,
      relictProcesses,
      guilds: isIce
        ? ['psychrophile', 'cryptoendolith']
        : meanPrecip < 0.07
          ? ['halophile', 'cryptoendolith']
          : ['chemoautotroph'],
    };
    items[i] = item;

    maficArr.push(mafic);
    silicaLnArr.push(silicaWtPctLn);
    tiO2LnArr.push(tiO2WtPctLn);
    clayArr.push(clay);
    sulfateArr.push(sulfateIdx);
    carbonateArr.push(carbonateIdx);
    wehLnArr.push(wehLn);
    slopeMedLnArr.push(slopeMedLn);
    p95SlopeLnArr.push(p95SlopeLn);
    cfaArr.push(rockCfa);
    cohesionArr.push(cohesion);
    frictionArr.push(frictionAngle);
    regolithLnArr.push(regolithLn);
    if (iceTableDepthLn !== null) iceLnArr.push(iceTableDepthLn);
    sarArr.push(sarDb);
    tiLnArr.push(tiLn);
    tMeanArr.push(meanTempK);
    diurnalArr.push(diurnalMean);
    albedoArr.push(albedo);
    uvLnArr.push(safeLn(uvMeanBase, 1));
    densityLnArr.push(safeLn(Math.max(0.01, meanDensity)));
    grainLnArr.push(grainUmLn);
    if (meanUStar !== null) uStarLnArr.push(safeLn(meanUStar, 0.05));
    roadLnArr.push(roadDistanceLn);
    rfArr.push(resolved.rfQuietnessScore);
    visualArr.push(visualAlienNonCryo);
    grazingArr.push(grazingMean);
    clearArr.push(meanClear);
    frictionLogArr.push(logisticsFric);
  }

  const stats: CatalogFeatureStats = {
    maficIndex: computeRobustStats(maficArr, 0.12),
    silicaWtPctLn: computeRobustStats(silicaLnArr, 0.12),
    tiO2WtPctLn: computeRobustStats(tiO2LnArr, 0.35),
    clayIndex: computeRobustStats(clayArr, 0.08),
    sulfateIndex: computeRobustStats(sulfateArr, 0.12),
    carbonateIndex: computeRobustStats(carbonateArr, 0.12),
    wehWtPctLn: computeRobustStats(wehLnArr, 0.4),

    medianSlopeDegLn: computeRobustStats(slopeMedLnArr, 0.5),
    p95SlopeDegLn: computeRobustStats(p95SlopeLnArr, 0.5),
    rockCfaK: computeRobustStats(cfaArr, 0.08),
    cohesionKpa: computeRobustStats(cohesionArr, 1.5),
    frictionAngleDeg: computeRobustStats(frictionArr, 4.0),
    regolithThicknessMLn: computeRobustStats(regolithLnArr, 0.6),
    iceTableDepthMLn: computeRobustStats(
      iceLnArr.length > 0 ? iceLnArr : [safeLn(0.35, 0.1), safeLn(1.5, 0.1)],
      0.7
    ),
    sarBackscatterDb: computeRobustStats(sarArr, 3.5),

    thermalInertiaLn: computeRobustStats(tiLnArr, 0.45),
    tMeanK: computeRobustStats(tMeanArr, 10.0),
    diurnalDeltaK: computeRobustStats(diurnalArr, 3.5),
    albedo: computeRobustStats(albedoArr, 0.08),
    uvAbFluxLn: computeRobustStats(uvLnArr, 0.35),

    ambientDensityLn: computeRobustStats(densityLnArr, 0.15),
    grainDiameterLn: computeRobustStats(grainLnArr, 0.45),
    thresholdVelLn: computeRobustStats(uStarLnArr, 0.15),

    roadDistanceLn: computeRobustStats(roadLnArr, 0.8),
    rfQuietness: computeRobustStats(rfArr, 0.18),
    visualAlienation: computeRobustStats(visualArr, 0.22),
    grazingSunHours: computeRobustStats(grazingArr, 0.6),
    clearSkyFraction: computeRobustStats(clearArr, 0.15),
    logisticsFriction: computeRobustStats(frictionLogArr, 0.22),
  };

  cachedGridSource = grid;
  cachedStats = stats;
  cachedCells = items;
  return { stats, items };
}

export function getGlobalGridStats(grid: GlobalDiscoveryGridFile): CatalogFeatureStats {
  return getPreparedGrid(grid).stats;
}

/**
 * Converts any 1.0° land grid cell from global_discovery_grid.json into a complete,
 * physics-consistent 12-month EarthAnalogSite ready for Stage-2 qualification.
 */
export function synthesizeSiteFromGridCell(row: number[]): EarthAnalogSite {
  const [
    lat,
    lon,
    elevM,
    slopeMed,
    mafic,
    clay,
    weh,
    albedo,
    ndvi,
    isClassicFlag,
    voidCode,
    q1T,
    q2T,
    q3T,
    q4T,
    q1P,
    q2P,
    q3P,
    q4P,
    q1Cld,
    q2Cld,
    q3Cld,
    q4Cld,
  ] = row;

  const qTemps: [number, number, number, number] = [q1T, q2T, q3T, q4T];
  const qPrecs: [number, number, number, number] = [q1P, q2P, q3P, q4P];
  const qClds: [number, number, number, number] = [q1Cld, q2Cld, q3Cld, q4Cld];

  const absLat = Math.abs(lat);
  const meanTempK = (q1T + q2T + q3T + q4T) / 4;
  const meanPrecip = (q1P + q2P + q3P + q4P) / 4;
  const isIce = meanTempK < 268.0 || (absLat > 64 && meanTempK < 271.5);
  const iceTableDepthM = isIce
    ? Number(Math.max(0.15, 0.25 + Math.max(0, meanTempK - 250) * 0.04).toFixed(2))
    : null;

  const resolved = resolveEarthRegion(lat, lon, voidCode);
  const voidType: VoidType = VOID_CODE_TO_TYPE[voidCode] ?? 'none';

  const pressureKpa = Number(
    (
      101.325 *
      Math.pow(
        Math.max(0.1, 1 - 2.25577e-5 * Math.min(8500, Math.max(-200, elevM))),
        5.25588
      )
    ).toFixed(2)
  );

  const monthly: MonthlyClimatologyBin[] = [];
  for (let m = 1; m <= 12; m++) {
    const tMeanK = Number(interpolateSeasonalQuarter(qTemps, m).toFixed(2));
    const pPrecipGt5Mm = Number(
      Math.max(0, Math.min(0.9, interpolateSeasonalQuarter(qPrecs, m))).toFixed(4)
    );
    const cldPct = Math.max(0, Math.min(100, interpolateSeasonalQuarter(qClds, m)));
    const clearSkyFraction = Number(Math.max(0, Math.min(1, 1 - cldPct / 100)).toFixed(3));
    const ambientDensityKgM3 = Number(
      ((pressureKpa * 1000) / (287.058 * Math.max(150, tMeanK))).toFixed(4)
    );
    const diurnalDeltaK = Number(
      Math.max(
        3.5,
        Math.min(22, 6.0 + 10.0 * clearSkyFraction + (elevM > 1500 ? 3.0 : 0) - pPrecipGt5Mm * 6.0)
      ).toFixed(2)
    );
    const doy = MID_MONTH_DOY[m - 1];
    const declDeg = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365.25);
    const solarScale = Math.max(0.08, Math.cos(((lat - declDeg) * Math.PI) / 180));
    const uvAbFluxWm2 = Number(
      Math.max(
        0.5,
        clearSkyFraction * (34 - absLat * 0.22) * (1 + Math.max(0, elevM) / 9000) * solarScale
      ).toFixed(2)
    );
    const grazingSunHoursPerDay = Number(
      computeEarthGrazingSunHoursPerDay(lat, m, clearSkyFraction).toFixed(3)
    );
    const snowDepthCm =
      tMeanK < 273.5
        ? Number(
            (
              (absLat > 64 ? 14 : 5) *
              Math.max(0.1, pPrecipGt5Mm * 4 + (tMeanK < 258 ? 0.5 : 0.1))
            ).toFixed(1)
          )
        : 0;
    const gwettop = Number(Math.max(0.03, Math.min(0.95, 0.08 + pPrecipGt5Mm * 1.15)).toFixed(3));
    const tStdK = Number((2.2 + absLat * 0.035).toFixed(2));

    monthly.push({
      month: m,
      tMeanK,
      tStdK,
      diurnalDeltaK,
      pPrecipGt5Mm,
      pressureKpa,
      ambientDensityKgM3,
      uvAbFluxWm2,
      clearSkyFraction,
      grazingSunHoursPerDay,
      snowDepthCm,
      gwettop,
    });
  }

  const silicaWtPct = Number(
    (voidCode === 2 ? 22.0 : voidCode === 1 ? 47.8 : Math.max(44, 62 - mafic * 28)).toFixed(1)
  );
  const tiO2WtPct = Number(
    (voidCode === 1 ? 2.4 : mafic >= 0.45 ? 1.8 : mafic >= 0.34 ? 1.1 : 0.55).toFixed(2)
  );
  const sulfateIndex = Number((meanPrecip < 0.06 && voidCode !== 2 ? 0.35 : 0.06).toFixed(2));
  const carbonateIndex = Number(
    (voidCode === 2 ? 0.72 : meanPrecip < 0.08 ? 0.14 : 0.05).toFixed(2)
  );
  const p95SlopeDeg = Number(Math.min(48, slopeMed * 2.25 + 2.5).toFixed(1));
  const rockCfaK = Number(
    Math.min(0.35, 0.03 + slopeMed * 0.008 + (voidCode === 1 ? 0.08 : 0)).toFixed(2)
  );
  const cohesionKpa = Number((isIce ? 4.2 : 0.6 + clay * 3.5).toFixed(1));
  const frictionAngleDeg = Number(Math.min(41, 29 + slopeMed * 0.32).toFixed(1));
  const regolithThicknessM = Number(
    (slopeMed > 15 ? 0.45 : voidCode === 1 ? 0.9 : 2.1).toFixed(2)
  );
  const sarBackscatterSigma0Db = Number(
    (-13.5 + slopeMed * 0.25 + (voidCode === 1 ? 2.8 : 0)).toFixed(1)
  );
  const apparentThermalInertia = Math.round(
    175 + slopeMed * 13 + (isIce ? 85 : 0) + (voidCode === 1 ? 90 : 0)
  );

  const permitBase =
    resolved.permitTier === 'open_public'
      ? 0.92
      : resolved.permitTier === 'regulated_research'
        ? 0.72
        : resolved.permitTier === 'protected_park'
          ? 0.45
          : 0.28;
  const logisticsFrictionIndex = Number(
    Math.max(0.1, permitBase - Math.min(0.25, resolved.roadDistanceKm / 120)).toFixed(2)
  );

  const activeProcesses: ProcessTag[] = [];
  const relictProcesses: ProcessTag[] = [];
  if (isIce) activeProcesses.push('cryogenic_sublimation_permafrost');
  if (meanPrecip < 0.1 && ndvi < 0.15) activeProcesses.push('aeolian_saltation');
  if (slopeMed > 8 && meanPrecip < 0.08) activeProcesses.push('dust_devils_storms');
  if (meanPrecip < 0.06 && albedo > 0.28) activeProcesses.push('evaporite_brine_precipitation');
  if (activeProcesses.length === 0) activeProcesses.push('aeolian_saltation');

  if (voidCode === 1) {
    relictProcesses.push('lava_tube_inflation', 'effusive_basalt_volcanism');
  } else if (voidCode === 2) {
    relictProcesses.push('pit_collapse_karst');
  } else if (mafic >= 0.35) {
    relictProcesses.push('effusive_basalt_volcanism');
  } else if (clay >= 0.15) {
    relictProcesses.push('fluvial_deltaic_sedimentation');
  } else {
    relictProcesses.push('impact_shock_ejecta');
  }

  const tocWtPct = Number(
    Math.max(0.008, Math.min(1.6, ndvi * 1.45 + meanPrecip * 0.25 + (isIce ? 0.004 : 0.015))).toFixed(3)
  );
  const guilds: ExtremophileGuild[] = isIce
    ? ['psychrophile', 'cryptoendolith']
    : meanPrecip < 0.07
      ? ['halophile', 'cryptoendolith']
      : ['chemoautotroph'];

  const simulantNearest =
    voidCode === 1
      ? 'MGS-1 / JSC-1A Basaltic Lava Flow Unit'
      : voidCode === 2
        ? 'Carbonate Karst Structural Surrogate'
        : isIce
          ? 'Cryogenic Permafrost & Ice-Cemented Regolith'
          : mafic >= 0.34
            ? 'Mafic Basaltic-Regolith Terrain Unit'
            : 'Continental Siliciclastic Regolith Unit';

  const earthCoBenefits =
    voidCode === 1
      ? 'Supports volcanic hazard monitoring, lava-tube aquifer mapping, and geothermal instrumentation.'
      : voidCode === 2
        ? 'Supports subterranean karst hydrology monitoring and collapse sinkhole stability mapping.'
        : isIce
          ? 'Tracks polar/alpine permafrost thaw dynamics and cryospheric mass-balance baselines.'
          : 'Contributes high-resolution aridity, dust-emission, and desert solar irradiance telemetry.';

  const dataLineage: DataLineageItem[] = [
    {
      domain: 'thermal',
      source: 'NASA POWER S3 Zarr MERRA-2 & SYN1DEG',
      detail: `Quarterly T2M interpolated 12-mo mean=${meanTempK.toFixed(1)} K, albedo=${albedo.toFixed(2)}`,
      resolutionOrPeriod: '0.5° × 0.625° / 20-yr climatology',
    },
    {
      domain: 'morphology',
      source: 'AWS Mapzen Terrarium 1° Prior (Coarse Regolith/CFA Estimates)',
      detail: `Elev=${elevM} m · medSlope=${slopeMed.toFixed(1)}° · p95=${p95SlopeDeg}° (geotechnical CFA/cohesion/regolith inferred as coarse 1° regional priors)`,
      resolutionOrPeriod: '1.0° global screening tier',
    },
    {
      domain: 'geochemistry',
      source:
        voidCode > 0
          ? 'WHYMAP WOKAM Karst & Volcanic Provinces + Elevation-Aridity'
          : 'Global Elevation-Aridity Mineralogy Prior',
      detail: `${resolved.lithologyNote} (Mafic=${mafic.toFixed(2)}, Clay=${clay.toFixed(2)}, WEH=${weh.toFixed(1)}%)`,
      resolutionOrPeriod: 'Coarse 1° prior — Probe Live for Macrostrat v2',
    },
    {
      domain: 'operations',
      source: 'NASA POWER PRECTOTCORR / SYN1DEG + Physiographic Permit Model',
      detail: `NDVI=${ndvi.toFixed(2)} · Permit=${resolved.permitTier} · Road~${resolved.roadDistanceKm} km`,
      resolutionOrPeriod: 'Global 1.0° screening tier',
    },
  ];

  const latTag = (lat >= 0 ? 'n' : 's') + Math.abs(lat).toFixed(0);
  const lonTag = (lon >= 0 ? 'e' : 'w') + Math.abs(lon).toFixed(0);

  return {
    id: `grid_${latTag}_${lonTag}`,
    name: resolved.name,
    region: resolved.region,
    country: resolved.country,
    lat,
    lon,
    elevationM: elevM,
    provenanceTier: 'global_screening_1deg',
    isClassicRegion: isClassicFlag === 1,
    permitTier: resolved.permitTier,
    geology: {
      maficIndex: mafic,
      silicaWtPct,
      tiO2WtPct,
      clayIndex: clay,
      sulfateIndex,
      carbonateIndex,
      waterEquivalentHydrogenWtPct: weh,
      simulantNearest,
      macrostratLithology: resolved.lithologyNote,
    },
    morphology: {
      medianSlopeDeg: slopeMed,
      p95SlopeDeg,
      dtmResolutionM: 90,
      rockCfaK,
      cohesionKpa,
      frictionAngleDeg,
      regolithThicknessM,
      iceTableDepthM,
      sarBackscatterSigma0Db,
    },
    thermalStatic: {
      apparentThermalInertia,
      albedo,
    },
    aeolianStatic: {
      medianGrainDiameterUm: slopeMed > 12 || voidCode === 1 ? 240 : 145,
      particleDensityKgM3: mafic >= 0.4 ? 2880 : 2650,
    },
    operationsStatic: {
      roadDistanceKm: resolved.roadDistanceKm,
      rfQuietnessScore: resolved.rfQuietnessScore,
      ndvi,
      ndwi: -0.35,
      ndsi: meanTempK < 267 ? 0.45 : 0.0,
      logisticsFrictionIndex,
    },
    monthly,
    voidProfile:
      voidType !== 'none'
        ? {
            voidType,
            overburdenThicknessM: voidCode === 1 ? 22 : 32,
            voidSpanWidthM: voidCode === 1 ? 42 : 36,
            ceilingHeightM: voidCode === 1 ? 22 : 20,
            skylightAccessSlopeDeg: Number(
              Math.max(35, Math.min(75, slopeMed * 2.5 + 28)).toFixed(1)
            ),
            subterraneanDeltaTK: voidCode === 1 ? 2.0 : 2.2,
          }
        : {
            voidType: 'none',
            overburdenThicknessM: null,
            voidSpanWidthM: null,
            ceilingHeightM: null,
            skylightAccessSlopeDeg: null,
            subterraneanDeltaTK: null,
          },
    isruProfile: {
      ilmeniteO2YieldPotential: Number(Math.min(0.92, tiO2WtPct / 4.2).toFixed(2)),
      constructionFeedstockSuitability: Number(
        Math.max(0.25, Math.min(0.94, 0.88 - clay * 1.1)).toFixed(2)
      ),
      landingPlumeDustHazard: Number(
        Math.max(0.18, Math.min(0.75, 0.32 + (1 - ndvi) * 0.15)).toFixed(2)
      ),
      directToEarthVisibilityPct: absLat < 70 ? 92 : 76,
    },
    astrobiology: {
      tocWtPct,
      waterActivityAw: Number(Math.max(0.15, Math.min(0.9, 0.22 + meanPrecip * 1.2)).toFixed(2)),
      surfacePh: voidCode === 2 ? 7.9 : meanPrecip < 0.08 ? 7.4 : 6.7,
      biosignaturePreservationIndex: Number(
        Math.min(0.9, sulfateIndex * 0.6 + carbonateIndex * 0.5 + 0.22).toFixed(2)
      ),
      extremophileGuilds: guilds,
    },
    activeProcesses,
    relictProcesses,
    earthCoBenefits,
    dataLineage,
    citations: [
      'AWS Mapzen Terrarium z=3 Global Elevation Model',
      'NASA POWER S3 Zarr Climatology (MERRA-2 & SYN1DEG)',
      'WHYMAP WOKAM Karst & Volcanic Provinces (Geotechnical metrics inferred as 1° regional priors)',
    ],
  };
}

interface ScreenedCandidateInternal {
  item: GridCellCacheItem;
  discovery: DiscoveryCellResult;
  geoScore: number;
  morphScore: number;
}

function makeZPrep(targetVal: number | null, stats: RobustFeatureStats): {
  valid: boolean;
  zTarget: number;
  invScale: number;
  median: number;
} {
  if (targetVal === null || !Number.isFinite(targetVal)) {
    return { valid: false, zTarget: 0, invScale: 1, median: 0 };
  }
  const scale = Math.max(1e-4, stats.scaledIqr);
  const invScale = 1 / scale;
  return {
    valid: true,
    zTarget: (targetVal - stats.median) * invScale,
    invScale,
    median: stats.median,
  };
}

function residualSq(
  prep: { valid: boolean; zTarget: number; invScale: number; median: number },
  candVal: number | null,
  asymmetricLambda = 1.0,
  breachCondition = false
): number {
  if (!prep.valid || candVal === null || !Number.isFinite(candVal)) return -1;
  let deltaZ = (candVal - prep.median) * prep.invScale - prep.zTarget;
  if (breachCondition && asymmetricLambda > 1) {
    const mag = Math.max(0.5, Math.abs(deltaZ));
    deltaZ = Math.sign(deltaZ || 1) * mag * asymmetricLambda;
  }
  return deltaZ * deltaZ;
}

function computeProcessParityScore(
  tActiveSet: Set<ProcessTag>,
  tRelictSet: Set<ProcessTag>,
  maxPossibleWeight: number,
  sActive: ProcessTag[],
  sRelict: ProcessTag[]
): number {
  if (tActiveSet.size + tRelictSet.size === 0) return 50;
  let earned = 0;
  for (const p of tActiveSet) {
    if (sActive.includes(p)) earned += 1.0;
    else if (sRelict.includes(p)) earned += 0.6;
  }
  for (const p of tRelictSet) {
    if (sRelict.includes(p)) earned += 0.8;
    else if (sActive.includes(p)) earned += 0.7;
  }
  return Math.max(0, Math.min(100, (earned / Math.max(1e-6, maxPossibleWeight)) * 100));
}

function screenAllEarthCellsStage1(
  target: CelestialTarget,
  config: MissionConfig,
  prepared: { stats: CatalogFeatureStats; items: GridCellCacheItem[] }
): ScreenedCandidateInternal[] {
  const { stats, items } = prepared;
  const ephemeris = computeEphemerisState(target, config.epochDateIso);
  const w = config.domainWeights;
  const isVoidMode =
    config.presetId === 'subsurface_void' || target.isSubsurfaceVoidTarget;
  const isIsruMode =
    config.presetId === 'moon_base_isru' || target.isPermanentBaseCandidate;
  const permitSet =
    config.allowedPermitTiers.length > 0 ? new Set(config.allowedPermitTiers) : null;
  const maxSlope = config.maxSlopeFilterDeg;
  const isHyperAridTarget =
    target.isAnhydrousRegolith ||
    (target.geology.waterEquivalentHydrogenWtPct < 2.0 &&
      !target.requiresCryogenicIce &&
      target.operationsIdeal.clearSkyFraction >= 0.7);
  const hydroWeight =
    target.isAnhydrousRegolith ||
    (target.geology.waterEquivalentHydrogenWtPct < 3.0 && !target.requiresCryogenicIce)
      ? 1.0
      : 0.4;

  // Precompute target Z-scores once across all 17,768 cells (Stage-2 dimension parity)
  const pMafic = makeZPrep(target.geology.maficIndex, stats.maficIndex);
  const pSilica = makeZPrep(safeLn(target.geology.silicaWtPct, 1), stats.silicaWtPctLn);
  const pTiO2 = makeZPrep(safeLn(target.geology.tiO2WtPct, 0.2), stats.tiO2WtPctLn);
  const wTiO2 = target.body === 'moon' ? 1.2 : 0.7;
  const pClay = makeZPrep(target.geology.clayIndex, stats.clayIndex);
  const pSulfate = makeZPrep(target.geology.sulfateIndex, stats.sulfateIndex);
  const pCard = makeZPrep(target.geology.carbonateIndex, stats.carbonateIndex);
  const pWeh = makeZPrep(safeLn(target.geology.waterEquivalentHydrogenWtPct, 0.2), stats.wehWtPctLn);
  const wWeh = target.requiresCryogenicIce ? 1.4 : 0.8;

  const pSlopeMed = makeZPrep(safeLn(target.morphology.medianSlopeDeg, 1), stats.medianSlopeDegLn);
  const pP95Slope = makeZPrep(safeLn(target.morphology.p95SlopeDeg, 1), stats.p95SlopeDegLn);
  const pCfa = makeZPrep(target.morphology.rockCfaK, stats.rockCfaK);
  const pCoh = makeZPrep(target.morphology.cohesionKpa, stats.cohesionKpa);
  const pFric = makeZPrep(target.morphology.frictionAngleDeg, stats.frictionAngleDeg);
  const pReg = makeZPrep(
    target.morphology.regolithThicknessM !== null ? safeLn(target.morphology.regolithThicknessM, 0.1) : null,
    stats.regolithThicknessMLn
  );
  const iceTarget = target.requiresCryogenicIce ? (target.morphology.iceTableDepthM ?? 0.2) : null;
  const pIce = makeZPrep(iceTarget !== null ? safeLn(iceTarget, 0.1) : null, stats.iceTableDepthMLn);
  const pSar = makeZPrep(target.morphology.sarBackscatterSigma0Db, stats.sarBackscatterDb);

  const pTi = makeZPrep(safeLn(target.thermalBase.apparentThermalInertia, 1), stats.thermalInertiaLn);
  const pTmean = makeZPrep(ephemeris.targetEffectiveTempK, stats.tMeanK);
  const pDiurnal = makeZPrep(target.thermalBase.diurnalDeltaK, stats.diurnalDeltaK);
  const pAlbedo = makeZPrep(target.thermalBase.albedo, stats.albedo);
  const pUv = makeZPrep(safeLn(target.thermalBase.uvAbFluxWm2, 1), stats.uvAbFluxLn);

  const pDens = !target.isVacuumRegime
    ? makeZPrep(safeLn(Math.max(0.005, ephemeris.targetEffectiveDensityKgM3)), stats.ambientDensityLn)
    : null;
  const pGrain = !target.isVacuumRegime
    ? makeZPrep(safeLn(target.atmosphericBase.medianGrainDiameterUm), stats.grainDiameterLn)
    : null;
  const pUStar = !target.isVacuumRegime
    ? makeZPrep(
        ephemeris.targetEffectiveThresholdVelMs !== null
          ? safeLn(ephemeris.targetEffectiveThresholdVelMs, 0.05)
          : null,
        stats.thresholdVelLn
      )
    : null;

  const pRoad = makeZPrep(safeLn(target.operationsIdeal.roadDistanceKm, 1), stats.roadDistanceLn);
  const pRf = makeZPrep(target.operationsIdeal.rfQuietnessScore, stats.rfQuietness);
  const pVis = makeZPrep(target.operationsIdeal.visualAlienation, stats.visualAlienation);
  const pGraz = makeZPrep(target.operationsIdeal.grazingSunHoursPerDay, stats.grazingSunHours);
  const wGraz = target.operationsIdeal.grazingSunHoursPerDay > 2.5 ? 1.3 : 0.7;
  const pClr = makeZPrep(target.operationsIdeal.clearSkyFraction, stats.clearSkyFraction);
  const pLog = makeZPrep(target.operationsIdeal.logisticsFrictionIndex, stats.logisticsFriction);

  // Void, ISRU, Astrobiology & Process precomputation
  const tv = target.voidProfile;
  const tiReq = target.isruRequirements;
  const ilmeniteTarget = tiReq?.ilmeniteO2YieldPotential ?? 0.5;
  const tBio = target.astrobiologyTarget;
  const tGuilds = tBio?.targetGuilds ?? [];
  const tActiveSet = new Set<ProcessTag>(target.activeProcesses);
  const tRelictSet = new Set<ProcessTag>(target.relictProcesses);
  const maxProcessWeight = tActiveSet.size * 1.0 + tRelictSet.size * 0.8;

  const wGeochem = Math.max(0, w.geochemistry);
  const wMorph = Math.max(0, w.morphology);
  const wTherm = Math.max(0, w.thermal);
  const wAtmos = target.isVacuumRegime ? 0 : Math.max(0, w.atmospheric);
  const wOps = Math.max(0, w.operations);
  const wDomainSum = Math.max(1e-9, wGeochem + wMorph + wTherm + wAtmos + wOps);

  const out: ScreenedCandidateInternal[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (permitSet && !permitSet.has(it.permitTier)) continue;
    if (maxSlope !== undefined && it.slopeMed > maxSlope) continue;

    // --- Domain 1: 7 dims ---
    let d1Sq = 0;
    let d1Peff = 0;
    let r = residualSq(pMafic, it.mafic);
    if (r >= 0) { d1Sq += 1.4 * r; d1Peff += 1.4; }
    r = residualSq(pSilica, it.silicaWtPctLn);
    if (r >= 0) { d1Sq += 1.1 * r; d1Peff += 1.1; }
    r = residualSq(pTiO2, it.tiO2WtPctLn);
    if (r >= 0) { d1Sq += wTiO2 * r; d1Peff += wTiO2; }
    r = residualSq(pClay, it.clay, 3.0, target.isAnhydrousRegolith && it.clay > 0.05);
    if (r >= 0) { d1Sq += 1.1 * r; d1Peff += 1.1; }
    r = residualSq(pSulfate, it.sulfateIdx);
    if (r >= 0) { d1Sq += 0.9 * r; d1Peff += 0.9; }
    r = residualSq(pCard, it.carbonateIdx);
    if (r >= 0) { d1Sq += 1.0 * r; d1Peff += 1.0; }
    r = residualSq(pWeh, it.wehLn);
    if (r >= 0) { d1Sq += wWeh * r; d1Peff += wWeh; }
    const sGeo = studentTKernel(d1Sq, d1Peff, 2.0);

    // --- Domain 2: 8 dims ---
    let d2Sq = 0;
    let d2Peff = 0;
    r = residualSq(pSlopeMed, it.slopeMedLn);
    if (r >= 0) { d2Sq += 1.5 * r; d2Peff += 1.5; }
    r = residualSq(pP95Slope, it.p95SlopeLn);
    if (r >= 0) { d2Sq += 1.3 * r; d2Peff += 1.3; }
    r = residualSq(pCfa, it.rockCfa);
    if (r >= 0) { d2Sq += 1.1 * r; d2Peff += 1.1; }
    r = residualSq(pCoh, it.cohesion);
    if (r >= 0) { d2Sq += 0.8 * r; d2Peff += 0.8; }
    r = residualSq(pFric, it.frictionAngle);
    if (r >= 0) { d2Sq += 0.8 * r; d2Peff += 0.8; }
    r = residualSq(pReg, it.regolithLn);
    if (r >= 0) { d2Sq += 0.9 * r; d2Peff += 0.9; }
    if (target.requiresCryogenicIce) {
      const iceCandLn = it.iceTableDepthLn !== null ? it.iceTableDepthLn : safeLn(50.0, 0.1);
      r = residualSq(pIce, iceCandLn, 2.2, it.iceTableDepthM === null);
      if (r >= 0) { d2Sq += 1.8 * r; d2Peff += 1.8; }
    }
    r = residualSq(pSar, it.sarDb);
    if (r >= 0) { d2Sq += 0.8 * r; d2Peff += 0.8; }
    const sMorph = studentTKernel(d2Sq, d2Peff, 2.0);

    // Static D3 albedo & thermal inertia parts
    const rTi = residualSq(pTi, it.tiLn);
    const rAlb = residualSq(pAlbedo, it.albedo);
    const d3StaticSq = (rTi >= 0 ? 1.0 * rTi : 0) + (rAlb >= 0 ? 0.9 * rAlb : 0);
    const d3StaticPeff = (rTi >= 0 ? 1.0 : 0) + (rAlb >= 0 ? 0.9 : 0);

    // Static D5 road, rfQuietness, visualAlienation, logistics parts
    const visualAlien = target.requiresCryogenicIce ? it.visualAlienCryo : it.visualAlienNonCryo;
    const rRoad = residualSq(pRoad, it.roadDistanceLn);
    const rRf = residualSq(pRf, it.rfQuietness);
    const rVis = residualSq(pVis, visualAlien, 2.5, visualAlien < 0.4);
    const rLog = residualSq(pLog, it.logisticsFric);
    const d5StaticSq =
      (rRoad >= 0 ? 0.7 * rRoad : 0) +
      (rRf >= 0 ? 0.9 * rRf : 0) +
      (rVis >= 0 ? 1.6 * rVis : 0) +
      (rLog >= 0 ? 0.8 * rLog : 0);
    const d5StaticPeff =
      (rRoad >= 0 ? 0.7 : 0) +
      (rRf >= 0 ? 0.9 : 0) +
      (rVis >= 0 ? 1.6 : 0) +
      (rLog >= 0 ? 0.8 : 0);

    const hasSubterraneanDeltaT = isVoidMode && it.voidCode !== 0;

    // Layer B / C parity scores (static per cell for this target)
    let voidScore = 0;
    if (isVoidMode) {
      if (it.voidCode === 0) {
        voidScore = 5;
      } else {
        const svType: VoidType = VOID_CODE_TO_TYPE[it.voidCode] ?? 'none';
        const targetType = tv?.voidType ?? 'lava_tube';
        let typeScore = 60;
        if (svType === targetType) typeScore = 100;
        else if (
          (targetType === 'lava_tube' && (svType === 'karst_cave' || svType === 'impact_melt_pit'))
        ) {
          typeScore = 76;
        } else if (svType === 'mine_shaft') {
          typeScore = 64;
        }
        const overM = it.voidCode === 1 ? 22 : 32;
        const spanM = it.voidCode === 1 ? 42 : 36;
        const ceilM = it.voidCode === 1 ? 22 : 20;
        const geomMean =
          0.25 * relProxScore(tv?.overburdenThicknessM ?? 25, overM, 20) +
          0.25 * relProxScore(tv?.voidSpanWidthM ?? 40, spanM, 30) +
          0.15 * relProxScore(tv?.ceilingHeightM ?? 20, ceilM, 15) +
          0.15 * relProxScore(tv?.skylightAccessSlopeDeg ?? 45, it.voidSkylightSlope, 25) +
          0.20 * Math.max(0, Math.min(100, 100 - Math.max(0, it.voidSubterraneanDeltaT - 2.0) * 10));
        voidScore = Math.max(0, Math.min(100, 0.52 * typeScore + 0.48 * geomMean));
      }
    }

    let isruScore = 0;
    if (isIsruMode) {
      const ilmeniteMatch =
        ilmeniteTarget > 0.4
          ? Math.max(0, Math.min(100, 100 - Math.abs(it.ilmenitePotential - ilmeniteTarget) * 110))
          : Math.max(45, 100 - Math.abs(it.ilmenitePotential - ilmeniteTarget) * 60);
      isruScore = Math.max(
        0,
        Math.min(
          100,
          0.28 * ilmeniteMatch +
            0.36 * (it.feedstockSuitability * 100) +
            0.20 * ((1 - it.plumeHazard) * 100) +
            0.16 * it.dtePct
        )
      );
    }

    let astroScore = 100;
    if (config.astrobiologyMode === 'clean_instrument_test') {
      astroScore = Math.max(5, Math.min(100, 100 * Math.exp(-it.tocWtPct * 3.5)));
    } else if (config.astrobiologyMode === 'biosignature_habitability_analog') {
      let matched = 0;
      for (const g of it.guilds) {
        if (tGuilds.includes(g)) matched++;
      }
      const guildScore = tGuilds.length > 0 ? (matched / tGuilds.length) * 100 : 60;
      let chemScore = 70;
      if (tBio?.surfacePh !== null && tBio?.surfacePh !== undefined) {
        chemScore = Math.max(0, 100 - Math.abs(it.surfacePh - tBio.surfacePh) * 18);
      }
      if (tBio?.waterActivityAw !== null && tBio?.waterActivityAw !== undefined) {
        chemScore =
          0.5 * chemScore +
          0.5 * Math.max(0, 100 - Math.abs(it.waterActivityAw - tBio.waterActivityAw) * 120);
      }
      astroScore = Math.max(
        0,
        Math.min(100, 0.45 * (it.preservationIdx * 100) + 0.35 * guildScore + 0.20 * chemScore)
      );
    }

    const processScore = computeProcessParityScore(
      tActiveSet,
      tRelictSet,
      maxProcessWeight,
      it.activeProcesses,
      it.relictProcesses
    );

    let bestLayerAScore = -1;
    let bestQuarter = 1;
    const qLayerAScores = [0, 0, 0, 0];

    for (let q = 0; q < 4; q++) {
      // Domain 3: 5 dims
      let d3Sq = d3StaticSq;
      let d3Peff = d3StaticPeff;
      r = residualSq(pTmean, it.qTemps[q]);
      if (r >= 0) { d3Sq += 1.3 * r; d3Peff += 1.3; }
      const effDiurnal = hasSubterraneanDeltaT ? it.voidSubterraneanDeltaT : it.qDiurnal[q];
      r = residualSq(pDiurnal, effDiurnal);
      if (r >= 0) { d3Sq += 1.0 * r; d3Peff += 1.0; }
      r = residualSq(pUv, it.qUvLn[q]);
      if (r >= 0) { d3Sq += 0.8 * r; d3Peff += 0.8; }
      const sTherm = studentTKernel(d3Sq, d3Peff, 2.0);

      // Domain 4: 3 dims (skipped on vacuum lunar targets)
      let sAtmos = 100;
      if (!target.isVacuumRegime) {
        let d4Sq = 0;
        let d4Peff = 0;
        r = residualSq(pDens!, it.qDensityLn[q]);
        if (r >= 0) { d4Sq += 1.1 * r; d4Peff += 1.1; }
        r = residualSq(pGrain!, it.grainUmLn);
        if (r >= 0) { d4Sq += 1.2 * r; d4Peff += 1.2; }
        r = residualSq(pUStar!, it.qUStarLn[q]);
        if (r >= 0) { d4Sq += 1.0 * r; d4Peff += 1.0; }
        sAtmos = studentTKernel(d4Sq, d4Peff, 2.0);
      }

      // Domain 5: 6 dims
      const clr = it.qClearSky[q];
      let d5Sq = d5StaticSq;
      let d5Peff = d5StaticPeff;
      r = residualSq(pGraz, it.qGrazing[q]);
      if (r >= 0) { d5Sq += wGraz * r; d5Peff += wGraz; }
      r = residualSq(pClr, clr, 2.5, isHyperAridTarget && it.qPrecs[q] > 0.15);
      if (r >= 0) { d5Sq += 1.2 * r; d5Peff += 1.2; }
      const sOps = studentTKernel(d5Sq, d5Peff, 2.0);

      const qLayerA =
        (wGeochem * sGeo + wMorph * sMorph + wTherm * sTherm + wAtmos * sAtmos + wOps * sOps) /
        wDomainSum;
      const rainCliffPenalty =
        it.qPrecs[q] > 0.12 ? 18 * hydroWeight * Math.min(1, (it.qPrecs[q] - 0.12) / 0.5) : 0;
      const netQ = Math.max(0, qLayerA - rainCliffPenalty);
      qLayerAScores[q] = netQ;

      if (netQ > bestLayerAScore) {
        bestLayerAScore = netQ;
        bestQuarter = q + 1;
      }
    }

    // Account for modest seasonal downside variance in window score (aligned with temporal optimizer)
    const meanQ = (qLayerAScores[0] + qLayerAScores[1] + qLayerAScores[2] + qLayerAScores[3]) / 4;
    const driftPenalty = Math.max(0, (bestLayerAScore - meanQ) * 0.25);
    const windowedLayerA = Math.max(0, bestLayerAScore - driftPenalty);

    const total = blendWithLayersBAndC(
      windowedLayerA,
      voidScore,
      isVoidMode,
      isruScore,
      isIsruMode,
      astroScore,
      config.astrobiologyMode as AstrobiologyMode,
      processScore,
      config.presetId
    );

    out.push({
      item: it,
      geoScore: sGeo,
      morphScore: sMorph,
      discovery: {
        lat: it.lat,
        lon: it.lon,
        elevationM: it.elevM,
        isClassicRegion: it.isClassicRegion,
        voidTypeCode: it.voidCode,
        scorePct: Math.round(total * 10) / 10,
        bestQuarter,
      },
    });
  }

  out.sort((a, b) => b.discovery.scorePct - a.discovery.scorePct);
  return out;
}

/**
 * Selects spatially diverse regional peaks across all continents via Greedy Spatial NMS
 * plus domain-specialist candidates so Stage-2 qualification & 2-site splits discover
 * globally complementary analogs across all 17,768 cells.
 */
function selectSpatialNmsPool(
  sorted: ScreenedCandidateInternal[],
  targetCount = 100,
  minSepKm = 420,
  maxSpecialists = 12
): GridCellCacheItem[] {
  const chosen: GridCellCacheItem[] = [];

  const canAdd = (cand: GridCellCacheItem, radiusKm: number): boolean => {
    for (let i = 0; i < chosen.length; i++) {
      if (haversineEarthKm(cand.lat, cand.lon, chosen[i].lat, chosen[i].lon) < radiusKm) {
        return false;
      }
    }
    return true;
  };

  for (let i = 0; i < sorted.length && chosen.length < targetCount; i++) {
    const it = sorted[i].item;
    if (canAdd(it, minSepKm)) {
      chosen.push(it);
    }
  }

  if (chosen.length < targetCount) {
    const relaxedRadius = Math.max(110, Math.round(minSepKm * 0.55));
    for (let i = 0; i < sorted.length && chosen.length < targetCount; i++) {
      const it = sorted[i].item;
      if (canAdd(it, relaxedRadius)) {
        chosen.push(it);
      }
    }
  }

  if (chosen.length < Math.min(targetCount, sorted.length)) {
    for (let i = 0; i < sorted.length && chosen.length < targetCount; i++) {
      const it = sorted[i].item;
      if (canAdd(it, 60)) {
        chosen.push(it);
      }
    }
  }

  const topGeo = [...sorted]
    .sort((a, b) => b.geoScore - a.geoScore)
    .slice(0, 80);
  const topMorph = [...sorted]
    .sort((a, b) => b.morphScore - a.morphScore)
    .slice(0, 80);

  let addedSpec = 0;
  for (const s of [...topGeo, ...topMorph]) {
    if (addedSpec >= maxSpecialists) break;
    if (canAdd(s.item, Math.max(160, Math.round(minSepKm * 0.75)))) {
      chosen.push(s.item);
      addedSpec++;
    }
  }

  return chosen;
}

/**
 * Full-Earth Analog Discovery & Qualification for a single celestial target.
 * Screens ALL 17,768 grid cells, selects Top-100 (or Top-250 in broad search) diverse Earth provinces,
 * augments them non-destructively with any live NASA/DEM/Macrostrat telemetry patches,
 * and runs full 365-day physics, sensitivity & 2-site portfolio qualification.
 */
export function evaluateTargetAcrossGlobe(
  target: CelestialTarget,
  probedSites: EarthAnalogSite[],
  config: MissionConfig,
  grid: GlobalDiscoveryGridFile,
  livePatches: Record<string, LiveTelemetryPatch> = {}
): {
  dossier: TargetEvaluationDossier;
  discoveryCells: DiscoveryCellResult[];
} {
  const t0 = performance.now();
  const prepared = getPreparedGrid(grid);
  const override = config.targetOverrides?.[target.id];
  const effectiveConfig: MissionConfig = override
    ? {
        ...config,
        presetId: override.presetId,
        domainWeights: override.domainWeights,
        astrobiologyMode: override.astrobiologyMode,
      }
    : config;

  // Stage 1: Screen all 17,768 Earth land locations (strictly aligned with Stage-2 dims & pre-filters)
  const screened = screenAllEarthCellsStage1(target, effectiveConfig, prepared);
  const isBroad = config.searchScope === 'broad_250';
  const nmsCells = isBroad
    ? selectSpatialNmsPool(screened, 250, 180, 20)
    : selectSpatialNmsPool(screened, 100, 420, 12);

  const permitSet =
    effectiveConfig.allowedPermitTiers.length > 0
      ? new Set(effectiveConfig.allowedPermitTiers)
      : null;
  const maxSlope = effectiveConfig.maxSlopeFilterDeg;
  const eligibleProbed = probedSites.filter(
    (s) =>
      (!permitSet || permitSet.has(s.permitTier)) &&
      (maxSlope === undefined || s.morphology.medianSlopeDeg <= maxSlope)
  );

  // Merge user-pinned Tier-2 probes (superseding grid cells within 55 km) and
  // non-destructively augment shortlisted grid candidates with live NASA/DEM patches
  const synthesizedGridSites: EarthAnalogSite[] = [];
  for (const cell of nmsCells) {
    const superseded = eligibleProbed.some(
      (ps) => haversineEarthKm(ps.lat, ps.lon, cell.lat, cell.lon) <= 55
    );
    if (!superseded) {
      let site = synthesizeSiteFromGridCell(cell.row);
      const patch = livePatches[makeLiveCoordKey(site.lat, site.lon)];
      if (patch) {
        site = applyLivePatchToSite(site, patch);
      }
      synthesizedGridSites.push(site);
    }
  }

  const stage2Pool = [...eligibleProbed, ...synthesizedGridSites];

  // Stage 2: Full physics, 365-day window, +-15% sensitivity, deficits & 2-site split
  const dossier = evaluateTargetIsolated(
    target,
    stage2Pool,
    effectiveConfig,
    prepared.stats
  );
  dossier.totalLocationsScreened = grid.cells.length;
  dossier.qualifiedLocationsCount = screened.length;
  dossier.evaluationMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    dossier,
    discoveryCells: screened.map((s) => s.discovery),
  };
}

/**
 * Evaluates the FULL union of shortlisted sites across multiple targets strictly for
 * CrossTargetMatrix and Multi-Target 2-Site Split without altering per-target dossiers
 * (preserves strict Zero-Averaging Invariant on each target's rankedCandidates and removes
 * partial-union ?? 0 / rank 99 distortions).
 */
function buildUnionCrossEvalDossiers(
  dossiers: TargetEvaluationDossier[],
  config: MissionConfig,
  stats: CatalogFeatureStats
): TargetEvaluationDossier[] {
  if (dossiers.length < 2) return dossiers;

  const unionSiteMap = new Map<string, EarthAnalogSite>();
  for (const d of dossiers) {
    for (const c of d.rankedCandidates) {
      if (!unionSiteMap.has(c.site.id)) {
        unionSiteMap.set(c.site.id, c.site);
      }
    }
    if (d.portfolio) {
      unionSiteMap.set(d.portfolio.siteA.id, d.portfolio.siteA);
      unionSiteMap.set(d.portfolio.siteB.id, d.portfolio.siteB);
    }
  }
  const unionSites = Array.from(unionSiteMap.values());

  return dossiers.map((d) => {
    const existingById = new Map<string, CandidateEvaluation>(
      d.rankedCandidates.map((c) => [c.site.id, c])
    );

    const override = config.targetOverrides?.[d.target.id];
    const effectiveConfig: MissionConfig = override
      ? {
          ...config,
          presetId: override.presetId,
          domainWeights: override.domainWeights,
          astrobiologyMode: override.astrobiologyMode,
        }
      : config;

    const maxOverall = Math.max(
      1e-6,
      d.rankedCandidates[0]?.missionFitPct ?? 1e-6
    );
    const domainMaxes: Record<DomainKey, number> = {
      geochemistry: 1e-6,
      morphology: 1e-6,
      thermal: 1e-6,
      atmospheric: 1e-6,
      operations: 1e-6,
    };
    for (const k of DOMAIN_KEYS) {
      for (const c of d.rankedCandidates) {
        if (c.domainScores[k].scorePct > domainMaxes[k]) {
          domainMaxes[k] = c.domainScores[k].scorePct;
        }
      }
    }

    const supplemented: CandidateEvaluation[] = [];
    for (const site of unionSites) {
      const existing = existingById.get(site.id);
      if (existing) {
        supplemented.push({ ...existing });
        continue;
      }

      const res = evaluateCandidateScoreOnly(
        d.target,
        site,
        d.ephemeris,
        stats,
        effectiveConfig.domainWeights,
        effectiveConfig
      );
      const bestMonthIdx = Math.max(
        0,
        Math.min(11, Math.floor(((res.windowResult.bestStartDayOfYear - 1) / 365) * 12))
      );
      const repMd = res.monthlyDomains[bestMonthIdx];
      const domainScores = {} as Record<DomainKey, DomainScoreDetail>;
      for (const k of DOMAIN_KEYS) {
        domainScores[k] = {
          ...repMd[k],
          scorePct: Math.round(repMd[k].scorePct * 10) / 10,
          frontierPct: Math.round(computeFrontierPct(repMd[k].scorePct, domainMaxes[k]) * 10) / 10,
        };
      }
      const { deficits, hardwareSpecs } = computeDeficitsAndHardwareSpecs(
        d.target,
        site,
        d.ephemeris,
        res.windowResult.bestStartDayOfYear
      );
      const narrative = buildCandidateNarrative(
        d.target,
        site,
        domainScores,
        res.voidEval.active,
        res.voidEval.scorePct,
        res.isruEval.active,
        res.isruEval.scorePct,
        res.processEval.classification,
        res.windowResult.rainExceedanceProb,
        hardwareSpecs.thermalGapK
      );

      supplemented.push({
        site,
        targetId: d.target.id,
        missionFitPct: Math.round(res.missionFitPct * 10) / 10,
        earthFrontierPct:
          Math.round(computeFrontierPct(res.missionFitPct, maxOverall) * 10) / 10,
        baseWindowMeanPct: Math.round(res.windowResult.windowMeanPct * 10) / 10,
        downsideDriftPenalty: Math.round(res.windowResult.driftPenalty * 10) / 10,
        rainCliffPenalty: Math.round(res.windowResult.rainCliffPenalty * 10) / 10,
        rainExceedanceProb: Math.round(res.windowResult.rainExceedanceProb * 1000) / 1000,
        bestStartDayOfYear: res.windowResult.bestStartDayOfYear,
        monthlyScores: res.monthlyScores.map((s) => Math.round(s * 10) / 10),
        domainScores,
        voidEval: {
          ...res.voidEval,
          scorePct: Math.round(res.voidEval.scorePct * 10) / 10,
        },
        isruEval: {
          ...res.isruEval,
          scorePct: Math.round(res.isruEval.scorePct * 10) / 10,
        },
        astrobiologyEval: {
          ...res.astroEval,
          scorePct: Math.round(res.astroEval.scorePct * 10) / 10,
        },
        processEval: res.processEval,
        sensitivityRange: [
          Math.round(res.missionFitPct * 10) / 10,
          Math.round(res.missionFitPct * 10) / 10,
        ],
        top3RobustnessPct: d.top3RobustnessPct,
        deficits,
        hardwareSpecs,
        narrative,
        rank: 0,
      });
    }

    supplemented.sort((a, b) => b.missionFitPct - a.missionFitPct);
    for (let i = 0; i < supplemented.length; i++) {
      supplemented[i].rank = i + 1;
    }

    return {
      ...d,
      rankedCandidates: supplemented,
    };
  });
}

export function evaluateAllTargetsGlobally(
  targets: CelestialTarget[],
  probedSites: EarthAnalogSite[],
  config: MissionConfig,
  grid: GlobalDiscoveryGridFile,
  livePatches: Record<string, LiveTelemetryPatch> = {}
): {
  dossiers: TargetEvaluationDossier[];
  crossTargetMatrix: CrossTargetMatrix | null;
  multiTargetPortfolio: MultiTargetTwoSitePortfolioResult | null;
  discoveryCells: DiscoveryCellResult[];
  discoveryCellsByTarget: Record<string, DiscoveryCellResult[]>;
  totalLocationsScreened: number;
} {
  const selectedTargets = targets.filter((t) => config.targetIds.includes(t.id));
  if (selectedTargets.length === 0) {
    return {
      dossiers: [],
      crossTargetMatrix: null,
      multiTargetPortfolio: null,
      discoveryCells: [],
      discoveryCellsByTarget: {},
      totalLocationsScreened: grid.cells.length,
    };
  }

  const dossiers: TargetEvaluationDossier[] = [];
  let primaryDiscoveryCells: DiscoveryCellResult[] = [];
  const discoveryCellsByTarget: Record<string, DiscoveryCellResult[]> = {};

  for (let idx = 0; idx < selectedTargets.length; idx++) {
    const t = selectedTargets[idx];
    const { dossier, discoveryCells } = evaluateTargetAcrossGlobe(
      t,
      probedSites,
      config,
      grid,
      livePatches
    );
    dossiers.push(dossier);
    discoveryCellsByTarget[t.id] = discoveryCells;
    if (idx === 0) {
      primaryDiscoveryCells = discoveryCells;
    }
  }

  let crossTargetMatrix: CrossTargetMatrix | null = null;
  let multiTargetPortfolio: MultiTargetTwoSitePortfolioResult | null = null;

  if (dossiers.length >= 2) {
    const stats = getGlobalGridStats(grid);
    const unionDossiers = buildUnionCrossEvalDossiers(dossiers, config, stats);
    crossTargetMatrix = buildCrossTargetMatrix(unionDossiers);
    multiTargetPortfolio = optimizeMultiTargetTwoSitePortfolio(unionDossiers);
  }

  return {
    dossiers,
    crossTargetMatrix,
    multiTargetPortfolio,
    discoveryCells: primaryDiscoveryCells,
    discoveryCellsByTarget,
    totalLocationsScreened: grid.cells.length,
  };
}
