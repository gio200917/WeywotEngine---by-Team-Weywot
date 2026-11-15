import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import gridJson from '../data/global_discovery_grid.json' with { type: 'json' };
import app from '../../server/index.js';
import { computeStitchedTerrariumSlopes } from '../../server/probeService.js';
import {
  PRESET_DOMAIN_WEIGHTS,
  combineDomainScores,
  evaluateTargetIsolated,
} from '../engine/evaluator.js';
import {
  applyLivePatchToSite,
  evaluateAllTargetsGlobally,
  evaluateTargetAcrossGlobe,
  makeLiveCoordKey,
  synthesizeSiteFromGridCell,
} from '../engine/globalDiscoveryEngine.js';
import { synthesizeCelestialTarget } from '../engine/targetSynthesizer.js';
import { useMissionStore } from '../store/missionStore.js';
import type {
  DomainKey,
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

function encodeTerrariumTile(elevFn: (gx: number, gy: number) => number, tileOffsetX: number): PNG {
  const png = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const elev = elevFn(tileOffsetX + x, y);
      const val = Math.max(0, elev + 32768);
      const r = Math.floor(val / 256);
      const rem = val - r * 256;
      const g = Math.floor(rem);
      const b = Math.round((rem - g) * 256) & 0xff;
      const idx = (y * 256 + x) * 4;
      png.data[idx] = r & 0xff;
      png.data[idx + 1] = g & 0xff;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

describe('remediation.test.ts — Scientific, Algorithmic, State & API Integrity', () => {
  it('Synthesizes Mars & Moon targets by coordinate province rather than feature name substrings', () => {
    const olympusUnnamed = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.65,
      lon: -133.8,
      name: 'Mars (18.65°, -133.80°)',
      presetId: 'rover_mobility',
    });
    expect(olympusUnnamed.elevationM).toBeGreaterThanOrEqual(10000);
    expect(olympusUnnamed.geology.maficIndex).toBeGreaterThanOrEqual(0.55);
    expect(olympusUnnamed.morphology.medianSlopeDeg).toBeGreaterThanOrEqual(10);

    const imbriumUnnamed = synthesizeCelestialTarget({
      body: 'moon',
      lat: 32.8,
      lon: -15.6,
      name: 'Moon (32.80°, -15.60°)',
      presetId: 'moon_base_isru',
    });
    const highlandUnnamed = synthesizeCelestialTarget({
      body: 'moon',
      lat: -10.0,
      lon: 15.0,
      name: 'Moon (-10.00°, 15.00°)',
      presetId: 'moon_base_isru',
    });

    expect(imbriumUnnamed.elevationM).toBeLessThan(0);
    expect(imbriumUnnamed.geology.tiO2WtPct).toBeGreaterThan(2.5);
    expect(highlandUnnamed.elevationM).toBeGreaterThan(0);
    expect(highlandUnnamed.geology.tiO2WtPct).toBeLessThan(1.0);
  });

  it('Enforces Lunar vacuum Domain-4 guard so atmospheric weights cannot skew airless Moon targets', () => {
    const scores = {
      geochemistry: { scorePct: 80 },
      morphology: { scorePct: 60 },
      thermal: { scorePct: 70 },
      atmospheric: { scorePct: 12 },
      operations: { scorePct: 90 },
    };

    const wLowAtm = {
      geochemistry: 0.4,
      morphology: 0.2,
      thermal: 0.2,
      atmospheric: 0.0,
      operations: 0.2,
    };
    const wHighAtm = {
      geochemistry: 0.2,
      morphology: 0.1,
      thermal: 0.1,
      atmospheric: 0.5,
      operations: 0.1,
    };

    const sLow = combineDomainScores(scores, wLowAtm, true);
    const sHigh = combineDomainScores(scores, wHighAtm, true);
    expect(sLow).toBeCloseTo(sHigh, 5);

    const moonTarget = synthesizeCelestialTarget({
      body: 'moon',
      lat: 8.33,
      lon: 33.22,
      name: 'Mare Tranquillitatis',
      presetId: 'moon_base_isru',
    });
    const earthSite = synthesizeSiteFromGridCell(grid.cells[0]);
    const cfg: MissionConfig = {
      targetIds: [moonTarget.id],
      presetId: 'moon_base_isru',
      domainWeights: wHighAtm,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'ignore',
      allowedPermitTiers: ALL_PERMITS,
    };
    const dossier = evaluateTargetIsolated(moonTarget, [earthSite], cfg);
    expect(dossier.rankedCandidates[0].domainScores.atmospheric.observedDims).toBe(0);
  });

  it('Enforces maxSlopeFilterDeg pre-Stage-2 across isolated ranking, robustness, and portfolio optimization', () => {
    const olympus = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.65,
      lon: -133.8,
      name: 'Olympus Mons Scarp',
      presetId: 'rover_mobility',
    });
    const cfg: MissionConfig = {
      targetIds: [olympus.id],
      presetId: 'rover_mobility',
      domainWeights: PRESET_DOMAIN_WEIGHTS.rover_mobility,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'clean_instrument_test',
      allowedPermitTiers: ALL_PERMITS,
      maxSlopeFilterDeg: 5.0,
      searchScope: 'standard_100',
    };

    const { dossier } = evaluateTargetAcrossGlobe(olympus, [], cfg, grid);
    expect(dossier.rankedCandidates.length).toBeGreaterThan(10);
    for (const c of dossier.rankedCandidates) {
      expect(c.site.morphology.medianSlopeDeg).toBeLessThanOrEqual(5.0);
    }
    if (dossier.portfolio) {
      expect(dossier.portfolio.siteA.morphology.medianSlopeDeg).toBeLessThanOrEqual(5.0);
      expect(dossier.portfolio.siteB.morphology.medianSlopeDeg).toBeLessThanOrEqual(5.0);
    }
  });

  it('Computes full-union CrossTargetMatrix without 0% fallbacks or fake rank: 99 entries', () => {
    const jezero = synthesizeCelestialTarget({
      body: 'mars',
      lat: 18.38,
      lon: 77.58,
      name: 'Jezero Crater Delta',
      presetId: 'astrobiology',
    });
    const psr = synthesizeCelestialTarget({
      body: 'moon',
      lat: -89.5,
      lon: 0.0,
      name: 'Shackleton PSR Floor',
      presetId: 'cryogenic_drill',
    });
    const cfg: MissionConfig = {
      targetIds: [jezero.id, psr.id],
      presetId: 'astrobiology',
      domainWeights: PRESET_DOMAIN_WEIGHTS.astrobiology,
      epochDateIso: '2026-07-15',
      durationDays: 21,
      astrobiologyMode: 'biosignature_habitability_analog',
      allowedPermitTiers: ALL_PERMITS,
    };

    const res = evaluateAllTargetsGlobally([jezero, psr], [], cfg, grid);
    expect(res.crossTargetMatrix).not.toBeNull();
    const matrix = res.crossTargetMatrix!;
    expect(matrix.rows.length).toBeGreaterThanOrEqual(15);

    const unionSiteIds = new Set(
      res.dossiers.flatMap((d) => d.rankedCandidates.map((c) => c.site.id))
    );
    expect(matrix.rows.length).toBe(unionSiteIds.size);

    for (const row of matrix.rows) {
      for (const tid of matrix.targetIds) {
        const s = row.scoresByTargetId[tid];
        expect(typeof s).toBe('number');
        expect(s).toBeGreaterThan(0);
      }
    }

    for (const dossier of res.dossiers) {
      dossier.rankedCandidates.forEach((c, idx) => {
        expect(c.rank).toBe(idx + 1);
      });
    }
  });

  it('Never hallucinates subsurface voids or marks elevation-only polar sites as full DEM verified', () => {
    const plainCell = grid.cells.find((row) => row[10] === 0) ?? grid.cells[0];
    const baseSite = synthesizeSiteFromGridCell(plainCell);
    expect(baseSite.voidProfile.voidType).toBe('none');

    const coordKey = makeLiveCoordKey(baseSite.lat, baseSite.lon);
    const polarPartialPatch: LiveTelemetryPatch = {
      coordKey,
      lat: baseSite.lat,
      lon: baseSite.lon,
      powerLive: true,
      demLive: true,
      macroLive: true,
      osmLive: false,
      elevationM: 2850,
      medianSlopeDeg: null,
      p95SlopeDeg: null,
      dtmResolutionM: 90,
      demSource: 'open_meteo_fallback',
      elevationOnly: true,
      meanAlbedo: 0.72,
      wind50Ms: 5.5,
      wind95Ms: 11.2,
      thermalInertia: 210,
      monthly: baseSite.monthly,
      geologyPatch: {
        macrostratLithology: 'Basalt lava & Limestone',
        maficIndex: 0.56,
        silicaWtPct: 48.2,
        tiO2WtPct: 1.95,
        clayIndex: 0.05,
        sulfateIndex: 0.04,
        carbonateIndex: 0.03,
        simulantNearest: 'MGS-1',
      },
      voidHint: null,
      roadDistanceKm: null,
      rfQuietnessScore: null,
      permitTier: null,
      verifiedSources: ['NASA POWER Climatology API', 'Open-Meteo Elevation (|lat|>85° elevation only)'],
      warnings: [],
    };

    const patchedPartial = applyLivePatchToSite(baseSite, polarPartialPatch);
    expect(patchedPartial.voidProfile.voidType).toBe('none');
    expect(patchedPartial.liveStatus).toBe('partial');

    const fullVerifiedPatch: LiveTelemetryPatch = {
      ...polarPartialPatch,
      demSource: 'terrarium',
      elevationOnly: false,
      medianSlopeDeg: 4.8,
      p95SlopeDeg: 11.4,
      dtmResolutionM: 30,
    };
    const patchedFull = applyLivePatchToSite(baseSite, fullVerifiedPatch);
    expect(patchedFull.voidProfile.voidType).toBe('none');
    expect(patchedFull.liveStatus).toBe('verified');
    expect(patchedFull.morphology.medianSlopeDeg).toBe(4.8);
  });

  it('Preserves custom target geology/elevation across preset switches and keeps targetOverrides until cleared', () => {
    const store = useMissionStore.getState();
    store.clearTargets();
    store.setPreset('rover_mobility');
    store.addCustomTarget({
      body: 'mars',
      lat: 18.65,
      lon: -133.8,
      name: 'Olympus Coordinate',
      presetId: 'rover_mobility',
    });

    const added = useMissionStore
      .getState()
      .customTargets.find((t) => Math.abs(t.lat - 18.65) < 0.01 && Math.abs(t.lon + 133.8) < 0.01);
    expect(added).toBeDefined();
    const initialElev = added!.elevationM;
    const initialMafic = added!.geology.maficIndex;

    // Switching mission presets must NOT overwrite custom target's geophysical properties
    useMissionStore.getState().setPreset('subsurface_void');
    const afterPreset = useMissionStore
      .getState()
      .customTargets.find((t) => t.id === added!.id);
    expect(afterPreset!.elevationM).toBe(initialElev);
    expect(afterPreset!.geology.maficIndex).toBe(initialMafic);
    expect(afterPreset!.isSubsurfaceVoidTarget).toBe(added!.isSubsurfaceVoidTarget);

    // Custom preset domainWeights are preserved when adding a coordinate target
    useMissionStore.getState().setPreset('custom');
    useMissionStore.getState().setDomainWeight('geochemistry', 0.65);
    const activeWeights = { ...useMissionStore.getState().config.domainWeights };
    useMissionStore.getState().addCustomTarget({
      body: 'moon',
      lat: 32.8,
      lon: -15.6,
      name: 'Custom Weight Moon Site',
    });
    const moonCustom = useMissionStore
      .getState()
      .customTargets.find((t) => t.name === 'Custom Weight Moon Site');
    expect(moonCustom!.defaultDomainWeights.geochemistry).toBeCloseTo(activeWeights.geochemistry, 4);

    // Target overrides persist through weight edits until explicitly cleared
    useMissionStore.setState((prev) => ({
      config: {
        ...prev.config,
        targetOverrides: {
          [added!.id]: {
            presetId: 'astrobiology',
            domainWeights: PRESET_DOMAIN_WEIGHTS.astrobiology,
            astrobiologyMode: 'biosignature_habitability_analog',
            componentTitle: 'AI Biosignature Phase',
          },
        },
      },
    }));
    const keys: DomainKey[] = ['geochemistry', 'morphology', 'thermal', 'atmospheric', 'operations'];
    expect(keys.length).toBe(5);
    useMissionStore.getState().setDomainWeight('thermal', 0.35);
    expect(useMissionStore.getState().config.targetOverrides?.[added!.id]).toBeDefined();

    useMissionStore.getState().clearTargetOverrides();
    expect(useMissionStore.getState().config.targetOverrides).toBeUndefined();
  });

  it('Enforces strict Hono API validation on tile layers/bodies and batch size limits', async () => {
    const healthRes = await app.request('/api/v1/health');
    expect(healthRes.status).toBe(200);

    const badLayerRes = await app.request('/api/v1/tiles/mars/bad_layer/0/0/0');
    expect(badLayerRes.status).toBe(400);

    const badBodyRes = await app.request('/api/v1/tiles/jupiter/mola_color/0/0/0');
    expect(badBodyRes.status).toBe(400);

    const oversizedPoints = Array.from({ length: 41 }, (_, idx) => ({
      lat: 10 + idx * 0.1,
      lon: 20,
    }));
    const batchRes = await app.request('/api/v1/probe/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: oversizedPoints }),
    });
    expect(batchRes.status).toBe(400);
  });

  it('Computes stitched Terrarium slopes accurately across a 256px tile boundary', () => {
    const resM = 30;
    const slopePerPx = 6.0; // exact analytical gradient = 6 / 30 = 0.2 -> atan(0.2) = 11.3099 deg
    const elevFn = (gx: number, _gy: number) => 500 + gx * slopePerPx;

    const tiles = new Map<string, PNG>();
    tiles.set('10_10', encodeTerrariumTile(elevFn, 0));
    tiles.set('11_10', encodeTerrariumTile(elevFn, 256));

    // Pixel px=252 crosses into tile 11_10 during the 34x34 neighborhood scan
    const seamResult = computeStitchedTerrariumSlopes(tiles, 12, 10, 10, 252, 128, resM);
    const interiorResult = computeStitchedTerrariumSlopes(tiles, 12, 10, 10, 128, 128, resM);
    const expectedDeg = (Math.atan(slopePerPx / resM) * 180) / Math.PI;

    expect(seamResult.medianSlopeDeg).toBeCloseTo(expectedDeg, 1);
    expect(seamResult.p95SlopeDeg).toBeCloseTo(expectedDeg, 1);
    expect(seamResult.medianSlopeDeg).toBeCloseTo(interiorResult.medianSlopeDeg, 2);
  });
});
