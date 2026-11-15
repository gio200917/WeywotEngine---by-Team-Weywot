import { create } from 'zustand';
import { PRESET_DOMAIN_WEIGHTS } from '../engine/evaluator.js';
import { computeEphemerisState } from '../engine/physics.js';
import {
  inferDefaultArchetype,
  type SelectablePresetId,
  synthesizeCelestialTarget,
} from '../engine/targetSynthesizer.js';
import {
  runEvaluationPayload,
  type WorkerEvaluateRequest,
  type WorkerEvaluateResponse,
} from '../engine/worker.js';
import {
  makeLiveCoordKey,
} from '../engine/globalDiscoveryEngine.js';
import { resolveEarthRegion } from '../engine/earthRegionResolver.js';
import type {
  AiMissionComponent,
  AiMissionDesignResponse,
  AstrobiologyMode,
  BodyType,
  CelestialBody,
  CelestialTarget,
  CrossTargetMatrix,
  CustomMissionPreset,
  DiscoveryCellResult,
  DomainKey,
  DomainWeights,
  EarthAnalogSite,
  LiveTelemetryPatch,
  LiveVerificationBatchResponse,
  MissionConfig,
  MissionPresetId,
  MultiTargetTwoSitePortfolioResult,
  PermitTier,
  ProbeEarthPointResponse,
  SearchScope,
  TargetConfigOverride,
  TargetEvaluationDossier,
} from '../types/planetary.js';
import {
  defaultProfileIdForPreset,
  findGranularProfile,
} from '../engine/weightingProfiles.js';
import { findNearestGazetteerFeature } from '../components/viewport/planetaryGazetteer.js';

export type ViewComplexity = 'guided' | 'expert';
export type GuidedStep = 'goal' | 'target' | 'review';
export type ViewportMode = 'map' | 'globe';
export type GlobeCameraMode = 'planet_focus' | 'system_overview';
export type EarthOverlay =
  | 'google_satellite'
  | 'sentinel_cloudless'
  | 'blue_marble'
  | 'aster_gdem'
  | 'osm';
export type MarsOverlay = 'mola_color' | 'themis_ir';
export type MoonOverlay = 'lro_wac';

export interface FocusedPinCoords {
  body: BodyType;
  lat: number;
  lon: number;
  zoom?: boolean;
  nonce?: number;
}

export interface InspectedPlanetaryPoint {
  body: CelestialBody;
  lat: number;
  lon: number;
  name: string;
  matchedTargetId: string | null;
  archetype: SelectablePresetId;
  marsLsDeg: number;
  lunarMaxSolarElevDeg: number;
  lunarIsPermanentlyShadowed: boolean;
  estimatedTempK: number;
  regimeNote: string;
}

export interface InspectedEarthPoint {
  lat: number;
  lon: number;
  name: string;
  subtitle?: string;
  sourceKind?: 'cell' | 'search';
  cellScorePct?: number;
  cellBestQuarter?: number;
  lithologyNote?: string;
  nearestSiteId?: string;
  nearestSiteName?: string;
  nearestSiteDistKm?: number;
}

const DEFAULT_PERMITS: PermitTier[] = [
  'open_public',
  'regulated_research',
  'protected_park',
  'polar_expedition',
];

const INITIAL_CONFIG: MissionConfig = {
  targetIds: [],
  presetId: 'rover_mobility',
  domainWeights: { ...PRESET_DOMAIN_WEIGHTS.rover_mobility },
  epochDateIso: '2026-07-15',
  durationDays: 21,
  astrobiologyMode: 'clean_instrument_test',
  allowedPermitTiers: [...DEFAULT_PERMITS],
  searchScope: 'standard_100',
  maxSlopeFilterDeg: 45,
};

let workerInstance: Worker | null = null;
let reqCounter = 0;
let focusNonceCounter = 0;
let batchVerifyNonce = 0;
let lastAutoVerifySignature = '';
let recomputeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function buildAutoVerifySignature(cfg: MissionConfig): string {
  const scope = cfg.searchScope ?? 'standard_100';
  const weightsSig = [
    cfg.domainWeights.geochemistry,
    cfg.domainWeights.morphology,
    cfg.domainWeights.thermal,
    cfg.domainWeights.atmospheric,
    cfg.domainWeights.operations,
  ]
    .map((v) => v.toFixed(4))
    .join(',');
  const permitsSig = [...cfg.allowedPermitTiers].sort().join(',');
  const overridesSig = cfg.targetOverrides
    ? Object.keys(cfg.targetOverrides)
        .sort()
        .map((id) => {
          const ov = cfg.targetOverrides![id];
          const ow = [
            ov.domainWeights.geochemistry,
            ov.domainWeights.morphology,
            ov.domainWeights.thermal,
            ov.domainWeights.atmospheric,
            ov.domainWeights.operations,
          ]
            .map((v) => v.toFixed(4))
            .join(',');
          return `${id}:${ov.presetId}:${ov.astrobiologyMode}:${ow}`;
        })
        .join(';')
    : '';
  return [
    cfg.targetIds.join(','),
    scope,
    cfg.presetId,
    weightsSig,
    cfg.astrobiologyMode,
    permitsSig,
    cfg.epochDateIso,
    String(cfg.durationDays),
    String(cfg.featureFootprintKm ?? 5),
    String(cfg.maxSlopeFilterDeg ?? 45),
    overridesSig,
  ].join('|');
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function angularDistDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat1 - lat2;
  let dLon = Math.abs(lon1 - lon2);
  if (dLon > 180) dLon = 360 - dLon;
  return Math.hypot(dLat, dLon * Math.cos((lat1 * Math.PI) / 180));
}

function astroModeForPreset(presetId: MissionPresetId): AstrobiologyMode {
  return presetId === 'astrobiology'
    ? 'biosignature_habitability_analog'
    : presetId === 'moon_base_isru' || presetId === 'subsurface_void'
      ? 'ignore'
      : 'clean_instrument_test';
}

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker(
        new URL('../engine/worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch {
      return null;
    }
  }
  return workerInstance;
}

export interface MissionState {
  targets: CelestialTarget[];
  customTargets: CelestialTarget[];
  probedSites: EarthAnalogSite[];
  config: MissionConfig;
  dossiers: TargetEvaluationDossier[];
  crossTargetMatrix: CrossTargetMatrix | null;
  multiTargetPortfolio: MultiTargetTwoSitePortfolioResult | null;
  discoveryCells: DiscoveryCellResult[];
  discoveryCellsByTarget: Record<string, DiscoveryCellResult[]>;
  totalLocationsScreened: number;

