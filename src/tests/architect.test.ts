import { describe, expect, it } from 'vitest';
import gridJson from '../data/global_discovery_grid.json' with { type: 'json' };
import { PRESET_DOMAIN_WEIGHTS } from '../engine/evaluator.js';
import {
  applyLivePatchToSite,
  evaluateAllTargetsGlobally,
  evaluateTargetAcrossGlobe,
  makeLiveCoordKey,
} from '../engine/globalDiscoveryEngine.js';
import { buildDeterministicMissionDesign } from '../engine/localMissionArchitect.js';
import { synthesizeCelestialTarget } from '../engine/targetSynthesizer.js';
import {
  GRANULAR_WEIGHT_TIERS,
  GRANULAR_WEIGHTING_PROFILES,
} from '../engine/weightingProfiles.js';
import type {
  GlobalDiscoveryGridFile,
  LiveTelemetryPatch,
  MissionConfig,
} from '../types/planetary.js';

const grid = gridJson as GlobalDiscoveryGridFile;

const ALL_PERMITS: MissionConfig['allowedPermitTiers'] = [
  'open_public',
  'regulated_research',
  'protected_park',
  'polar_expedition',
];

describe('architect.test.ts — Granular Weighting & AI Mission Architect', () => {
  it('Provides granular weighting profiles across all 5 mission archetypes with valid normalized weights', () => {
    expect(GRANULAR_WEIGHTING_PROFILES.length).toBeGreaterThanOrEqual(15);
    expect(GRANULAR_WEIGHT_TIERS.length).toBeGreaterThanOrEqual(10);

    for (const profile of GRANULAR_WEIGHTING_PROFILES) {
      const sum =
        profile.domainWeights.geochemistry +
        profile.domainWeights.morphology +
        profile.domainWeights.thermal +
        profile.domainWeights.atmospheric +
        profile.domainWeights.operations;
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });

  it('Asks follow-up questions ONLY when planetary target or operational goal is genuinely ambiguous or physically contradictory', () => {
    const ambiguous = buildDeterministicMissionDesign('test hardware in desert');
    expect(ambiguous.status).toBe('needs_clarification');
    expect(ambiguous.followUpQuestions.length).toBeGreaterThanOrEqual(1);

    const lunarWindContradiction = buildDeterministicMissionDesign(
      'Moon rover with aeolian dust storm wind abrasion testing'
    );
    expect(lunarWindContradiction.status).toBe('needs_clarification');
    expect(
      lunarWindContradiction.followUpQuestions.some((q) => q.id === 'q_vacuum_wind')
    ).toBe(true);

    // Once clarified, immediately transitions to ready without repeating questions
    const clarified = buildDeterministicMissionDesign(
      'test hardware in desert',
      [{ question: 'Which planetary body?', answer: 'Target Mars for rover mobility traction' }]
    );
    expect(clarified.status).toBe('ready');
    expect(clarified.followUpQuestions).toHaveLength(0);
    expect(clarified.components.length).toBeGreaterThanOrEqual(1);
  });

  it('Automatically splits complex multi-phase missions across distinct planetary locations', () => {
    const design = buildDeterministicMissionDesign(
      'Artemis lunar south pole campaign combining cryogenic water-ice drilling in Shackleton PSR, a sunlit solar power and DTE communications relay ridge on Malapert Massif, and Mare Tranquillitatis lava tube shelter reconnaissance.'
    );

    expect(design.status).toBe('ready');
    expect(design.isMultiComponent).toBe(true);
    expect(design.components.length).toBeGreaterThanOrEqual(3);
    expect(design.followUpQuestions).toHaveLength(0);

    const distinctCoords = new Set(
      design.components.map((c) => `${c.body}:${c.lat.toFixed(1)},${c.lon.toFixed(1)}`)
    );
    expect(distinctCoords.size).toBe(design.components.length);
  });

  it('Evaluates multi-component missions with per-component targetOverrides weights independently', () => {
    const jezero = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.38,
      lon: 77.58,
      name: 'Jezero Crater Delta',
      presetId: 'astrobiology',
    });
    const olympus = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.65,
      lon: -133.8,
      name: 'Olympus Mons Scarp',
      presetId: 'rover_mobility',
    });

    const config: MissionConfig = {
      targetIds: [jezero.id, olympus.id],
      presetId: 'astrobiology',
      domainWeights: PRESET_DOMAIN_WEIGHTS.astrobiology,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'biosignature_habitability_analog',
      allowedPermitTiers: ALL_PERMITS,
      targetOverrides: {
        [jezero.id]: {
          presetId: 'astrobiology',
          domainWeights: {
            geochemistry: 0.50,
            morphology: 0.12,
            thermal: 0.14,
            atmospheric: 0.06,
            operations: 0.18,
          },
          astrobiologyMode: 'biosignature_habitability_analog',
          componentTitle: 'Paleolake Biosignature Sampling',
          componentRole: 'Clay & Evaporite Geochemistry',
        },
        [olympus.id]: {
          presetId: 'rover_mobility',
          domainWeights: {
            geochemistry: 0.12,
            morphology: 0.48,
            thermal: 0.12,
            atmospheric: 0.08,
            operations: 0.20,
          },
          astrobiologyMode: 'clean_instrument_test',
          componentTitle: 'Scarp Slope Traction Traverse',
          componentRole: 'Basaltic Talus Climb Mobility',
        },
      },
    };

    const result = evaluateAllTargetsGlobally([jezero, olympus], [], config, grid);
    expect(result.dossiers).toHaveLength(2);
    expect(result.multiTargetPortfolio).not.toBeNull();

    // Isolated baseline evaluation for Olympus using the override weights
    const olympusBaseline = evaluateAllTargetsGlobally(
      [olympus],
      [],
      {
        ...config,
        targetIds: [olympus.id],
        presetId: 'rover_mobility',
        domainWeights: config.targetOverrides![olympus.id].domainWeights,
        astrobiologyMode: 'clean_instrument_test',
        targetOverrides: undefined,
      },
      grid
    );

    expect(result.dossiers[1].rankedCandidates[0].site.id).toBe(
      olympusBaseline.dossiers[0].rankedCandidates[0].site.id
    );
    expect(result.dossiers[1].rankedCandidates[0].missionFitPct).toBe(
      olympusBaseline.dossiers[0].rankedCandidates[0].missionFitPct
    );
  });

  it('Non-destructively augments #1 subsurface void candidate with live NASA/DEM without wiping voidProfile or dropping rank', () => {
    const skylight = synthesizeCelestialTarget({
      body: 'moon',
      lat: 8.33,
      lon: 33.22,
      name: 'Mare Tranquillitatis Pit',
      presetId: 'subsurface_void',
    });

    const config: MissionConfig = {
      targetIds: [skylight.id],
      presetId: 'subsurface_void',
      domainWeights: PRESET_DOMAIN_WEIGHTS.subsurface_void,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'ignore',
      allowedPermitTiers: ALL_PERMITS,
      searchScope: 'standard_100',
    };

    const baseline = evaluateTargetAcrossGlobe(skylight, [], config, grid);
    expect(baseline.dossier.rankedCandidates.length).toBeGreaterThanOrEqual(95);

    const top1 = baseline.dossier.rankedCandidates[0];
    expect(top1.site.voidProfile.voidType).not.toBe('none');

    // Simulate Macrostrat returning unmapped (macroLive: false, voidHint: null) while DEM & POWER succeed
    const coordKey = makeLiveCoordKey(top1.site.lat, top1.site.lon);
    const partialMacroPatch: LiveTelemetryPatch = {
      coordKey,
      lat: top1.site.lat,
      lon: top1.site.lon,
      powerLive: true,
      demLive: true,
      macroLive: false,
      osmLive: false,
      elevationM: top1.site.elevationM,
      medianSlopeDeg: top1.site.morphology.medianSlopeDeg,
      p95SlopeDeg: top1.site.morphology.p95SlopeDeg,
      dtmResolutionM: 30,
      demSource: 'terrarium',
      meanAlbedo: top1.site.thermalStatic.albedo,
      wind50Ms: 4.1,
      wind95Ms: 8.4,
      thermalInertia: top1.site.thermalStatic.apparentThermalInertia,
      monthly: top1.site.monthly,
      geologyPatch: null,
      voidHint: null,
      roadDistanceKm: null,
      rfQuietnessScore: null,
      permitTier: null,
      verifiedSources: ['NASA POWER Daily API', 'AWS Mapzen Terrarium DEM'],
      warnings: [],
    };

    const patchedSite = applyLivePatchToSite(top1.site, partialMacroPatch);
    expect(patchedSite.id).toBe(top1.site.id);
    expect(patchedSite.name).toBe(top1.site.name);
    expect(patchedSite.voidProfile.voidType).toBe(top1.site.voidProfile.voidType);
    expect(patchedSite.liveStatus).toBe('verified');

    const augmented = evaluateTargetAcrossGlobe(skylight, [], config, grid, {
      [coordKey]: partialMacroPatch,
    });
    const reRankedIdx = augmented.dossier.rankedCandidates.findIndex(
      (c) => c.site.id === top1.site.id
    );
    expect(reRankedIdx).toBe(0);
    expect(augmented.dossier.rankedCandidates[0].site.liveStatus).toBe('verified');
  });

  it('Broaden Search (broad_250) expands regional candidate pool beyond Top-100 standard_100 shortlist', () => {
    const jezero = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.38,
      lon: 77.58,
      name: 'Jezero Crater Delta',
      presetId: 'astrobiology',
    });

    const baseConfig: MissionConfig = {
      targetIds: [jezero.id],
      presetId: 'astrobiology',
      domainWeights: PRESET_DOMAIN_WEIGHTS.astrobiology,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'biosignature_habitability_analog',
      allowedPermitTiers: ALL_PERMITS,
      searchScope: 'standard_100',
    };

    const std = evaluateTargetAcrossGlobe(jezero, [], baseConfig, grid);
    const broad = evaluateTargetAcrossGlobe(
      jezero,
      [],
      { ...baseConfig, searchScope: 'broad_250' },
      grid
    );

    expect(std.dossier.rankedCandidates.length).toBeGreaterThanOrEqual(95);
    expect(broad.dossier.rankedCandidates.length).toBeGreaterThan(
      std.dossier.rankedCandidates.length + 100
    );
  });
});
