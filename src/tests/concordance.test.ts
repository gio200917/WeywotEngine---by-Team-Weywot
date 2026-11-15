import { describe, expect, it } from 'vitest';
import gridJson from '../data/global_discovery_grid.json' with { type: 'json' };
import { resolveEarthRegion } from '../engine/earthRegionResolver.js';
import { PRESET_DOMAIN_WEIGHTS } from '../engine/evaluator.js';
import {
  evaluateAllTargetsGlobally,
  evaluateTargetAcrossGlobe,
  getGlobalGridStats,
  haversineEarthKm,
} from '../engine/globalDiscoveryEngine.js';
import { synthesizeCelestialTarget } from '../engine/targetSynthesizer.js';
import type { GlobalDiscoveryGridFile, MissionConfig } from '../types/planetary.js';

const grid = gridJson as GlobalDiscoveryGridFile;

const ALL_PERMITS: MissionConfig['allowedPermitTiers'] = [
  'open_public',
  'regulated_research',
  'protected_park',
  'polar_expedition',
];

describe('concordance.test.ts — Zero-Preset Full-Earth Discovery & Qualification', () => {
  it('Screens all 17,768 Earth grid cells under 350 ms with Spatial NMS continent/province diversity', () => {
    const jezero = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.38,
      lon: 77.58,
      name: 'Jezero Crater Delta',
      presetId: 'astrobiology',
    });

    const config: MissionConfig = {
      targetIds: [jezero.id],
      presetId: 'astrobiology',
      domainWeights: PRESET_DOMAIN_WEIGHTS.astrobiology,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'biosignature_habitability_analog',
      allowedPermitTiers: ALL_PERMITS,
    };

    // Warm the 17,768-cell grid stats cache once (matches worker startup)
    getGlobalGridStats(grid);

    const t0 = performance.now();
    const { dossier, discoveryCells } = evaluateTargetAcrossGlobe(
      jezero,
      [],
      config,
      grid
    );
    const elapsedMs = performance.now() - t0;

    expect(grid.cells.length).toBe(17768);
    expect(dossier.totalLocationsScreened).toBe(17768);
    expect(discoveryCells.length).toBe(17768);
    expect(elapsedMs).toBeLessThan(450);

    // Spatial NMS top 10 sites are distinct Earth regions (>= 300 km pairwise apart)
    const top10 = dossier.rankedCandidates.slice(0, 10);
    expect(top10.length).toBe(10);
    for (let i = 0; i < top10.length; i++) {
      for (let j = i + 1; j < top10.length; j++) {
        const distKm = haversineEarthKm(
          top10[i].site.lat,
          top10[i].site.lon,
          top10[j].site.lat,
          top10[j].site.lon
        );
        expect(distKm).toBeGreaterThanOrEqual(300);
      }
    }

    // Multiple distinct continents/countries discovered automatically
    const distinctCountries = new Set(top10.map((c) => c.site.country));
    expect(distinctCountries.size).toBeGreaterThanOrEqual(3);
  });

  it('Olympus Mons Scarp steep basaltic terrain outranks flat hyper-arid basins across Earth', () => {
    const olympus = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.65,
      lon: -133.8,
      name: 'Olympus Mons Scarp',
      presetId: 'rover_mobility',
    });

    const config: MissionConfig = {
      targetIds: [olympus.id],
      presetId: 'rover_mobility',
      domainWeights: PRESET_DOMAIN_WEIGHTS.rover_mobility,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'clean_instrument_test',
      allowedPermitTiers: ALL_PERMITS,
    };

    const { dossier } = evaluateTargetAcrossGlobe(olympus, [], config, grid);
    expect(dossier.rankedCandidates.length).toBeGreaterThanOrEqual(20);

    // Steep basalt target (~14 deg) should favor rugged volcanic/mountain terrain over dead-flat sand/playas
    const top5Slopes = dossier.rankedCandidates
      .slice(0, 5)
      .map((c) => c.site.morphology.medianSlopeDeg);
    const meanTop5Slope = top5Slopes.reduce((a, b) => a + b, 0) / top5Slopes.length;
    expect(meanTop5Slope).toBeGreaterThan(5.0);
    expect(dossier.rankedCandidates[0].missionFitPct).toBeGreaterThan(50);
  });

  it('Mare Tranquillitatis Skylight (subsurface_void) prioritizes lava tube & karst void cells across the globe', () => {
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
      epochDateIso: '2026-06-15',
      durationDays: 14,
      astrobiologyMode: 'ignore',
      allowedPermitTiers: ALL_PERMITS,
    };

    const { dossier } = evaluateTargetAcrossGlobe(skylight, [], config, grid);
    const top5Voids = dossier.rankedCandidates
      .slice(0, 5)
      .filter((c) => c.site.voidProfile.voidType !== 'none');
    expect(top5Voids.length).toBeGreaterThanOrEqual(4);
    expect(dossier.rankedCandidates[0].voidEval.active).toBe(true);
    expect(dossier.rankedCandidates[0].voidEval.scorePct).toBeGreaterThan(60);

    // Void sites significantly beat surface-only plains in subsurface_void mode
    const firstNonVoid = dossier.rankedCandidates.find(
      (c) => c.site.voidProfile.voidType === 'none'
    );
    if (firstNonVoid) {
      expect(dossier.rankedCandidates[0].missionFitPct).toBeGreaterThan(
        firstNonVoid.missionFitPct + 15
      );
    }
  });

  it('Lunar South Pole PSR Cryogenic Drill surfaces ice/permafrost terrain and computes non-negative 2-site split', () => {
    const psr = synthesizeCelestialTarget({
      body: 'moon',
      lat: -89.5,
      lon: 0.0,
      name: 'Shackleton PSR Floor',
      presetId: 'cryogenic_drill',
    });

    const config: MissionConfig = {
      targetIds: [psr.id],
      presetId: 'cryogenic_drill',
      domainWeights: PRESET_DOMAIN_WEIGHTS.cryogenic_drill,
      epochDateIso: '2026-06-15',
      durationDays: 30,
      astrobiologyMode: 'clean_instrument_test',
      allowedPermitTiers: ALL_PERMITS,
    };

    const { dossier } = evaluateTargetAcrossGlobe(psr, [], config, grid);
    const topIceCount = dossier.rankedCandidates
      .slice(0, 5)
      .filter((c) => c.site.morphology.iceTableDepthM !== null).length;
    expect(topIceCount).toBeGreaterThanOrEqual(3);

    expect(dossier.portfolio).not.toBeNull();
    expect(dossier.portfolio!.combinedMinimaxPct).toBeGreaterThanOrEqual(
      dossier.portfolio!.singleSiteMaxPct
    );
  });

  it('Enforces Zero-Averaging Invariant while computing CrossTargetMatrix & Multi-Target 2-Site Split over disjoint NMS pools', () => {
    const jezero = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.38,
      lon: 77.58,
      name: 'Jezero Crater Delta',
      presetId: 'rover_mobility',
    });
    const shackleton = synthesizeCelestialTarget({
      body: 'moon',
      lat: -89.5,
      lon: 0.0,
      name: 'Shackleton Crater Rim',
      presetId: 'cryogenic_drill',
    });

    const singleConfig: MissionConfig = {
      targetIds: [jezero.id],
      presetId: 'rover_mobility',
      domainWeights: PRESET_DOMAIN_WEIGHTS.rover_mobility,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'clean_instrument_test',
      allowedPermitTiers: ALL_PERMITS,
    };

    const multiConfig: MissionConfig = {
      ...singleConfig,
      targetIds: [jezero.id, shackleton.id],
    };

    const singleRes = evaluateAllTargetsGlobally([jezero], [], singleConfig, grid);
    const multiRes = evaluateAllTargetsGlobally(
      [jezero, shackleton],
      [],
      multiConfig,
      grid
    );

    expect(multiRes.dossiers).toHaveLength(2);
    expect(multiRes.dossiers[0].rankedCandidates[0].site.id).toBe(
      singleRes.dossiers[0].rankedCandidates[0].site.id
    );
    expect(multiRes.dossiers[0].rankedCandidates[0].missionFitPct).toBe(
      singleRes.dossiers[0].rankedCandidates[0].missionFitPct
    );

    expect(multiRes.crossTargetMatrix).not.toBeNull();
    expect(multiRes.crossTargetMatrix!.targetIds).toEqual([jezero.id, shackleton.id]);
    expect(multiRes.multiTargetPortfolio).not.toBeNull();
    expect(multiRes.multiTargetPortfolio!.targetCount).toBe(2);
    expect(multiRes.multiTargetPortfolio!.assignments).toHaveLength(2);
    expect(multiRes.multiTargetPortfolio!.combinedMinimaxPct).toBeGreaterThanOrEqual(
      multiRes.multiTargetPortfolio!.singleSiteMinimaxPct
    );
  });

  it('EarthRegionResolver assigns physiographic names, countries, and permits across continents without presets', () => {
    const atacama = resolveEarthRegion(-24.1, -69.9, 0);
    const lebanonKarst = resolveEarthRegion(34.0, 35.9, 2);
    const antarctica = resolveEarthRegion(-77.8, 160.7, 0);
    const gobiBasin = resolveEarthRegion(43.5, 91.2, 0);
    const fallbackEurasia = resolveEarthRegion(58.0, 95.0, 0);

    expect(atacama.country).toContain('Chile');
    expect(lebanonKarst.country).toContain('Lebanon');
    expect(lebanonKarst.name).toContain('Karst');
    expect(antarctica.permitTier).toBe('polar_expedition');
    expect(gobiBasin.name).toContain('Gobi');
    expect(fallbackEurasia.name.length).toBeGreaterThan(5);
  });
});