  activeTargetTabId: string;
  viewComplexity: ViewComplexity;
  guidedStep: GuidedStep;
  viewportMode: ViewportMode;
  globeCameraMode: GlobeCameraMode;
  webglFallbackMsg: string | null;
  focusedPinCoords: FocusedPinCoords | null;
  bodyFocus: BodyType;
  earthOverlay: EarthOverlay;
  marsOverlay: MarsOverlay;
  moonOverlay: MoonOverlay;
  showLocationLabels: boolean;
  showDiscoveryHeatmap: boolean;
  probeModeActive: boolean;
  probingInFlight: boolean;
  probeStatusMsg: string | null;
  probeErrorMsg: string | null;
  probeWarnings: string[];
  selectedSiteId: string | null;
  siteScrollNonce: number;
  inspectedPlanetaryPoint: InspectedPlanetaryPoint | null;
  inspectedEarthPoint: InspectedEarthPoint | null;
  exportModalOpen: boolean;
  maxSlopeFilterDeg: number;
  computeLatencyMs: number;
  isComputing: boolean;
  weightingProfileId: string;
  customPresets: CustomMissionPreset[];
  aiMissionDesign: AiMissionDesignResponse | null;
  aiDesignLoading: boolean;
  aiDesignError: string | null;
  aiClarificationHistory: Array<{ question: string; answer: string }>;
  aiLastPrompt: string;
  livePatches: Record<string, LiveTelemetryPatch>;
  batchVerifyState: {
    inFlight: boolean;
    total: number;
    completed: number;
    verifiedCount: number;
    partialCount: number;
    error: string | null;
  };

  initialize: () => void;
  recompute: () => void;
  verifyShortlistLive: (
    maxCandidates?: number,
    options?: { force?: boolean }
  ) => Promise<void>;
  setSearchScope: (scope: SearchScope) => void;
  setGuidedStep: (step: GuidedStep) => void;
  normalizeDomainWeights: () => void;
  toggleTarget: (targetId: string) => void;
  addCustomTarget: (params: {
    body: CelestialBody;
    lat: number;
    lon: number;
    name?: string;
    presetId?: SelectablePresetId;
  }) => void;
  removeCustomTarget: (targetId: string) => void;
  clearTargets: () => void;
  setPreset: (presetId: MissionPresetId) => void;
  selectWeightingProfile: (profileId: string) => void;
  setDomainWeight: (domain: DomainKey, value: number) => void;
  setEpochDate: (epochDateIso: string) => void;
  setDurationDays: (days: number) => void;
  setAstrobiologyMode: (mode: AstrobiologyMode) => void;
  togglePermitTier: (tier: PermitTier) => void;
  setMaxSlopeFilter: (maxDeg: number) => void;
  setViewComplexity: (mode: ViewComplexity) => void;
  setViewportMode: (mode: ViewportMode) => void;
  setGlobeCameraMode: (mode: GlobeCameraMode) => void;
  setWebglFallbackMsg: (msg: string | null) => void;
  triggerWebglFallback: (reason: string) => void;
  setFocusedPinCoords: (coords: FocusedPinCoords | null) => void;
  setBodyFocus: (body: BodyType) => void;
  setEarthOverlay: (overlay: EarthOverlay) => void;
  setMarsOverlay: (overlay: MarsOverlay) => void;
  setMoonOverlay: (overlay: MoonOverlay) => void;
  setShowLocationLabels: (show: boolean) => void;
  setShowDiscoveryHeatmap: (show: boolean) => void;
  setProbeModeActive: (active: boolean) => void;
  setProbeStatusMsg: (msg: string | null) => void;
  setProbeErrorMsg: (msg: string | null) => void;
  setActiveTargetTabId: (tabId: string) => void;
  setSelectedSiteId: (siteId: string | null) => void;
  selectEarthSite: (
    siteId: string,
    source: 'viewport' | 'dossier',
    targetIdOverride?: string
  ) => void;
  inspectPlanetaryPoint: (params: {
    body: CelestialBody;
    lat: number;
    lon: number;
    matchedTargetId?: string | null;
    name?: string;
    flyTo?: boolean;
  }) => void;
  setInspectedArchetype: (archetype: SelectablePresetId) => void;
  promoteInspectedTarget: (archetypeOverride?: SelectablePresetId) => void;
  inspectEarthPlace: (params: {
    lat: number;
    lon: number;
    name: string;
    subtitle?: string;
  }) => void;
  inspectEarthCell: (params: {
    lat: number;
    lon: number;
    scorePct: number;
    bestQuarter: number;
  }) => void;
  clearInspectedPoint: () => void;
  setExportModalOpen: (open: boolean) => void;
  probeEarthCoordinate: (lat: number, lon: number) => Promise<void>;
  clearTargetOverrides: () => void;
  designMissionWithAi: (
    prompt: string,
    newAnswers?: Array<{ question: string; answer: string }>,
    options?: { resetHistory?: boolean }
  ) => Promise<void>;
  focusAiComponent: (component: AiMissionComponent) => void;
  clearAiDesign: () => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  targets: [],
  customTargets: [],
  probedSites: [],
  config: INITIAL_CONFIG,
  dossiers: [],
  crossTargetMatrix: null,
  multiTargetPortfolio: null,
  discoveryCells: [],
  discoveryCellsByTarget: {},
  totalLocationsScreened: 17768,

  activeTargetTabId: '',
  viewComplexity: 'guided',
  guidedStep: 'goal',
  viewportMode: 'globe',
  globeCameraMode: 'planet_focus',
  webglFallbackMsg: null,
  focusedPinCoords: null,
  bodyFocus: 'mars',
  earthOverlay: 'google_satellite',
  marsOverlay: 'mola_color',
  moonOverlay: 'lro_wac',
  showLocationLabels: true,
  showDiscoveryHeatmap: true,
  probeModeActive: false,
  probingInFlight: false,
  probeStatusMsg: null,
  probeErrorMsg: null,
  probeWarnings: [],
  selectedSiteId: null,
  siteScrollNonce: 0,
  inspectedPlanetaryPoint: null,
  inspectedEarthPoint: null,
  exportModalOpen: false,
  maxSlopeFilterDeg: 45,
  computeLatencyMs: 0,
  isComputing: false,
  weightingProfileId: 'rover_mobility:standard',
  customPresets: [],
  aiMissionDesign: null,
  aiDesignLoading: false,
  aiDesignError: null,
  aiClarificationHistory: [],
  aiLastPrompt: '',
  livePatches: {},
  batchVerifyState: {
    inFlight: false,
    total: 0,
    completed: 0,
    verifiedCount: 0,
    partialCount: 0,
    error: null,
  },

