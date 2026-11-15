import { PRESET_DOMAIN_WEIGHTS } from './evaluator.js';
import type {
  CelestialBody,
  CelestialTarget,
  DomainWeights,
  MissionPresetId,
  ProcessTag,
} from '../types/planetary.js';

export type SelectablePresetId = Exclude<MissionPresetId, 'custom'>;

export const ARCHETYPE_OPTIONS: Array<{
  id: SelectablePresetId;
  label: string;
  shortLabel: string;
}> = [
  { id: 'rover_mobility', label: 'Surface Rover Mobility', shortLabel: 'Rover Mobility' },
  { id: 'subsurface_void', label: 'Subsurface Cave / Lava Tube', shortLabel: 'Subsurface Void' },
  { id: 'cryogenic_drill', label: 'Cryogenic Volatile Drill', shortLabel: 'Cryogenic Drill' },
  { id: 'moon_base_isru', label: 'Permanent Moon Base & ISRU', shortLabel: 'Moon Base & ISRU' },
  { id: 'astrobiology', label: 'Astrobiology & Biosignatures', shortLabel: 'Astrobiology' },
];

type MarsProvince =
  | 'olympus_summit'
  | 'tharsis_rise'
  | 'elysium_rise'
  | 'syrtis_shield'
  | 'valles_canyon'
  | 'hellas_basin'
  | 'argyre_basin'
  | 'northern_lowlands'
  | 'paleolake_delta'
  | 'polar_cryo'
  | 'southern_highlands';

type MoonProvince =
  | 'mare_imbrium'
  | 'oceanus_procellarum'
  | 'mare_serenitatis'
  | 'mare_tranquillitatis'
  | 'mare_crisium'
  | 'south_pole_aitken'
  | 'polar_region'
  | 'highland_anorthosite';

function normalizeLon(lon: number): number {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180 && lon > 0) l = 180;
  return l;
}

function classifyMarsProvince(lat: number, rawLon: number, featureName?: string): MarsProvince {
  const lon = normalizeLon(rawLon);
  const absLat = Math.abs(lat);
  const lower = (featureName ?? '').toLowerCase();

  // Coordinate-first geophysical province bounding boxes
  if (lat >= 13 && lat <= 24 && lon >= -141 && lon <= -126) return 'olympus_summit';
  if (lat >= -20 && lat <= 28 && lon >= -145 && lon <= -90) return 'tharsis_rise';
  if (lat >= 0 && lat <= 35 && lon >= 130 && lon <= 165) return 'elysium_rise';
  if (lat >= -5 && lat <= 22 && lon >= 58 && lon <= 80) return 'syrtis_shield';
  if (lat >= -16 && lat <= -2 && lon >= -95 && lon <= -40) return 'valles_canyon';
  if (lat >= -55 && lat <= -25 && lon >= 45 && lon <= 95) return 'hellas_basin';
  if (lat >= -60 && lat <= -40 && lon >= -55 && lon <= -28) return 'argyre_basin';

  // Known astrobiology/fluvial basin provinces (Isidis/Jezero, Mawrth/Oxia, Gale)
  if (
    (lat >= 15 && lat <= 25 && lon >= 72 && lon <= 82) || // Jezero / Isidis rim
    (lat >= 15 && lat <= 28 && lon >= -30 && lon <= -12) || // Mawrth / Oxia Planum
    (lat >= -8 && lat <= -2 && lon >= 134 && lon <= 141) // Gale Crater
  ) {
    return 'paleolake_delta';
  }

  if (absLat >= 55) return 'polar_cryo';
  if (lat >= 25) return 'northern_lowlands';

  // Secondary name tie-breakers only when coordinates fall outside main boxes
  if (lower.includes('olympus') || lower.includes('mons')) return 'tharsis_rise';
  if (lower.includes('delta') || lower.includes('jezero') || lower.includes('mawrth') || lower.includes('oxia')) {
    return 'paleolake_delta';
  }

  return 'southern_highlands';
}

