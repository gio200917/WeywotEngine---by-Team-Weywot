import type {
  AstrobiologyEvaluation,
  AstrobiologyMode,
  CelestialTarget,
  EarthAnalogSite,
  IsruEvaluation,
  MissionPresetId,
  ProcessAnalogyEvaluation,
  ProcessTag,
  VoidEvaluation,
} from '../types/planetary.js';

function relativeProximityScore(
  targetVal: number | null,
  siteVal: number | null,
  scaleFallback: number
): number {
  if (targetVal === null || siteVal === null) return 65;
  const denom = Math.max(scaleFallback, Math.abs(targetVal) * 0.65);
  const ratio = Math.abs(siteVal - targetVal) / denom;
  return 100 / (1 + ratio * ratio);
}

export function evaluateVoidModule(
  target: CelestialTarget,
  site: EarthAnalogSite,
  presetId: MissionPresetId
): VoidEvaluation {
  const active = presetId === 'subsurface_void' || target.isSubsurfaceVoidTarget;
  if (!active) {
    return {
      active: false,
      scorePct: 0,
      voidTypeMatch: 'inactive',
      structuralNotes: [],
    };
  }

  const sv = site.voidProfile;
  const tv = target.voidProfile;

  if (sv.voidType === 'none') {
    return {
      active: true,
      scorePct: 5,
      voidTypeMatch: 'none (surface only)',
      structuralNotes: ['No accessible subsurface void, skylight, or karst chamber present.'],
    };
  }

  const targetType = tv?.voidType ?? 'lava_tube';
  let typeScore = 60;
  let voidTypeMatch = `${sv.voidType} vs ${targetType}`;
  const notes: string[] = [];

  if (sv.voidType === targetType) {
    typeScore = 100;
    voidTypeMatch = `Exact ${sv.voidType.replace('_', ' ')} analog`;
    notes.push(`Matches target ${targetType.replace('_', ' ')} formation mechanics.`);
  } else if (
    (targetType === 'lava_tube' && sv.voidType === 'karst_cave') ||
    (targetType === 'lava_tube' && sv.voidType === 'impact_melt_pit')
  ) {
    typeScore = 76;
    voidTypeMatch = `Structural ${sv.voidType.replace('_', ' ')} surrogate`;
    notes.push(
      `Non-basaltic ${sv.voidType.replace('_', ' ')} provides comparable overburden shielding, span geometry, and cavern thermal stability.`
    );
  } else if (sv.voidType === 'mine_shaft' || sv.voidType === 'subglacial_cavern') {
    typeScore = 64;
    voidTypeMatch = `Operational ${sv.voidType.replace('_', ' ')} surrogate`;
    notes.push(`Provides confined underground access and RF-occluded autonomy testbed.`);
  }

  const overburdenScore = relativeProximityScore(
    tv?.overburdenThicknessM ?? 25,
    sv.overburdenThicknessM,
    20
  );
  const spanScore = relativeProximityScore(
    tv?.voidSpanWidthM ?? 40,
    sv.voidSpanWidthM,
    30
  );
  const ceilingScore = relativeProximityScore(
    tv?.ceilingHeightM ?? 20,
    sv.ceilingHeightM,
    15
  );
  const slopeScore = relativeProximityScore(
    tv?.skylightAccessSlopeDeg ?? 45,
    sv.skylightAccessSlopeDeg,
    25
  );
  const thermalStabilityScore =
    sv.subterraneanDeltaTK !== null
      ? Math.max(0, Math.min(100, 100 - Math.max(0, sv.subterraneanDeltaTK - 2.0) * 10))
      : 60;

  if (sv.subterraneanDeltaTK !== null && sv.subterraneanDeltaTK <= 3.0) {
    notes.push(
      `Subterranean diurnal swing damped to ${sv.subterraneanDeltaTK.toFixed(1)} K.`
    );
  }
  if (sv.voidSpanWidthM !== null && sv.ceilingHeightM !== null) {
    notes.push(
      `Chamber geometry: ~${sv.voidSpanWidthM.toFixed(0)} m span x ${sv.ceilingHeightM.toFixed(0)} m ceiling.`
    );
  }

  const geomMean =
    0.25 * overburdenScore +
    0.25 * spanScore +
    0.15 * ceilingScore +
    0.15 * slopeScore +
    0.20 * thermalStabilityScore;

  const scorePct = Math.max(0, Math.min(100, 0.52 * typeScore + 0.48 * geomMean));

  return {
    active: true,
    scorePct,
    voidTypeMatch,
    structuralNotes: notes,
  };
}