  initialize: () => {
    get().recompute();
  },

  recompute: () => {
    if (recomputeDebounceTimer !== null) {
      clearTimeout(recomputeDebounceTimer);
      recomputeDebounceTimer = null;
    }
    const {
      config,
      probedSites,
      customTargets,
      showDiscoveryHeatmap,
      livePatches,
    } = get();
    if (config.targetIds.length === 0) {
      lastAutoVerifySignature = '';
      set({
        dossiers: [],
        crossTargetMatrix: null,
        multiTargetPortfolio: null,
        discoveryCells: [],
        computeLatencyMs: 0,
        isComputing: false,
      });
      return;
    }

    const requestId = ++reqCounter;
    const includeDiscoveryGrid = showDiscoveryHeatmap;

    const handleResults = (
      res: Omit<WorkerEvaluateResponse, 'requestId' | 'type'>
    ) => {
      const currentTab = get().activeTargetTabId;
      const validTab =
        res.dossiers.some((d) => d.target.id === currentTab) ||
        currentTab === 'matrix' ||
        currentTab === 'portfolio'
          ? currentTab
          : (res.dossiers[0]?.target.id ?? '');

      const cellsMap = res.discoveryCellsByTarget ?? {};
      const activeCells =
        (validTab && cellsMap[validTab]) ||
        (res.dossiers[0] ? cellsMap[res.dossiers[0].target.id] : undefined) ||
        res.discoveryCells;

      set({
        dossiers: res.dossiers,
        crossTargetMatrix: res.crossTargetMatrix,
        multiTargetPortfolio: res.multiTargetPortfolio,
        discoveryCells: activeCells,
        discoveryCellsByTarget: cellsMap,
        totalLocationsScreened: res.totalLocationsScreened,
        computeLatencyMs: res.totalMs,
        activeTargetTabId: validTab,
        isComputing: false,
      });

      const currentConfig = get().config;
      const scope = currentConfig.searchScope ?? 'standard_100';
      const sig = buildAutoVerifySignature(currentConfig);
      if (sig !== lastAutoVerifySignature && res.dossiers.length > 0 && recomputeDebounceTimer === null) {
        lastAutoVerifySignature = sig;
        void get().verifyShortlistLive(scope === 'broad_250' ? 250 : 100);
      }
    };

    const worker = getWorker();
    if (worker) {
      set({ isComputing: true });
      worker.onmessage = (event: MessageEvent<WorkerEvaluateResponse>) => {
        const res = event.data;
        if (res.requestId !== reqCounter) return;
        handleResults(res);
      };

      const req: WorkerEvaluateRequest = {
        type: 'EVALUATE_ALL',
        requestId,
        config,
        probedSites,
        customTargets,
        includeDiscoveryGrid,
        livePatches,
      };
      worker.postMessage(req);
    } else {
      const res = runEvaluationPayload(
        config,
        probedSites,
        includeDiscoveryGrid,
        customTargets,
        livePatches
      );
      handleResults(res);
    }
  },

