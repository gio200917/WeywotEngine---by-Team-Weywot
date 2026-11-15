import gridJson from '../data/global_discovery_grid.json';
import type {
  CelestialTarget,
  CrossTargetMatrix,
  DiscoveryCellResult,
  EarthAnalogSite,
  GlobalDiscoveryGridFile,
  LiveTelemetryPatch,
  MissionConfig,
  MultiTargetTwoSitePortfolioResult,
  TargetEvaluationDossier,
} from '../types/planetary.js';
import { evaluateAllTargetsGlobally } from './globalDiscoveryEngine.js';

const discoveryGrid = gridJson as GlobalDiscoveryGridFile;

export interface WorkerEvaluateRequest {
  type: 'EVALUATE_ALL';
  requestId: number;
  config: MissionConfig;
  probedSites: EarthAnalogSite[];
  customTargets: CelestialTarget[];
  includeDiscoveryGrid: boolean;
  livePatches?: Record<string, LiveTelemetryPatch>;
}

export interface WorkerEvaluateResponse {
  type: 'EVALUATION_RESULT';
  requestId: number;
  dossiers: TargetEvaluationDossier[];
  crossTargetMatrix: CrossTargetMatrix | null;
  multiTargetPortfolio: MultiTargetTwoSitePortfolioResult | null;
  discoveryCells: DiscoveryCellResult[];
  discoveryCellsByTarget: Record<string, DiscoveryCellResult[]>;
  totalLocationsScreened: number;
  totalMs: number;
}

export function runEvaluationPayload(
  config: MissionConfig,
  probedSites: EarthAnalogSite[],
  includeDiscoveryGrid: boolean,
  customTargets: CelestialTarget[] = [],
  livePatches: Record<string, LiveTelemetryPatch> = {}
): Omit<WorkerEvaluateResponse, 'type' | 'requestId'> {
  const t0 = performance.now();
  const result = evaluateAllTargetsGlobally(
    customTargets,
    probedSites,
    config,
    discoveryGrid,
    livePatches
  );

  const sliceTopCells = (cells: DiscoveryCellResult[]) =>
    [...cells].sort((a, b) => b.scorePct - a.scorePct).slice(0, 2200);

  const discoveryCellsByTarget: Record<string, DiscoveryCellResult[]> = {};
  if (includeDiscoveryGrid) {
    for (const [tid, cells] of Object.entries(result.discoveryCellsByTarget)) {
      discoveryCellsByTarget[tid] = sliceTopCells(cells);
    }
  }

  const discoveryCells = includeDiscoveryGrid
    ? sliceTopCells(result.discoveryCells)
    : [];

  const totalMs = Math.round((performance.now() - t0) * 100) / 100;
  return {
    dossiers: result.dossiers,
    crossTargetMatrix: result.crossTargetMatrix,
    multiTargetPortfolio: result.multiTargetPortfolio,
    discoveryCells,
    discoveryCellsByTarget,
    totalLocationsScreened: result.totalLocationsScreened,
    totalMs,
  };
}

if (typeof self !== 'undefined' && typeof self.onmessage !== 'undefined') {
  self.onmessage = (event: MessageEvent<WorkerEvaluateRequest>) => {
    const msg = event.data;
    if (msg.type === 'EVALUATE_ALL') {
      const result = runEvaluationPayload(
        msg.config,
        msg.probedSites,
        msg.includeDiscoveryGrid,
        msg.customTargets ?? [],
        msg.livePatches ?? {}
      );
      const response: WorkerEvaluateResponse = {
        type: 'EVALUATION_RESULT',
        requestId: msg.requestId,
        ...result,
      };
      self.postMessage(response);
    }
  };
}