export function evaluateIsruModule(
  target: CelestialTarget,
  site: EarthAnalogSite,
  presetId: MissionPresetId
): IsruEvaluation {
  const active = presetId === 'moon_base_isru' || target.isPermanentBaseCandidate;
  if (!active) {
    return {
      active: false,
      scorePct: 0,
      ilmeniteYieldPct: 0,
      feedstockSuitabilityPct: 0,
      plumeHazardPct: 0,
      dteCommsPct: 0,
    };
  }

  const si = site.isruProfile;
  const ti = target.isruRequirements;

  // Ilmenite O2 potential: if target requires high-Ti mare feedstock, match target potential;
  // for low-Ti highland base targets, feedstock + DTE + low plume dominate
  const ilmeniteTarget = ti?.ilmeniteO2YieldPotential ?? 0.5;
  const ilmeniteMatch =
    ilmeniteTarget > 0.4
      ? Math.max(0, Math.min(100, 100 - Math.abs(si.ilmeniteO2YieldPotential - ilmeniteTarget) * 110))
      : Math.max(45, 100 - Math.abs(si.ilmeniteO2YieldPotential - ilmeniteTarget) * 60);

  const feedstockPct = Math.max(0, Math.min(100, si.constructionFeedstockSuitability * 100));
  const plumeSafetyPct = Math.max(0, Math.min(100, (1 - si.landingPlumeDustHazard) * 100));
  const dtePct = Math.max(0, Math.min(100, si.directToEarthVisibilityPct));

  const scorePct =
    0.28 * ilmeniteMatch +
    0.36 * feedstockPct +
    0.20 * plumeSafetyPct +
    0.16 * dtePct;

  return {
    active: true,
    scorePct: Math.max(0, Math.min(100, scorePct)),
    ilmeniteYieldPct: Math.round(si.ilmeniteO2YieldPotential * 1000) / 10,
    feedstockSuitabilityPct: Math.round(feedstockPct * 10) / 10,
    plumeHazardPct: Math.round(si.landingPlumeDustHazard * 1000) / 10,
    dteCommsPct: Math.round(dtePct * 10) / 10,
  };
}