  verifyShortlistLive: async (maxCandidates, options) => {
    if (typeof window === 'undefined') return;
    const { dossiers, livePatches, config } = get();
    if (dossiers.length === 0) return;

    const forceRefresh = options?.force === true;
    const targetDepth =
      maxCandidates ?? (config.searchScope === 'broad_250' ? 250 : 100);
    const footprintKm = config.featureFootprintKm ?? 5;

    const shortlistCoordKeys = new Set<string>();
    const uniquePoints = new Map<string, { lat: number; lon: number; featureFootprintKm: number }>();
    const maxPerTarget = Math.ceil(targetDepth / Math.max(1, dossiers.length));

    for (let rankIdx = 0; rankIdx < maxPerTarget; rankIdx++) {
      for (const d of dossiers) {
        const cand = d.rankedCandidates[rankIdx];
        if (!cand) continue;
        const coordKey = makeLiveCoordKey(cand.site.lat, cand.site.lon);
        shortlistCoordKeys.add(coordKey);
        const existing = livePatches[coordKey];
        if ((!existing || forceRefresh) && !uniquePoints.has(coordKey)) {
          uniquePoints.set(coordKey, {
            lat: cand.site.lat,
            lon: cand.site.lon,
            featureFootprintKm: footprintKm,
          });
        }
        if (shortlistCoordKeys.size >= targetDepth) break;
      }
      if (shortlistCoordKeys.size >= targetDepth) break;
    }

    const countShortlistStatus = (patches: Record<string, LiveTelemetryPatch>) => {
      let verified = 0;
      let partial = 0;
      for (const key of shortlistCoordKeys) {
        const p = patches[key];
        if (!p) continue;
        const full = p.powerLive && p.demLive && p.medianSlopeDeg !== null && !p.elevationOnly;
        if (full) {
          verified++;
        } else if (p.powerLive || p.demLive || p.macroLive) {
          partial++;
        }
      }
      return { verified, partial };
    };

    const pending = Array.from(uniquePoints.values());
    if (pending.length === 0) {
      const counts = countShortlistStatus(livePatches);
      set((s) => ({
        batchVerifyState: {
          ...s.batchVerifyState,
          inFlight: false,
          total: 0,
          completed: 0,
          verifiedCount: counts.verified,
          partialCount: counts.partial,
          error: null,
        },
      }));
      return;
    }

    const runId = ++batchVerifyNonce;
    const CHUNK_SIZE = 25;
    let completed = 0;
    const initialCounts = countShortlistStatus(livePatches);

    set({
      batchVerifyState: {
        inFlight: true,
        total: pending.length,
        completed: 0,
        verifiedCount: initialCounts.verified,
        partialCount: initialCounts.partial,
        error: null,
      },
    });

    try {
      for (let offset = 0; offset < pending.length; offset += CHUNK_SIZE) {
        if (runId !== batchVerifyNonce) return;
        const chunk = pending.slice(offset, offset + CHUNK_SIZE);
        const resp = await fetch('/api/v1/probe/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: chunk }),
        });

        if (!resp.ok) {
          throw new Error(`Batch verification failed (HTTP ${resp.status})`);
        }

        const data = (await resp.json()) as LiveVerificationBatchResponse;
        if (runId !== batchVerifyNonce) return;

        const nextPatches: Record<string, LiveTelemetryPatch> = { ...get().livePatches };
        for (const p of data.patches) {
          nextPatches[p.coordKey] = p;
        }
        completed += chunk.length;
        const nextCounts = countShortlistStatus(nextPatches);

        set({
          livePatches: nextPatches,
          batchVerifyState: {
            inFlight: completed < pending.length,
            total: pending.length,
            completed,
            verifiedCount: nextCounts.verified,
            partialCount: nextCounts.partial,
            error: null,
          },
        });

        // Recompute immediately on first chunk and final chunk for responsive re-ranking
        if (offset === 0 || completed >= pending.length) {
          get().recompute();
        }
      }
    } catch (err) {
      if (runId !== batchVerifyNonce) return;
      lastAutoVerifySignature = '';
      set((s) => ({
        batchVerifyState: {
          ...s.batchVerifyState,
          inFlight: false,
          error: err instanceof Error ? err.message : 'Live verification paused.',
        },
      }));
    }
  },

  setSearchScope: (scope) => {
    set((s) => ({
      config: { ...s.config, searchScope: scope },
    }));
    get().recompute();
  },

  setGuidedStep: (step) => {
    set((s) => {
      const targetStep: GuidedStep =
        step === 'review' && s.config.targetIds.length === 0 ? 'target' : step;
      const defaultTargetBody: BodyType =
        s.customTargets[0]?.body ??
        (s.config.presetId === 'moon_base_isru' ? 'moon' : 'mars');

      let nextBodyFocus = s.bodyFocus;
      if (targetStep === 'review' && s.config.targetIds.length > 0) {
        nextBodyFocus = 'earth';
      } else if (targetStep === 'target' && s.bodyFocus === 'earth') {
        nextBodyFocus = defaultTargetBody;
      } else if (targetStep === 'goal' && s.bodyFocus === 'earth') {
        nextBodyFocus = defaultTargetBody;
      }

      return {
        guidedStep: targetStep,
        bodyFocus: nextBodyFocus,
        globeCameraMode: 'planet_focus' as GlobeCameraMode,
      };
    });
  },

  normalizeDomainWeights: () => {
    set((s) => {
      const w = s.config.domainWeights;
      const sum =
        w.geochemistry + w.morphology + w.thermal + w.atmospheric + w.operations;
      if (sum <= 1e-6) return s;
      const normalized: DomainWeights = {
        geochemistry: Number((w.geochemistry / sum).toFixed(2)),
        morphology: Number((w.morphology / sum).toFixed(2)),
        thermal: Number((w.thermal / sum).toFixed(2)),
        atmospheric: Number((w.atmospheric / sum).toFixed(2)),
        operations: Number((w.operations / sum).toFixed(2)),
      };
      return {
        weightingProfileId: 'custom',
        config: {
          ...s.config,
          presetId: 'custom',
          domainWeights: normalized,
        },
      };
    });
    get().recompute();
  },

  toggleTarget: (targetId) => {
    const { config } = get();
    const exists = config.targetIds.includes(targetId);
    const nextIds = exists
      ? config.targetIds.filter((id) => id !== targetId)
      : [...config.targetIds, targetId];

    set({
      config: { ...config, targetIds: nextIds },
      activeTargetTabId: nextIds[0] ?? '',
    });
    get().recompute();
  },

  addCustomTarget: ({ body, lat, lon, name, presetId }) => {
    const { customTargets, config } = get();
    const clampedLat = Math.max(-89.9, Math.min(89.9, lat));
    const normLon = ((((lon + 180) % 360) + 360) % 360) - 180;
    const nearest = !name ? findNearestGazetteerFeature(body, clampedLat, normLon, 3.0) : null;
    const resolvedName = name?.trim() || nearest?.name;
    const activeMissionArchetype: SelectablePresetId =
      config.presetId !== 'custom'
        ? config.presetId
        : presetId ?? inferDefaultArchetype(body, clampedLat, resolvedName, normLon);

    const synthesized = synthesizeCelestialTarget({
      body,
      lat: clampedLat,
      lon: normLon,
      name: resolvedName,
      presetId: activeMissionArchetype,
      domainWeightsOverride:
        config.presetId === 'custom' ? { ...config.domainWeights } : undefined,
    });

    const nextCustom = [
      ...customTargets.filter((t) => t.id !== synthesized.id),
      synthesized,
    ];
    const nextIds = config.targetIds.includes(synthesized.id)
      ? config.targetIds
      : [...config.targetIds, synthesized.id];

    set({
      customTargets: nextCustom,
      targets: nextCustom,
      config: {
        ...config,
        targetIds: nextIds,
      },
      activeTargetTabId: synthesized.id,
      inspectedPlanetaryPoint: null,
      showDiscoveryHeatmap: true,
      bodyFocus: body,
      globeCameraMode: 'planet_focus' as GlobeCameraMode,
    });
    get().recompute();
  },

  removeCustomTarget: (targetId) => {
    const { customTargets, config, activeTargetTabId, viewComplexity, guidedStep } = get();
    const nextCustom = customTargets.filter((t) => t.id !== targetId);
    const nextIds = config.targetIds.filter((id) => id !== targetId);
    const nextOverrides = config.targetOverrides ? { ...config.targetOverrides } : undefined;
    if (nextOverrides) delete nextOverrides[targetId];
    const shouldStepBack =
      nextIds.length === 0 && viewComplexity === 'guided' && guidedStep === 'review';
    set({
      customTargets: nextCustom,
      targets: nextCustom,
      config: { ...config, targetIds: nextIds, targetOverrides: nextOverrides },
      activeTargetTabId:
        activeTargetTabId === targetId ? (nextIds[0] ?? '') : activeTargetTabId,
      inspectedPlanetaryPoint:
        get().inspectedPlanetaryPoint?.matchedTargetId === targetId
          ? null
          : get().inspectedPlanetaryPoint,
      ...(shouldStepBack
        ? {
            guidedStep: 'target' as GuidedStep,
            bodyFocus: 'mars' as BodyType,
          }
        : {}),
    });
    get().recompute();
  },

  clearTargets: () => {
    set((s) => ({
      customTargets: [],
      targets: [],
      config: { ...s.config, targetIds: [], targetOverrides: undefined },
      activeTargetTabId: '',
      selectedSiteId: null,
      ...(s.viewComplexity === 'guided' && s.guidedStep === 'review'
        ? {
            guidedStep: 'target' as GuidedStep,
            bodyFocus: 'mars' as BodyType,
          }
        : {}),
    }));
    get().recompute();
  },

  setPreset: (presetId) => {
    const weights = PRESET_DOMAIN_WEIGHTS[presetId];
    const astroMode = astroModeForPreset(presetId);

    set((s) => ({
      weightingProfileId: defaultProfileIdForPreset(presetId),
      aiMissionDesign: null,
      config: {
        ...s.config,
        presetId,
        domainWeights: { ...weights },
        astrobiologyMode: astroMode,
        targetOverrides: undefined,
      },
    }));
    get().recompute();
  },

  selectWeightingProfile: (profileId) => {
    if (profileId === 'custom') {
      set((s) => ({
        weightingProfileId: 'custom',
        aiMissionDesign: null,
        config: { ...s.config, presetId: 'custom' },
      }));
      get().recompute();
      return;
    }

    const customPreset = get().customPresets.find((p) => p.id === profileId);
    if (customPreset) {
      set((s) => ({
        weightingProfileId: customPreset.id,
        config: {
          ...s.config,
          presetId: customPreset.basePresetId,
          domainWeights: { ...customPreset.domainWeights },
          astrobiologyMode: customPreset.astrobiologyMode,
          targetOverrides: undefined,
        },
      }));
      get().recompute();
      return;
    }

    const profile = findGranularProfile(profileId);
    if (profile) {
      set((s) => ({
        weightingProfileId: profile.id,
        aiMissionDesign: null,
        config: {
          ...s.config,
          presetId: profile.basePresetId,
          domainWeights: { ...profile.domainWeights },
          astrobiologyMode: profile.astrobiologyMode,
          targetOverrides: undefined,
        },
      }));
      get().recompute();
    }
  },

  setDomainWeight: (domain, value) => {
    const clamped = Math.max(0, Math.min(1, value));
    set((s) => {
      const next: DomainWeights = {
        ...s.config.domainWeights,
        [domain]: clamped,
      };
      return {
        weightingProfileId: 'custom',
        config: {
          ...s.config,
          presetId: 'custom',
          domainWeights: next,
        },
      };
    });
    if (recomputeDebounceTimer !== null) clearTimeout(recomputeDebounceTimer);
    recomputeDebounceTimer = setTimeout(() => {
      recomputeDebounceTimer = null;
      get().recompute();
    }, 120);
  },

  setEpochDate: (epochDateIso) => {
    set((s) => ({
      config: { ...s.config, epochDateIso },
    }));
    get().recompute();
  },

  setDurationDays: (days) => {
    const clamped = Math.max(3, Math.min(90, Math.round(days)));
    set((s) => ({
      config: { ...s.config, durationDays: clamped },
    }));
    if (recomputeDebounceTimer !== null) clearTimeout(recomputeDebounceTimer);
    recomputeDebounceTimer = setTimeout(() => {
      recomputeDebounceTimer = null;
      get().recompute();
    }, 120);
  },

  setAstrobiologyMode: (mode) => {
    set((s) => ({
      config: { ...s.config, astrobiologyMode: mode },
    }));
    get().recompute();
  },

  togglePermitTier: (tier) => {
    set((s) => {
      const has = s.config.allowedPermitTiers.includes(tier);
      const next = has
        ? s.config.allowedPermitTiers.filter((t) => t !== tier)
        : [...s.config.allowedPermitTiers, tier];
      return {
        config: {
          ...s.config,
          allowedPermitTiers: next.length > 0 ? next : [tier],
        },
      };
    });
    get().recompute();
  },

  setMaxSlopeFilter: (maxDeg) => {
    const clamped = Math.max(5, Math.min(45, Math.round(maxDeg)));
    set((s) => ({
      maxSlopeFilterDeg: clamped,
      config: { ...s.config, maxSlopeFilterDeg: clamped },
    }));
    if (recomputeDebounceTimer !== null) clearTimeout(recomputeDebounceTimer);
    recomputeDebounceTimer = setTimeout(() => {
      recomputeDebounceTimer = null;
      get().recompute();
    }, 120);
  },
  setViewComplexity: (mode) => {
    const prevMaxSlope = get().maxSlopeFilterDeg;
    set((s) => {
      if (mode === 'guided') {
        const nextStep: GuidedStep =
          s.config.targetIds.length > 0 ? 'review' : 'goal';
        const nextBody: BodyType =
          nextStep === 'review'
            ? 'earth'
            : s.customTargets[0]?.body ??
              (s.config.presetId === 'moon_base_isru' ? 'moon' : 'mars');
        return {
          viewComplexity: mode,
          guidedStep: nextStep,
          bodyFocus: nextBody,
          maxSlopeFilterDeg: 45,
          config: { ...s.config, maxSlopeFilterDeg: 45 },
          globeCameraMode: 'planet_focus' as GlobeCameraMode,
        };
      }
      return { viewComplexity: mode };
    });
    if (mode === 'guided' && prevMaxSlope !== 45 && get().config.targetIds.length > 0) {
      get().recompute();
    }
  },
  setViewportMode: (mode) => set({ viewportMode: mode }),
  setGlobeCameraMode: (mode) => set({ globeCameraMode: mode }),
  setWebglFallbackMsg: (msg) => set({ webglFallbackMsg: msg }),
  triggerWebglFallback: (reason) =>
    set({ viewportMode: 'map', webglFallbackMsg: reason }),
  setFocusedPinCoords: (coords) => set({ focusedPinCoords: coords }),
  setBodyFocus: (body) =>
    set((s) => ({
      bodyFocus: body,
      globeCameraMode: 'planet_focus',
      inspectedPlanetaryPoint:
        s.inspectedPlanetaryPoint?.body === body ? s.inspectedPlanetaryPoint : null,
      inspectedEarthPoint: body === 'earth' ? s.inspectedEarthPoint : null,
    })),
  setEarthOverlay: (overlay) => set({ earthOverlay: overlay }),
  setMarsOverlay: (overlay) => set({ marsOverlay: overlay }),
  setMoonOverlay: (overlay) => set({ moonOverlay: overlay }),
  setShowLocationLabels: (show) => set({ showLocationLabels: show }),

  setShowDiscoveryHeatmap: (show) => {
    set({ showDiscoveryHeatmap: show });
    get().recompute();
  },

  setProbeModeActive: (active) =>
    set({ probeModeActive: active, probeStatusMsg: null, probeErrorMsg: null }),
  setProbeStatusMsg: (msg) => set({ probeStatusMsg: msg }),
  setProbeErrorMsg: (msg) => set({ probeErrorMsg: msg }),
  setActiveTargetTabId: (tabId) => {
    const { targets, discoveryCellsByTarget, dossiers } = get();
    const target = targets.find((t) => t.id === tabId);
    const nextCells =
      discoveryCellsByTarget[tabId] ??
      (dossiers[0] ? discoveryCellsByTarget[dossiers[0].target.id] : undefined);
    set({
      activeTargetTabId: tabId,
      ...(nextCells ? { discoveryCells: nextCells } : {}),
      focusedPinCoords: target
        ? {
            body: target.body,
            lat: target.lat,
            lon: target.lon,
            zoom: true,
            nonce: ++focusNonceCounter,
          }
        : get().focusedPinCoords,
    });
  },

  setSelectedSiteId: (siteId) => {
    if (siteId) {
      get().selectEarthSite(siteId, 'viewport');
    } else {
      set({ selectedSiteId: null });
    }
  },

  selectEarthSite: (siteId, source, targetIdOverride) => {
    const { probedSites, dossiers, multiTargetPortfolio, activeTargetTabId, siteScrollNonce } =
      get();

    const dossierSites = dossiers.flatMap((d) =>
      d.rankedCandidates.map((c) => c.site)
    );
    const portfolioSites = multiTargetPortfolio
      ? [multiTargetPortfolio.siteA, multiTargetPortfolio.siteB]
      : [];

    const site =
      probedSites.find((s) => s.id === siteId) ??
      dossierSites.find((s) => s.id === siteId) ??
      portfolioSites.find((s) => s.id === siteId);

    const hasOverride =
      Boolean(targetIdOverride) && dossiers.some((d) => d.target.id === targetIdOverride);
    const isDossierTargetTab = dossiers.some((d) => d.target.id === activeTargetTabId);
    const nextTabId = hasOverride
      ? targetIdOverride!
      : isDossierTargetTab
        ? activeTargetTabId
        : (dossiers[0]?.target.id ?? activeTargetTabId);

    set({
      selectedSiteId: siteId,
      activeTargetTabId: nextTabId,
      siteScrollNonce: siteScrollNonce + 1,
      inspectedEarthPoint: null,
      ...(source === 'dossier'
        ? {
            bodyFocus: 'earth' as BodyType,
            globeCameraMode: 'planet_focus' as GlobeCameraMode,
            focusedPinCoords: site
              ? {
                  body: 'earth' as BodyType,
                  lat: site.lat,
                  lon: site.lon,
                  zoom: true,
                  nonce: ++focusNonceCounter,
                }
              : get().focusedPinCoords,
          }
        : {}),
    });
  },

  inspectPlanetaryPoint: ({ body, lat, lon, matchedTargetId, name, flyTo }) => {
    const { targets, config } = get();

    let matched: CelestialTarget | undefined = matchedTargetId
      ? targets.find((t) => t.id === matchedTargetId && t.body === body)
      : undefined;

    if (!matched) {
      let bestDist = 1.8;
      for (const t of targets) {
        if (t.body !== body) continue;
        const dist = angularDistDeg(lat, lon, t.lat, t.lon);
        if (dist <= bestDist) {
          bestDist = dist;
          matched = t;
        }
      }
    }

    const nearestFeature = matched
      ? null
      : findNearestGazetteerFeature(body, lat, lon, 3.2);

    const resolvedName =
      matched?.name ??
      name ??
      nearestFeature?.name ??
      `${body === 'mars' ? 'Mars' : 'Moon'} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;

    const archetype: SelectablePresetId =
      matched && matched.defaultPreset !== 'custom'
        ? matched.defaultPreset
        : inferDefaultArchetype(body, lat, resolvedName);

    const previewTarget =
      matched ??
      synthesizeCelestialTarget({
        body,
        lat,
        lon,
        name: resolvedName,
        presetId: archetype,
      });

    const ephem = computeEphemerisState(previewTarget, config.epochDateIso);
    const regimeNote =
      body === 'mars'
        ? `${previewTarget.atmosphericBase.ambientDensityKgM3.toFixed(4)} kg/m³ CO₂ · ${
            previewTarget.requiresCryogenicIce
              ? 'Subsurface Ice Regime'
              : previewTarget.isSubsurfaceVoidTarget
                ? 'Subsurface Void'
                : 'Aeolian / Regolith'
          }`
        : `Vacuum Regime · ${
            ephem.lunarIsPermanentlyShadowed
              ? 'Permanently Shadowed (PSR)'
              : Math.abs(lat) >= 75
                ? 'Polar Grazing Sun'
                : previewTarget.geology.tiO2WtPct >= 2.0
                  ? 'High-Ti Mare Basalt'
                  : 'Highland Anorthosite'
          }`;

    set({
      inspectedEarthPoint: null,
      inspectedPlanetaryPoint: {
        body,
        lat: matched ? matched.lat : lat,
        lon: matched ? matched.lon : lon,
        name: resolvedName,
        matchedTargetId: matched?.id ?? null,
        archetype,
        marsLsDeg: ephem.marsLsDeg,
        lunarMaxSolarElevDeg: ephem.lunarMaxSolarElevDeg,
        lunarIsPermanentlyShadowed: ephem.lunarIsPermanentlyShadowed,
        estimatedTempK: ephem.targetEffectiveTempK,
        regimeNote,
      },
      ...(flyTo
        ? {
            bodyFocus: body,
            globeCameraMode: 'planet_focus' as GlobeCameraMode,
            focusedPinCoords: {
              body,
              lat: matched ? matched.lat : lat,
              lon: matched ? matched.lon : lon,
              zoom: true,
              nonce: ++focusNonceCounter,
            },
          }
        : {}),
    });
  },

  setInspectedArchetype: (archetype) => {
    const pt = get().inspectedPlanetaryPoint;
    if (!pt) return;
    const synth = synthesizeCelestialTarget({
      body: pt.body,
      lat: pt.lat,
      lon: pt.lon,
      name: pt.name,
      presetId: archetype,
    });
    const ephem = computeEphemerisState(synth, get().config.epochDateIso);
    set({
      inspectedPlanetaryPoint: {
        ...pt,
        archetype,
        estimatedTempK: ephem.targetEffectiveTempK,
        lunarIsPermanentlyShadowed: ephem.lunarIsPermanentlyShadowed,
      },
    });
  },

  promoteInspectedTarget: (archetypeOverride) => {
    const { inspectedPlanetaryPoint, customTargets, config } = get();
    if (!inspectedPlanetaryPoint) return;

    const chosenArchetype: SelectablePresetId =
      archetypeOverride ??
      (config.presetId !== 'custom'
        ? config.presetId
        : inspectedPlanetaryPoint.archetype);

    if (inspectedPlanetaryPoint.matchedTargetId) {
      const targetId = inspectedPlanetaryPoint.matchedTargetId;
      const nextIds = config.targetIds.includes(targetId)
        ? config.targetIds
        : [...config.targetIds, targetId];
      set({
        config: {
          ...config,
          targetIds: nextIds,
        },
        activeTargetTabId: targetId,
        inspectedPlanetaryPoint: null,
        bodyFocus: inspectedPlanetaryPoint.body,
        globeCameraMode: 'planet_focus',
        showDiscoveryHeatmap: true,
      });
      get().recompute();
      return;
    }

    const synthesized = synthesizeCelestialTarget({
      body: inspectedPlanetaryPoint.body,
      lat: inspectedPlanetaryPoint.lat,
      lon: inspectedPlanetaryPoint.lon,
      name: inspectedPlanetaryPoint.name,
      presetId: chosenArchetype,
    });

    const nextCustom = [
      ...customTargets.filter((t) => t.id !== synthesized.id),
      synthesized,
    ];
    const nextIds = config.targetIds.includes(synthesized.id)
      ? config.targetIds
      : [...config.targetIds, synthesized.id];

    set({
      customTargets: nextCustom,
      targets: nextCustom,
      config: {
        ...config,
        targetIds: nextIds,
      },
      activeTargetTabId: synthesized.id,
      inspectedPlanetaryPoint: null,
      bodyFocus: inspectedPlanetaryPoint.body,
      globeCameraMode: 'planet_focus' as GlobeCameraMode,
      showDiscoveryHeatmap: true,
    });
    get().recompute();
  },

  inspectEarthPlace: ({ lat, lon, name, subtitle }) => {
    const { probedSites, dossiers } = get();
    const rankedSites = dossiers.flatMap((d) =>
      d.rankedCandidates.map((c) => c.site)
    );
    const allEarth = [...probedSites, ...rankedSites];

    let nearest: { site: EarthAnalogSite; distKm: number } | null = null;
    for (const s of allEarth) {
      const d = haversineKm(lat, lon, s.lat, s.lon);
      if (!nearest || d < nearest.distKm) {
        nearest = { site: s, distKm: d };
      }
    }

    set({
      bodyFocus: 'earth',
      globeCameraMode: 'planet_focus',
      inspectedPlanetaryPoint: null,
      focusedPinCoords: {
        body: 'earth',
        lat,
        lon,
        zoom: true,
        nonce: ++focusNonceCounter,
      },
    });

    if (nearest && nearest.distKm <= 25) {
      get().selectEarthSite(nearest.site.id, 'viewport');
      return;
    }

    set({
      inspectedEarthPoint: {
        lat,
        lon,
        name,
        subtitle,
        sourceKind: 'search',
        nearestSiteId: nearest?.site.id,
        nearestSiteName: nearest?.site.name,
        nearestSiteDistKm: nearest ? Math.round(nearest.distKm) : undefined,
      },
    });
  },

  inspectEarthCell: ({ lat, lon, scorePct, bestQuarter }) => {
    const { probedSites, dossiers, activeTargetTabId } = get();
    const activeDossier =
      dossiers.find((d) => d.target.id === activeTargetTabId) ?? dossiers[0];
    const rankedSites = activeDossier
      ? activeDossier.rankedCandidates.map((c) => c.site)
      : [];
    const allEarth = [...probedSites, ...rankedSites];

    let nearest: { site: EarthAnalogSite; distKm: number } | null = null;
    for (const s of allEarth) {
      const d = haversineKm(lat, lon, s.lat, s.lon);
      if (!nearest || d < nearest.distKm) {
        nearest = { site: s, distKm: d };
      }
    }

    const regionInfo = resolveEarthRegion(lat, lon);
    set({
      bodyFocus: 'earth',
      globeCameraMode: 'planet_focus',
      inspectedPlanetaryPoint: null,
      inspectedEarthPoint: {
        lat,
        lon,
        name: regionInfo.name,
        subtitle: `${regionInfo.region} · ${regionInfo.country}`,
        sourceKind: 'cell',
        cellScorePct: scorePct,
        cellBestQuarter: bestQuarter,
        lithologyNote: regionInfo.lithologyNote,
        nearestSiteId: nearest?.site.id,
        nearestSiteName: nearest?.site.name,
        nearestSiteDistKm: nearest ? Math.round(nearest.distKm) : undefined,
      },
    });
  },

  clearInspectedPoint: () =>
    set({ inspectedPlanetaryPoint: null, inspectedEarthPoint: null }),

  setExportModalOpen: (open) => set({ exportModalOpen: open }),

  probeEarthCoordinate: async (lat, lon) => {
    const { config, targets, activeTargetTabId, dossiers, siteScrollNonce } = get();
    if (config.targetIds.length === 0) {
      set({
        probeErrorMsg:
          'Add at least 1 Mars or Moon coordinate target before probing Earth coordinates.',
      });
      return;
    }

    const activeTarget =
      targets.find((t) => t.id === activeTargetTabId) ??
      targets.find((t) => config.targetIds.includes(t.id));
    const footprintKm =
      config.featureFootprintKm ?? activeTarget?.featureFootprintKm ?? 5;

    set({
      probingInFlight: true,
      probeErrorMsg: null,
      probeWarnings: [],
      probeStatusMsg: `Probing (${lat.toFixed(2)}°, ${lon.toFixed(2)}°) via NASA POWER & Terrarium...`,
    });

    try {
      const resp = await fetch('/api/v1/probe/earth-point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, featureFootprintKm: footprintKm }),
      });
      if (!resp.ok) {
        let errText = `Live probe service failed (HTTP ${resp.status}).`;
        try {
          const errJson = (await resp.json()) as { error?: string };
          if (errJson?.error) errText = errJson.error;
        } catch {
          // ignore
        }
        throw new Error(errText);
      }

      const data = (await resp.json()) as ProbeEarthPointResponse;
      const isDossierTab = dossiers.some((d) => d.target.id === activeTargetTabId);
      const nextPatches = data.patch
        ? { ...get().livePatches, [data.patch.coordKey]: data.patch }
        : get().livePatches;
      set((s) => ({
        livePatches: nextPatches,
        probedSites: [
          data.site,
          ...s.probedSites.filter((p) => p.id !== data.site.id),
        ],
        selectedSiteId: data.site.id,
        siteScrollNonce: siteScrollNonce + 1,
        activeTargetTabId: isDossierTab
          ? activeTargetTabId
          : (dossiers[0]?.target.id ?? activeTargetTabId),
        inspectedEarthPoint: null,
        focusedPinCoords: {
          body: 'earth',
          lat: data.site.lat,
          lon: data.site.lon,
          zoom: true,
          nonce: ++focusNonceCounter,
        },
        probingInFlight: false,
        probeModeActive: false,
        probeWarnings: data.warnings ?? [],
        probeStatusMsg: `Probed ${data.site.name} in ${data.latencyMs} ms${
          data.cacheHit ? ' (LRU Cache Hit)' : ''
        }`,
      }));
      get().recompute();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Live probe service unavailable.';
      set({
        probingInFlight: false,
        probeErrorMsg: message,
        probeStatusMsg: null,
      });
    }
  },

  clearTargetOverrides: () => {
    set((s) => ({
      config: { ...s.config, targetOverrides: undefined },
    }));
    get().recompute();
  },

  designMissionWithAi: async (prompt, newAnswers, options) => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      set({ aiDesignError: 'Enter a mission description before running AI Mission Architect.' });
      return;
    }

    const resetHistory = options?.resetHistory ?? !newAnswers;
    const nextHistory = resetHistory
      ? []
      : [...get().aiClarificationHistory, ...(newAnswers ?? [])];

    const { targets, config } = get();
    const activeTargets = targets.filter((t) => config.targetIds.includes(t.id));

    set({
      aiDesignLoading: true,
      aiDesignError: null,
      aiLastPrompt: trimmed,
      aiClarificationHistory: nextHistory,
    });

    try {
      const resp = await fetch('/api/v1/ai/design-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          clarificationAnswers: nextHistory,
          activeTargets,
        }),
      });

      if (!resp.ok) {
        let errMessage = `AI Mission Architect failed (HTTP ${resp.status}).`;
        try {
          const errBody = (await resp.json()) as { error?: string };
          if (errBody?.error) errMessage = errBody.error;
        } catch {
          // ignore
        }
        throw new Error(errMessage);
      }

      const design = (await resp.json()) as AiMissionDesignResponse;

      if (design.status === 'needs_clarification' && design.followUpQuestions.length > 0) {
        set({
          aiMissionDesign: design,
          aiDesignLoading: false,
          aiDesignError: null,
        });
        return;
      }

      // Create and save the named custom preset
      const presetId = `ai_preset_${Date.now().toString(36)}`;
      const newPreset: CustomMissionPreset = {
        id: presetId,
        name: design.preset.name,
        description: design.preset.description,
        basePresetId: design.preset.basePresetId,
        domainWeights: { ...design.preset.domainWeights },
        astrobiologyMode: design.preset.astrobiologyMode,
        createdBy: 'ai',
      };

      // Synthesize targets for all mission components across their planetary locations
      const synthesizedTargets: CelestialTarget[] = [];
      const targetOverrides: Record<string, TargetConfigOverride> = {};
      const enrichedComponents: AiMissionComponent[] = [];

      for (const comp of design.components) {
        const target = synthesizeCelestialTarget({
          body: comp.body,
          lat: comp.lat,
          lon: comp.lon,
          name: comp.locationName,
          presetId: comp.basePresetId,
        });
        // Avoid duplicate IDs if two components share coordinates
        const uniqueTarget = synthesizedTargets.some((t) => t.id === target.id)
          ? {
              ...target,
              id: `${target.id}_${comp.id}`,
              name: `${target.name} (${comp.title.split(' ')[0]})`,
            }
          : target;

        synthesizedTargets.push(uniqueTarget);
        targetOverrides[uniqueTarget.id] = {
          presetId: comp.basePresetId,
          domainWeights: { ...comp.domainWeights },
          astrobiologyMode: comp.astrobiologyMode,
          componentTitle: comp.title,
          componentRole: comp.role,
        };
        enrichedComponents.push({
          ...comp,
          targetId: uniqueTarget.id,
        });
      }

      const finalDesign: AiMissionDesignResponse = {
        ...design,
        components: enrichedComponents,
      };

      const nextCustomTargets =
        synthesizedTargets.length > 0 ? synthesizedTargets : get().customTargets;
      const nextTargetIds =
        synthesizedTargets.length > 0
          ? synthesizedTargets.map((t) => t.id)
          : get().config.targetIds;

      set((s) => {
        const nextMaxSlope =
          design.preset.maxSlopeFilterDeg ?? s.maxSlopeFilterDeg;
        return {
          aiDesignLoading: false,
          aiDesignError: null,
          aiMissionDesign: finalDesign,
          customPresets: [
            newPreset,
            ...s.customPresets.filter((p) => p.name !== newPreset.name),
          ].slice(0, 8),
          weightingProfileId: newPreset.id,
          customTargets: nextCustomTargets,
          targets: nextCustomTargets,
          maxSlopeFilterDeg: nextMaxSlope,
          config: {
            ...s.config,
            targetIds: nextTargetIds,
            presetId: design.preset.basePresetId,
            domainWeights: { ...design.preset.domainWeights },
            astrobiologyMode: design.preset.astrobiologyMode,
            durationDays: design.preset.durationDays ?? s.config.durationDays,
            maxSlopeFilterDeg: nextMaxSlope,
            targetOverrides:
              Object.keys(targetOverrides).length > 0 ? targetOverrides : undefined,
          },
          activeTargetTabId: nextTargetIds[0] ?? s.activeTargetTabId,
          guidedStep:
            s.viewComplexity === 'guided' && nextTargetIds.length > 0
              ? ('review' as GuidedStep)
              : s.guidedStep,
          bodyFocus: 'earth',
          globeCameraMode: 'planet_focus',
          showDiscoveryHeatmap: true,
          inspectedPlanetaryPoint: null,
        };
      });
      get().recompute();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'AI Mission Architect request failed.';
      set({
        aiDesignLoading: false,
        aiDesignError: msg,
      });
    }
  },

  focusAiComponent: (component) => {
    const { targets } = get();
    const matched = component.targetId
      ? targets.find((t) => t.id === component.targetId)
      : targets.find(
          (t) =>
            t.body === component.body &&
            Math.abs(t.lat - component.lat) < 0.2 &&
            Math.abs(t.lon - component.lon) < 0.2
        );

    set((s) => ({
      activeTargetTabId: matched?.id ?? s.activeTargetTabId,
      bodyFocus: component.body,
      globeCameraMode: 'planet_focus',
      focusedPinCoords: {
        body: component.body,
        lat: component.lat,
        lon: component.lon,
        zoom: true,
        nonce: ++focusNonceCounter,
      },
    }));
  },

  clearAiDesign: () =>
    set({
      aiMissionDesign: null,
      aiDesignError: null,
      aiClarificationHistory: [],
    }),
}));
