export type BodyType = 'mars' | 'moon' | 'earth';

export type CelestialBody = 'mars' | 'moon';

export type DomainKey =
  | 'geochemistry'
  | 'morphology'
  | 'thermal'
  | 'atmospheric'
  | 'operations';

export type DomainWeights = Record<DomainKey, number>;

export type MissionPresetId =
  | 'moon_base_isru'
  | 'subsurface_void'
  | 'astrobiology'
  | 'rover_mobility'
  | 'cryogenic_drill'
  | 'custom';

export type AstrobiologyMode =
  | 'clean_instrument_test'
  | 'biosignature_habitability_analog'
  | 'ignore';

export type VoidType =
  | 'none'
  | 'lava_tube'
  | 'karst_cave'
  | 'mine_shaft'
  | 'impact_melt_pit'
  | 'subglacial_cavern';

export type ProcessTag =
  | 'aeolian_saltation'
  | 'dust_devils_storms'
  | 'fluvial_deltaic_sedimentation'
  | 'evaporite_brine_precipitation'
  | 'acid_hydrothermal_alteration'
  | 'effusive_basalt_volcanism'
  | 'lava_tube_inflation'
  | 'cryogenic_sublimation_permafrost'
  | 'impact_shock_ejecta'
  | 'pit_collapse_karst';

export type ExtremophileGuild =
  | 'halophile'
  | 'psychrophile'
  | 'acidophile'
  | 'thermophile'
  | 'cryptoendolith'
  | 'chemoautotroph';

export type PermitTier =
  | 'open_public'
  | 'regulated_research'
  | 'protected_park'
  | 'polar_expedition';

export type ProvenanceTier =
  | 'tier1_literature_plus_nasa'
  | 'tier2_live_probe'
  | 'tier2_best_effort_fallback'
  | 'global_screening_1deg';

export interface MonthlyClimatologyBin {
  month: number; // 1..12
  tMeanK: number;
  tStdK: number;
  diurnalDeltaK: number;
  pPrecipGt5Mm: number; // [0, 1] fraction of days > 5 mm
  pressureKpa: number;
  ambientDensityKgM3: number;
  uvAbFluxWm2: number;
  clearSkyFraction: number; // [0, 1]
  grazingSunHoursPerDay: number;
  snowDepthCm: number;
  gwettop: number; // [0, 1]
}

export interface GeochemistryProfile {
  maficIndex: number; // (FeO+MgO)/(SiO2+Al2O3+alkalis)
  silicaWtPct: number;
  tiO2WtPct: number;
  clayIndex: number; // [0, 1]
  sulfateIndex: number; // [0, 1]
  carbonateIndex: number; // [0, 1]
  waterEquivalentHydrogenWtPct: number;
  simulantNearest?: string;
  macrostratLithology?: string;
}

export interface MorphologyProfile {
  medianSlopeDeg: number;
  p95SlopeDeg: number;
  dtmResolutionM: number;
  rockCfaK: number | null; // [0, 1] Golombek-Rapp CFA
  cohesionKpa: number | null;
  frictionAngleDeg: number | null;
  regolithThicknessM: number | null;
  iceTableDepthM: number | null;
  sarBackscatterSigma0Db: number | null;
}

export interface VoidProfile {
  voidType: VoidType;
  overburdenThicknessM: number | null;
  voidSpanWidthM: number | null;
  ceilingHeightM: number | null;
  skylightAccessSlopeDeg: number | null;
  subterraneanDeltaTK: number | null;
}

export interface IsruProfile {
  ilmeniteO2YieldPotential: number; // [0, 1]
  constructionFeedstockSuitability: number; // [0, 1]
  landingPlumeDustHazard: number; // [0, 1] (lower = less dust hazard)
  directToEarthVisibilityPct: number; // [0, 100]
}

export interface AstrobiologyProfile {
  tocWtPct: number | null; // Total Organic Carbon wt%
  waterActivityAw: number | null; // [0, 1]
  surfacePh: number | null;
  biosignaturePreservationIndex: number; // [0, 1]
  extremophileGuilds: ExtremophileGuild[];
}

export interface DataLineageItem {
  domain: DomainKey | 'void' | 'isru' | 'astrobiology';
  source: string;
  detail: string;
  resolutionOrPeriod: string;
}