export function evaluateAstrobiologyModule(
  target: CelestialTarget,
  site: EarthAnalogSite,
  mode: AstrobiologyMode
): AstrobiologyEvaluation {
  if (mode === 'ignore') {
    return {
      mode,
      scorePct: 100,
      bioticFalsePositiveRisk: 'none',
      guildOverlapCount: 0,
      notes: ['Astrobiology overlay ignored for this analysis.'],
    };
  }

  const sa = site.astrobiology;
  const toc = sa.tocWtPct ?? 0.15;

  let risk: 'low' | 'moderate' | 'high' = 'moderate';
  if (toc < 0.05) risk = 'low';
  else if (toc > 0.35) risk = 'high';

  if (mode === 'clean_instrument_test') {
    const cleanScore = Math.max(5, Math.min(100, 100 * Math.exp(-toc * 3.5)));
    const notes: string[] = [];
    if (risk === 'low') {
      notes.push(`Ultra-low TOC (${toc.toFixed(3)} wt%) minimizes flight instrument biotic false-positives.`);
    } else if (risk === 'high') {
      notes.push(`Elevated terrestrial TOC (${toc.toFixed(2)} wt%) introduces biotic false-positive contamination risk.`);
    } else {
      notes.push(`Moderate TOC (${toc.toFixed(2)} wt%); clean-room sample blanking required.`);
    }
    return {
      mode,
      scorePct: cleanScore,
      bioticFalsePositiveRisk: risk,
      guildOverlapCount: 0,
      notes,
    };
  }

  // biosignature_habitability_analog
  const targetBio = target.astrobiologyTarget;
  const targetGuilds = targetBio?.targetGuilds ?? [];
  const matchedGuilds = sa.extremophileGuilds.filter((g) => targetGuilds.includes(g));
  const guildScore =
    targetGuilds.length > 0 ? (matchedGuilds.length / targetGuilds.length) * 100 : 60;
  const preservationScore = sa.biosignaturePreservationIndex * 100;

  let chemScore = 70;
  if (targetBio?.surfacePh !== null && targetBio?.surfacePh !== undefined && sa.surfacePh !== null) {
    const phDiff = Math.abs(sa.surfacePh - targetBio.surfacePh);
    chemScore = Math.max(0, 100 - phDiff * 18);
  }
  if (
    targetBio?.waterActivityAw !== null &&
    targetBio?.waterActivityAw !== undefined &&
    sa.waterActivityAw !== null
  ) {
    const awDiff = Math.abs(sa.waterActivityAw - targetBio.waterActivityAw);
    chemScore = 0.5 * chemScore + 0.5 * Math.max(0, 100 - awDiff * 120);
  }

  const scorePct = Math.max(
    0,
    Math.min(100, 0.45 * preservationScore + 0.35 * guildScore + 0.20 * chemScore)
  );

  const notes: string[] = [
    `Biosignature preservation index: ${(sa.biosignaturePreservationIndex * 100).toFixed(0)}%`,
  ];
  if (matchedGuilds.length > 0) {
    notes.push(`Matched extremophile guilds: ${matchedGuilds.join(', ')}.`);
  }

  return {
    mode,
    scorePct,
    bioticFalsePositiveRisk: risk,
    guildOverlapCount: matchedGuilds.length,
    notes,
  };
}

export function evaluateProcessAnalogy(
  target: CelestialTarget,
  site: EarthAnalogSite
): ProcessAnalogyEvaluation {
  const tActive = new Set<ProcessTag>(target.activeProcesses);
  const tRelict = new Set<ProcessTag>(target.relictProcesses);
  const sActive = new Set<ProcessTag>(site.activeProcesses);
  const sRelict = new Set<ProcessTag>(site.relictProcesses);

  const matchedActive: ProcessTag[] = [];
  const matchedRelict: ProcessTag[] = [];

  for (const p of tActive) {
    if (sActive.has(p)) {
      matchedActive.push(p);
    } else if (sRelict.has(p)) {
      matchedRelict.push(p);
    }
  }
  for (const p of tRelict) {
    if ((sRelict.has(p) || sActive.has(p)) && !matchedRelict.includes(p)) {
      matchedRelict.push(p);
    }
  }

  const totalTargetProcesses = tActive.size + tRelict.size;
  if (totalTargetProcesses === 0) {
    return {
      similarityPct: 50,
      classification: 'Morpho-Thermal Only',
      matchedActive,
      matchedRelict,
    };
  }

  const maxPossibleWeight = tActive.size * 1.0 + tRelict.size * 0.8;
  let earnedWeight = 0;
  for (const p of tActive) {
    if (sActive.has(p)) earnedWeight += 1.0;
    else if (sRelict.has(p)) earnedWeight += 0.6;
  }
  for (const p of tRelict) {
    if (sRelict.has(p)) earnedWeight += 0.8;
    else if (sActive.has(p)) earnedWeight += 0.7;
  }

  const similarityPct = Math.max(
    0,
    Math.min(100, (earnedWeight / Math.max(1e-6, maxPossibleWeight)) * 100)
  );

  let classification: ProcessAnalogyEvaluation['classification'] = 'Morpho-Thermal Only';
  if (matchedActive.length > 0 && matchedRelict.length > 0) {
    classification = 'Hybrid Process Analog';
  } else if (matchedActive.length > 0) {
    classification = 'Active Process Analog';
  } else if (matchedRelict.length > 0) {
    classification = 'Relict Morpho-Structural Analog';
  }

  return {
    similarityPct: Math.round(similarityPct * 10) / 10,
    classification,
    matchedActive,
    matchedRelict,
  };
}