function classifyMoonProvince(lat: number, rawLon: number, featureName?: string): MoonProvince {
  const lon = normalizeLon(rawLon);
  const absLat = Math.abs(lat);
  const lower = (featureName ?? '').toLowerCase();

  if (absLat >= 75) return 'polar_region';
  // South Pole-Aitken Basin (far side southern megabasin)
  if (lat >= -75 && lat <= -20 && Math.abs(lon) >= 130) return 'south_pole_aitken';

  // Nearside basaltic maria bounding regions
  if (lat >= 18 && lat <= 50 && lon >= -40 && lon <= -3) return 'mare_imbrium';
  if (lat >= -15 && lat <= 45 && lon >= -72 && lon <= -32) return 'oceanus_procellarum';
  if (lat >= 15 && lat <= 40 && lon >= 8 && lon <= 32) return 'mare_serenitatis';
  if (lat >= -5 && lat <= 20 && lon >= 16 && lon <= 55) return 'mare_tranquillitatis';
  if (lat >= 10 && lat <= 25 && lon >= 48 && lon <= 68) return 'mare_crisium';
  if (lat >= -32 && lat <= -8 && lon >= -46 && lon <= -10) return 'oceanus_procellarum'; // Nubium / Humorum corridor

  // Secondary tie-breaker for named maria outside coarse boxes
  if (lower.includes('mare') || lower.includes('oceanus') || lower.includes('sinus')) {
    return 'mare_tranquillitatis';
  }

  return 'highland_anorthosite';
}

export function inferDefaultArchetype(
  body: CelestialBody,
  lat: number,
  featureName?: string,
  lon = 0
): SelectablePresetId {
  const lower = (featureName ?? '').toLowerCase();
  if (
    lower.includes('pit') ||
    lower.includes('skylight') ||
    lower.includes('cave') ||
    lower.includes('tube') ||
    lower.includes('fossa') ||
    lower.includes('rille') ||
    lower.includes('schröter') ||
    lower.includes('schroter')
  ) {
    return 'subsurface_void';
  }
  if (Math.abs(lat) >= 75 && body === 'moon') {
    return 'cryogenic_drill';
  }
  if (Math.abs(lat) >= 44 && body === 'mars') {
    return 'cryogenic_drill';
  }
  if (body === 'moon') {
    return 'moon_base_isru';
  }

  const province = classifyMarsProvince(lat, lon, featureName);
  if (province === 'paleolake_delta') {
    return 'astrobiology';
  }
  return 'rover_mobility';
}

function makeCustomTargetId(body: CelestialBody, lat: number, lon: number): string {
  const latStr = (lat >= 0 ? 'n' : 's') + Math.abs(lat).toFixed(2).replace('.', '_');
  const lonStr = (lon >= 0 ? 'e' : 'w') + Math.abs(lon).toFixed(2).replace('.', '_');
  return `custom_${body}_${latStr}_${lonStr}`;
}