export type SearchScope = 'standard_100' | 'broad_250';

export type LiveVerificationStatus = 'verified' | 'partial' | 'grid_baseline';

export interface EarthAnalogSite {
  id: string;
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  elevationM: number;
  provenanceTier: ProvenanceTier;
  liveStatus?: LiveVerificationStatus;
  verifiedSources?: string[];
  isClassicRegion: boolean;
  isAntiAnalog?: boolean;
  antiAnalogNote?: string;
  permitTier: PermitTier;
  geology: GeochemistryProfile;
  morphology: MorphologyProfile;
  thermalStatic: {
    apparentThermalInertia: number;
    albedo: number;
  };
  aeolianStatic: {
    medianGrainDiameterUm: number;
    particleDensityKgM3: number;
  };
  operationsStatic: {
    roadDistanceKm: number;
    rfQuietnessScore: number; // [0, 1]
    ndvi: number;
    ndwi: number;
    ndsi: number;
    logisticsFrictionIndex: number; // [0, 1]
  };
  monthly: MonthlyClimatologyBin[]; // exactly 12 entries (month 1..12)
  voidProfile: VoidProfile;
  isruProfile: IsruProfile;
  astrobiology: AstrobiologyProfile;
  activeProcesses: ProcessTag[];
  relictProcesses: ProcessTag[];
  earthCoBenefits: string;
  dataLineage: DataLineageItem[];
  citations: string[];
}

export interface CelestialTarget {
  id: string;
  name: string;
  body: CelestialBody;
  lat: number;
  lon: number;
  elevationM: number;
  featureFootprintKm: number;
  missionArchetype: string;
  summary: string;
  isAnhydrousRegolith: boolean;
  isVacuumRegime: boolean;
  requiresCryogenicIce: boolean;
  isSubsurfaceVoidTarget: boolean;
  isPermanentBaseCandidate: boolean;
  horizonMaskMaxDeg: number;
  gravityMs2: number;
  geology: GeochemistryProfile & { simulantReference: string };
  morphology: MorphologyProfile;
  thermalBase: {
    apparentThermalInertia: number;
    tMeanK: number;
    tSeasonalAmpK: number;
    diurnalDeltaK: number;
    albedo: number;
    uvAbFluxWm2: number;
    uvCFluxWm2: number;
  };
  atmosphericBase: {
    ambientDensityKgM3: number;
    medianGrainDiameterUm: number;
    particleDensityKgM3: number;
    dustOpacityTauBase: number;
  };
  operationsIdeal: {
    grazingSunHoursPerDay: number;
    clearSkyFraction: number;
    visualAlienation: number;
    rfQuietnessScore: number;
    roadDistanceKm: number;
    logisticsFrictionIndex: number;
  };
  voidProfile?: VoidProfile;
  isruRequirements?: IsruProfile;
  astrobiologyTarget?: {
    targetModeDefault: AstrobiologyMode;
    waterActivityAw: number | null;
    surfacePh: number | null;
    biosignaturePreservationIndex: number;
    targetGuilds: ExtremophileGuild[];
  };
  activeProcesses: ProcessTag[];
  relictProcesses: ProcessTag[];
  defaultPreset: MissionPresetId;
  defaultDomainWeights: DomainWeights;
  dataSources: string[];
  citations: string[];
}

export interface EphemerisState {
  epochDateIso: string;
  dayOfYear: number;
  marsLsDeg: number;
  lunarSubsolarLatDeg: number;
  lunarMaxSolarElevDeg: number;
  lunarIsPermanentlyShadowed: boolean;
  targetEffectiveTempK: number;
  targetEffectiveDensityKgM3: number;
  targetEffectiveThresholdVelMs: number | null;
}

export interface TargetConfigOverride {
  presetId: MissionPresetId;
  domainWeights: DomainWeights;
  astrobiologyMode: AstrobiologyMode;
  componentTitle?: string;
  componentRole?: string;
}