export function synthesizeCelestialTarget(params: {
  body: CelestialBody;
  lat: number;
  lon: number;
  name?: string;
  presetId?: SelectablePresetId;
  domainWeightsOverride?: DomainWeights;
}): CelestialTarget {
  const { body, lat, lon } = params;
  const presetId = params.presetId ?? inferDefaultArchetype(body, lat, params.name, lon);
  const absLat = Math.abs(lat);
  const latRad = (absLat * Math.PI) / 180;

  const archetypeMeta =
    ARCHETYPE_OPTIONS.find((o) => o.id === presetId) ?? ARCHETYPE_OPTIONS[0];
  const displayName =
    params.name?.trim() ||
    `${body === 'mars' ? 'Mars' : 'Moon'} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;

  const isVoid = presetId === 'subsurface_void';
  const isCryo =
    presetId === 'cryogenic_drill' ||
    (body === 'moon' && absLat >= 82) ||
    (body === 'mars' && absLat >= 55);
  const isBio = presetId === 'astrobiology';
  const defaultDomainWeights = params.domainWeightsOverride
    ? { ...params.domainWeightsOverride }
    : { ...PRESET_DOMAIN_WEIGHTS[presetId] };

  if (body === 'mars') {
    const province = classifyMarsProvince(lat, lon, params.name);
    const isVolcanic =
      province === 'olympus_summit' ||
      province === 'tharsis_rise' ||
      province === 'elysium_rise' ||
      province === 'syrtis_shield' ||
      isVoid;
    const isBasinOrDelta =
      province === 'valles_canyon' ||
      province === 'hellas_basin' ||
      province === 'argyre_basin' ||
      province === 'northern_lowlands' ||
      province === 'paleolake_delta';

    const elevationM =
      province === 'olympus_summit'
        ? 14500
        : province === 'tharsis_rise'
          ? 5500
          : province === 'elysium_rise'
            ? 2400
            : province === 'syrtis_shield'
              ? 600
              : province === 'hellas_basin'
                ? -6000
                : province === 'argyre_basin'
                  ? -4200
                  : province === 'valles_canyon' || province === 'northern_lowlands'
                    ? -3800
                    : province === 'paleolake_delta'
                      ? -2500
                      : 800; // southern highlands

    const elevKm = elevationM / 1000;
    const tMeanK = Math.max(
      148,
      Math.min(
        228,
        Math.round(220 - 52 * Math.pow(Math.sin(latRad), 1.6) - Math.max(0, elevKm) * 1.1)
      )
    );
    const tSeasonalAmpK = Math.round(12 + 24 * Math.sin(latRad));
    const ambientDensityKgM3 = Math.max(
      0.0035,
      Math.round(0.0155 * Math.exp(-elevationM / 11100) * 10000) / 10000
    );

    const medianSlopeDeg = isVoid
      ? 13.5
      : province === 'olympus_summit' || province === 'valles_canyon'
        ? 14.5
        : isVolcanic
          ? 10.5
          : isBasinOrDelta
            ? 4.2
            : 6.5;
    const p95SlopeDeg = isVoid
      ? 38.0
      : province === 'olympus_summit' || province === 'valles_canyon'
        ? 29.0
        : isVolcanic
          ? 24.0
          : 14.0;

    const activeProcesses: ProcessTag[] = isCryo
      ? ['cryogenic_sublimation_permafrost', 'aeolian_saltation']
      : ['aeolian_saltation', 'dust_devils_storms'];
    const relictProcesses: ProcessTag[] = isVoid
      ? ['lava_tube_inflation', 'effusive_basalt_volcanism']
      : isVolcanic
        ? ['effusive_basalt_volcanism']
        : ['fluvial_deltaic_sedimentation', 'impact_shock_ejecta'];

    return {
      id: makeCustomTargetId(body, lat, lon),
      name: displayName,
      body: 'mars',
      lat,
      lon,
      elevationM,
      featureFootprintKm: isVoid ? 1.5 : 8.0,
      missionArchetype: `${archetypeMeta.shortLabel} (Custom Coordinate)`,
      summary: `Coordinate-classified Martian target (${province.replace(/_/g, ' ')}) at ${lat.toFixed(2)}°, ${lon.toFixed(2)}° for ${archetypeMeta.label}.`,
      isAnhydrousRegolith: false,
      isVacuumRegime: false,
      requiresCryogenicIce: isCryo,
      isSubsurfaceVoidTarget: isVoid,
      isPermanentBaseCandidate: false,
      horizonMaskMaxDeg: isVoid ? 48.0 : isVolcanic ? 10.0 : 3.5,
      gravityMs2: 3.721,
      geology: {
        maficIndex: isVolcanic ? 0.62 : 0.48,
        silicaWtPct: isVolcanic ? 47.2 : 46.5,
        tiO2WtPct: isVolcanic ? 1.05 : 0.85,
        clayIndex: isVolcanic ? 0.03 : isBio || province === 'paleolake_delta' ? 0.45 : 0.22,
        sulfateIndex: isVolcanic ? 0.05 : 0.24,
        carbonateIndex: isBio || province === 'paleolake_delta' ? 0.28 : 0.08,
        waterEquivalentHydrogenWtPct: isCryo ? 10.5 : isBio ? 3.8 : 1.8,
        simulantReference: isVolcanic ? 'JSC Mars-1A Basaltic Tephra' : 'MGS-1 Mars Global Simulant',
      },
      morphology: {
        medianSlopeDeg,
        p95SlopeDeg,
        dtmResolutionM: 20.0,
        rockCfaK: isVolcanic ? 0.24 : 0.12,
        cohesionKpa: isCryo ? 5.5 : 2.1,
        frictionAngleDeg: isVolcanic ? 36.0 : 31.5,
        regolithThicknessM: isVolcanic ? 0.8 : 1.8,
        iceTableDepthM: isCryo ? 0.45 : null,
        sarBackscatterSigma0Db: isVolcanic ? -6.8 : -11.0,
      },
      thermalBase: {
        apparentThermalInertia: isVolcanic ? 310 : 265,
        tMeanK,
        tSeasonalAmpK,
        diurnalDeltaK: isVoid ? 3.0 : 64,
        albedo: isVolcanic ? 0.16 : 0.22,
        uvAbFluxWm2: Math.max(18, Math.round(54 * Math.cos(latRad * 0.75))),
        uvCFluxWm2: Math.max(1.2, Math.round(3.8 * Math.cos(latRad * 0.75) * 10) / 10),
      },
      atmosphericBase: {
        ambientDensityKgM3,
        medianGrainDiameterUm: isVolcanic ? 210 : 130,
        particleDensityKgM3: 2900,
        dustOpacityTauBase: 0.45,
      },
      operationsIdeal: {
        grazingSunHoursPerDay: absLat > 40 ? 2.2 : 1.5,
        clearSkyFraction: 0.84,
        visualAlienation: 1.0,
        rfQuietnessScore: 1.0,
        roadDistanceKm: 15.0,
        logisticsFrictionIndex: 0.88,
      },
      ...(isVoid
        ? {
            voidProfile: {
              voidType: 'lava_tube' as const,
              overburdenThicknessM: 26.0,
              voidSpanWidthM: 60.0,
              ceilingHeightM: 30.0,
              skylightAccessSlopeDeg: 65.0,
              subterraneanDeltaTK: 2.2,
            },
          }
        : {}),
      ...(isBio
        ? {
            astrobiologyTarget: {
              targetModeDefault: 'biosignature_habitability_analog' as const,
              waterActivityAw: 0.82,
              surfacePh: 7.4,
              biosignaturePreservationIndex: 0.88,
              targetGuilds: ['halophile', 'chemoautotroph', 'cryptoendolith'] as const,
            },
          }
        : {}),
      activeProcesses,
      relictProcesses,
      defaultPreset: presetId,
      defaultDomainWeights,
      dataSources: ['NASA Mars Trek MOLA/THEMIS', 'Geophysical Coordinate Classification'],
      citations: ['Coordinate-based target prior derived from MOLA regional topography & Mars seasonal ephemeris.'],
    };
  }

  // MOON synthesis (coordinate-first province classification)
  const province = classifyMoonProvince(lat, lon, params.name);
  const isMare =
    province === 'mare_imbrium' ||
    province === 'oceanus_procellarum' ||
    province === 'mare_serenitatis' ||
    province === 'mare_tranquillitatis' ||
    province === 'mare_crisium';
  const isSpaBasin = province === 'south_pole_aitken';
  const isPolar = province === 'polar_region';

  const elevationM = isPolar
    ? isCryo
      ? -3200
      : 1100
    : isSpaBasin
      ? -4200
      : isMare
        ? -1800
        : 1400;

  const tMeanK = isCryo
    ? 52
    : isVoid
      ? 280
      : isPolar
        ? 210
        : Math.max(165, Math.round(256 - 48 * Math.pow(Math.sin(latRad), 1.5)));

  const mareTiO2 =
    province === 'mare_tranquillitatis' || province === 'oceanus_procellarum'
      ? 4.6
      : isMare
        ? 3.8
        : isSpaBasin
          ? 1.6
          : 0.42;
  const mareMafic = isMare ? 0.55 : isSpaBasin ? 0.42 : 0.2;

  return {
    id: makeCustomTargetId(body, lat, lon),
    name: displayName,
    body: 'moon',
    lat,
    lon,
    elevationM,
    featureFootprintKm: isVoid ? 0.5 : 8.0,
    missionArchetype: `${archetypeMeta.shortLabel} (Custom Coordinate)`,
    summary: `Coordinate-classified Lunar target (${province.replace(/_/g, ' ')}) at ${lat.toFixed(2)}°, ${lon.toFixed(2)}° for ${archetypeMeta.label}.`,
    isAnhydrousRegolith: true,
    isVacuumRegime: true,
    requiresCryogenicIce: isCryo,
    isSubsurfaceVoidTarget: isVoid,
    isPermanentBaseCandidate: presetId === 'moon_base_isru' || isVoid || isPolar,
    horizonMaskMaxDeg: isVoid ? 56.0 : isCryo ? 11.0 : isPolar ? 0.6 : 2.5,
    gravityMs2: 1.622,
    geology: {
      maficIndex: mareMafic,
      silicaWtPct: isMare ? 43.8 : 45.4,
      tiO2WtPct: mareTiO2,
      clayIndex: 0.0,
      sulfateIndex: 0.0,
      carbonateIndex: 0.0,
      waterEquivalentHydrogenWtPct: isCryo ? 1.4 : isPolar ? 0.3 : 0.04,
      simulantReference: isMare
        ? 'LMS-1 High-Ti Mare Basalt'
        : isSpaBasin
          ? 'LRO SPA Noritic-Basalt Prior'
          : 'LHS-1 Highland Anorthosite',
    },
    morphology: {
      medianSlopeDeg: isVoid ? 10.5 : isCryo ? 13.5 : isMare ? 3.8 : 9.0,
      p95SlopeDeg: isVoid ? 32.0 : isCryo ? 27.0 : 16.0,
      dtmResolutionM: 10.0,
      rockCfaK: isMare ? 0.1 : 0.08,
      cohesionKpa: isCryo ? 3.2 : 1.5,
      frictionAngleDeg: 37.0,
      regolithThicknessM: isMare ? 4.2 : 7.0,
      iceTableDepthM: isCryo ? 0.2 : null,
      sarBackscatterSigma0Db: isMare ? -7.8 : -6.2,
    },
    thermalBase: {
      apparentThermalInertia: isMare ? 82 : 62,
      tMeanK,
      tSeasonalAmpK: isCryo ? 5 : 14,
      diurnalDeltaK: isVoid ? 2.2 : isCryo ? 2.0 : isPolar ? 55 : 155,
      albedo: isMare ? 0.09 : isSpaBasin ? 0.14 : 0.22,
      uvAbFluxWm2: isCryo ? 0.0 : 116.0,
      uvCFluxWm2: isCryo ? 0.0 : 11.3,
    },
    atmosphericBase: {
      ambientDensityKgM3: 0.0,
      medianGrainDiameterUm: 75,
      particleDensityKgM3: isMare ? 3050 : 2950,
      dustOpacityTauBase: 0.0,
    },
    operationsIdeal: {
      grazingSunHoursPerDay: isCryo ? 0.0 : isPolar ? 5.2 : 1.4,
      clearSkyFraction: 1.0,
      visualAlienation: 1.0,
      rfQuietnessScore: 1.0,
      roadDistanceKm: 15.0,
      logisticsFrictionIndex: 0.88,
    },
    ...(isVoid
      ? {
          voidProfile: {
            voidType: 'lava_tube' as const,
            overburdenThicknessM: 35.0,
            voidSpanWidthM: 50.0,
            ceilingHeightM: 28.0,
            skylightAccessSlopeDeg: 68.0,
            subterraneanDeltaTK: 2.2,
          },
        }
      : {}),
    isruRequirements: {
      ilmeniteO2YieldPotential: isMare ? 0.78 : isSpaBasin ? 0.35 : 0.2,
      constructionFeedstockSuitability: 0.88,
      landingPlumeDustHazard: isMare ? 0.56 : 0.64,
      directToEarthVisibilityPct: Math.abs(normalizeLon(lon)) <= 85 ? 95.0 : 25.0,
    },
    activeProcesses: isCryo ? ['cryogenic_sublimation_permafrost'] : [],
    relictProcesses: isVoid
      ? ['lava_tube_inflation', 'effusive_basalt_volcanism', 'impact_shock_ejecta']
      : isMare
        ? ['effusive_basalt_volcanism', 'impact_shock_ejecta']
        : ['impact_shock_ejecta'],
    defaultPreset: presetId,
    defaultDomainWeights,
    dataSources: ['NASA Moon Trek LRO WAC/LOLA', 'Geophysical Coordinate Classification'],
    citations: ['Coordinate-based lunar prior derived from LRO WAC/Diviner mare, SPA, and highland provinces.'],
  };
}