export interface MissionConfig {
  targetIds: string[];
  presetId: MissionPresetId;
  domainWeights: DomainWeights;
  epochDateIso: string; // YYYY-MM-DD
  durationDays: number; // [3, 90]
  astrobiologyMode: AstrobiologyMode;
  allowedPermitTiers: PermitTier[];
  featureFootprintKm?: number;
  searchScope?: SearchScope;
  maxSlopeFilterDeg?: number;
  targetOverrides?: Record<string, TargetConfigOverride>;
}

export interface DomainScoreDetail {
  domain: DomainKey;
  scorePct: number; // [0, 100]
  frontierPct: number; // 100 * S_k / max_earth(S_k)
  distanceSq: number;
  pEff: number;
  observedDims: number;
  breachFlags: string[];
}

export interface VoidEvaluation {
  active: boolean;
  scorePct: number;
  voidTypeMatch: string;
  structuralNotes: string[];
}

export interface IsruEvaluation {
  active: boolean;
  scorePct: number;
  ilmeniteYieldPct: number;
  feedstockSuitabilityPct: number;
  plumeHazardPct: number;
  dteCommsPct: number;
}

export interface AstrobiologyEvaluation {
  mode: AstrobiologyMode;
  scorePct: number;
  bioticFalsePositiveRisk: 'low' | 'moderate' | 'high' | 'none';
  guildOverlapCount: number;
  notes: string[];
}

export interface ProcessAnalogyEvaluation {
  similarityPct: number;
  classification: 'Active Process Analog' | 'Relict Morpho-Structural Analog' | 'Hybrid Process Analog' | 'Morpho-Thermal Only';
  matchedActive: ProcessTag[];
  matchedRelict: ProcessTag[];
}

export interface UnreplicatedDeficit {
  id: string;
  label: string;
  severity: 'critical' | 'moderate' | 'advisory';
  detail: string;
  compensationSpec: string;
}

export interface HardwareCompensationSpecs {
  targetGravityMs2: number;
  earthGravityMs2: number;
  gravityRatio: number;
  offloadForcePer100KgN: number;
  offloadFractionPct: number;
  requiresUvCChamber: boolean;
  targetUvCFluxWm2: number;
  optimalGrazingSunHoursPerDay: number;
  optimalLocalWindowNote: string;
  requiresThermalCryoChamber: boolean;
  thermalGapK: number;
  requiresDustSealing: boolean;
}

export interface CandidateNarrative {
  whyItMatches: string;
  whereItBreaksDown: string;
  whatExplorationItEnables: string;
}

export interface CandidateEvaluation {
  site: EarthAnalogSite;
  targetId: string;
  missionFitPct: number; // [0, 100] final campaign-windowed score
  earthFrontierPct: number; // 100 * missionFitPct / max(missionFitPct)
  baseWindowMeanPct: number;
  downsideDriftPenalty: number;
  rainCliffPenalty: number;
  rainExceedanceProb: number;
  bestStartDayOfYear: number;
  monthlyScores: number[]; // length 12
  domainScores: Record<DomainKey, DomainScoreDetail>;
  voidEval: VoidEvaluation;
  isruEval: IsruEvaluation;
  astrobiologyEval: AstrobiologyEvaluation;
  processEval: ProcessAnalogyEvaluation;
  sensitivityRange: [number, number]; // deterministic +-15% weight perturbation
  top3RobustnessPct: number; // 0..100%
  deficits: UnreplicatedDeficit[];
  hardwareSpecs: HardwareCompensationSpecs;
  narrative: CandidateNarrative;
  rank: number;
}

export interface TwoSitePortfolioResult {
  triggeredAutomatically: boolean;
  singleSiteMaxPct: number;
  combinedMinimaxPct: number;
  gainPct: number;
  siteA: EarthAnalogSite;
  siteB: EarthAnalogSite;
  weightsA: DomainWeights;
  weightsB: DomainWeights;
  scoreAPct: number;
  scoreBPct: number;
  allocatedDomainsA: DomainKey[];
  allocatedDomainsB: DomainKey[];
  rationale: string;
}

export interface MultiTargetAssignment {
  targetId: string;
  targetName: string;
  body: CelestialBody;
  assignedSite: 'A' | 'B';
  assignedSiteId: string;
  scorePct: number;
  singleBestPct: number;
}

export interface MultiTargetTwoSitePortfolioResult {
  targetCount: number;
  singleSiteMinimaxPct: number;
  combinedMinimaxPct: number;
  gainPct: number;
  siteA: EarthAnalogSite;
  siteB: EarthAnalogSite;
  assignments: MultiTargetAssignment[];
  rationale: string;
}

export interface TargetEvaluationDossier {
  target: CelestialTarget;
  ephemeris: EphemerisState;
  rankedCandidates: CandidateEvaluation[];
  antiAnalogSpotlight: CandidateEvaluation | null;
  portfolio: TwoSitePortfolioResult | null;
  top3RobustnessPct: number;
  evaluationMs: number;
  totalLocationsScreened?: number;
  qualifiedLocationsCount?: number;
}

export interface CrossTargetMatrixRow {
  siteId: string;
  siteName: string;
  region: string;
  scoresByTargetId: Record<string, number>;
  harmonicVersatilityIndex: number;
}

export interface CrossTargetMatrix {
  targetIds: string[];
  rows: CrossTargetMatrixRow[];
  meanPairwiseRankDissonance: number; // [0, 1]
}

export interface GlobalDiscoveryGridFile {
  version: string;
  resolutionDeg: number;
  generatedAt: string;
  sources: string[];
  columns: string[];
  cells: number[][];
}

export interface DiscoveryCellResult {
  lat: number;
  lon: number;
  elevationM: number;
  isClassicRegion: boolean;
  voidTypeCode: number;
  scorePct: number;
  bestQuarter: number; // 1..4
}

export interface LiveTelemetryPatch {
  coordKey: string;
  lat: number;
  lon: number;
  powerLive: boolean;
  demLive: boolean;
  demSource: 'terrarium' | 'open_meteo_fallback' | 'prior_fallback';
  macroLive: boolean;
  osmLive: boolean;
  elevationM: number | null;
  medianSlopeDeg: number | null;
  p95SlopeDeg: number | null;
  dtmResolutionM: number | null;
  monthly: MonthlyClimatologyBin[] | null;
  meanAlbedo: number | null;
  thermalInertia: number | null;
  wind50Ms: number | null;
  wind95Ms: number | null;
  geologyPatch: Partial<GeochemistryProfile> | null;
  voidHint: VoidType | null;
  roadDistanceKm: number | null;
  rfQuietnessScore: number | null;
  permitTier: PermitTier | null;
  elevationOnly?: boolean;
  verifiedSources: string[];
  warnings: string[];
}

export interface ProbeEarthPointResponse {
  site: EarthAnalogSite;
  patch?: LiveTelemetryPatch;
  latencyMs: number;
  cacheHit: boolean;
  warnings: string[];
}

export interface LiveVerificationBatchResponse {
  patches: LiveTelemetryPatch[];
  latencyMs: number;
  cacheHits: number;
}

export interface CustomMissionPreset {
  id: string;
  name: string;
  description: string;
  basePresetId: Exclude<MissionPresetId, 'custom'>;
  domainWeights: DomainWeights;
  astrobiologyMode: AstrobiologyMode;
  createdBy: 'ai' | 'user';
}

export interface AiFollowUpQuestion {
  id: string;
  question: string;
  reason: string;
  options: Array<{
    label: string;
    answerValue: string;
  }>;
}

export interface AiMissionComponent {
  id: string;
  title: string;
  role: string;
  body: CelestialBody;
  locationName: string;
  lat: number;
  lon: number;
  basePresetId: Exclude<MissionPresetId, 'custom'>;
  domainWeights: DomainWeights;
  astrobiologyMode: AstrobiologyMode;
  rationale: string;
  targetId?: string;
}

export interface AiMissionDesignResponse {
  status: 'ready' | 'needs_clarification';
  source: 'gemini' | 'deterministic_fallback';
  missionSummary: string;
  preset: {
    name: string;
    description: string;
    basePresetId: Exclude<MissionPresetId, 'custom'>;
    domainWeights: DomainWeights;
    astrobiologyMode: AstrobiologyMode;
    durationDays?: number;
    maxSlopeFilterDeg?: number;
  };
  isMultiComponent: boolean;
  splitRationale: string | null;
  components: AiMissionComponent[];
  followUpQuestions: AiFollowUpQuestion[];
  matchedConstraints: Array<{ label: string; effect: string }>;
  warnings: string[];
}
