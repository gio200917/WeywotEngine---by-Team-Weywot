import type {
  AstrobiologyMode,
  DomainWeights,
  MissionPresetId,
} from '../types/planetary.js';
import { PRESET_DOMAIN_WEIGHTS } from './evaluator.js';

export type WeightingProfileGroup =
  | 'moon_base_isru'
  | 'subsurface_void'
  | 'astrobiology'
  | 'rover_mobility'
  | 'cryogenic_drill';

export interface GranularWeightingProfile {
  id: string;
  group: WeightingProfileGroup;
  groupLabel: string;
  label: string;
  summary: string;
  basePresetId: Exclude<MissionPresetId, 'custom'>;
  domainWeights: DomainWeights;
  astrobiologyMode: AstrobiologyMode;
}

export const GRANULAR_WEIGHTING_PROFILES: GranularWeightingProfile[] = [
  // Moon Base & ISRU
  {
    id: 'moon_base_isru:standard',
    group: 'moon_base_isru',
    groupLabel: 'Moon Base & ISRU',
    label: 'Moon Base & ISRU · Balanced',
    summary: 'Balanced feedstock, ilmenite O2, terrain slope & DTE comms',
    basePresetId: 'moon_base_isru',
    domainWeights: { ...PRESET_DOMAIN_WEIGHTS.moon_base_isru },
    astrobiologyMode: 'ignore',
  },
  {
    id: 'moon_base_isru:ilmenite',
    group: 'moon_base_isru',
    groupLabel: 'Moon Base & ISRU',
    label: 'ISRU · High-Ti Ilmenite O2 Extraction',
    summary: 'Prioritizes mafic/TiO2 geochemistry for oxygen reduction plants',
    basePresetId: 'moon_base_isru',
    domainWeights: {
      geochemistry: 0.44,
      morphology: 0.18,
      thermal: 0.12,
      atmospheric: 0.02,
      operations: 0.24,
    },
    astrobiologyMode: 'ignore',
  },
  {
    id: 'moon_base_isru:polar_dte',
    group: 'moon_base_isru',
    groupLabel: 'Moon Base & ISRU',
    label: 'Moon Base · Polar Power & DTE Comms',
    summary: 'Maximizes grazing solar illumination, clear-sky ops & DTE line-of-sight',
    basePresetId: 'moon_base_isru',
    domainWeights: {
      geochemistry: 0.14,
      morphology: 0.22,
      thermal: 0.22,
      atmospheric: 0.02,
      operations: 0.40,
    },
    astrobiologyMode: 'ignore',
  },
  {
    id: 'moon_base_isru:sintering',
    group: 'moon_base_isru',
    groupLabel: 'Moon Base & ISRU',
    label: 'ISRU · Regolith Sintering & Pad Prep',
    summary: 'Emphasizes regolith grain mechanics, slope stability & silica feedstock',
    basePresetId: 'moon_base_isru',
    domainWeights: {
      geochemistry: 0.28,
      morphology: 0.34,
      thermal: 0.14,
      atmospheric: 0.04,
      operations: 0.20,
    },
    astrobiologyMode: 'ignore',
  },

  // Subsurface Void / Lava Tube
  {
    id: 'subsurface_void:standard',
    group: 'subsurface_void',
    groupLabel: 'Subsurface Cave / Lava Tube',
    label: 'Subsurface Void · Balanced Skylight',
    summary: 'Activates structural void geometry, cavern shielding & ingress ops',
    basePresetId: 'subsurface_void',
    domainWeights: { ...PRESET_DOMAIN_WEIGHTS.subsurface_void },
    astrobiologyMode: 'ignore',
  },
  {
    id: 'subsurface_void:thermal_shelter',
    group: 'subsurface_void',
    groupLabel: 'Subsurface Cave / Lava Tube',
    label: 'Subsurface Void · Thermal Stability Shelter',
    summary: 'Prioritizes damped subterranean diurnal delta-T and overburden insulation',
    basePresetId: 'subsurface_void',
    domainWeights: {
      geochemistry: 0.16,
      morphology: 0.28,
      thermal: 0.34,
      atmospheric: 0.04,
      operations: 0.18,
    },
    astrobiologyMode: 'ignore',
  },
  {
    id: 'subsurface_void:rf_autonomy',
    group: 'subsurface_void',
    groupLabel: 'Subsurface Cave / Lava Tube',
    label: 'Subsurface Void · RF-Denied Autonomy',
    summary: 'Emphasizes rappelling/ingress slopes, logistics & subterranean SLAM ops',
    basePresetId: 'subsurface_void',
    domainWeights: {
      geochemistry: 0.12,
      morphology: 0.32,
      thermal: 0.12,
      atmospheric: 0.04,
      operations: 0.40,
    },
    astrobiologyMode: 'ignore',
  },

  // Astrobiology & Extremophiles
  {
    id: 'astrobiology:standard',
    group: 'astrobiology',
    groupLabel: 'Astrobiology & Extremophiles',
    label: 'Astrobiology · Biosignature & Clay',
    summary: 'Prioritizes phyllosilicates, sulfates, carbonates & extremophile guilds',
    basePresetId: 'astrobiology',
    domainWeights: { ...PRESET_DOMAIN_WEIGHTS.astrobiology },
    astrobiologyMode: 'biosignature_habitability_analog',
  },
  {
    id: 'astrobiology:evaporite',
    group: 'astrobiology',
    groupLabel: 'Astrobiology & Extremophiles',
    label: 'Astrobiology · Evaporite & Brine Preservation',
    summary: 'Heavy geochemistry focus for paleolake salts, sulfates & endoliths',
    basePresetId: 'astrobiology',
    domainWeights: {
      geochemistry: 0.50,
      morphology: 0.12,
      thermal: 0.14,
      atmospheric: 0.06,
      operations: 0.18,
    },
    astrobiologyMode: 'biosignature_habitability_analog',
  },
  {
    id: 'astrobiology:sterile_blank',
    group: 'astrobiology',
    groupLabel: 'Astrobiology & Extremophiles',
    label: 'Astrobiology · Clean Instrument Blank',
    summary: 'Switches Layer C to penalize terrestrial TOC false-positives',
    basePresetId: 'astrobiology',
    domainWeights: {
      geochemistry: 0.24,
      morphology: 0.16,
      thermal: 0.14,
      atmospheric: 0.08,
      operations: 0.38,
    },
    astrobiologyMode: 'clean_instrument_test',
  },

  // Surface Rover Mobility
  {
    id: 'rover_mobility:standard',
    group: 'rover_mobility',
    groupLabel: 'Surface Rover Mobility',
    label: 'Rover Mobility · Balanced Traverse',
    summary: 'Balanced traction, slope distribution, dust opacity & visual alienation',
    basePresetId: 'rover_mobility',
    domainWeights: { ...PRESET_DOMAIN_WEIGHTS.rover_mobility },
    astrobiologyMode: 'clean_instrument_test',
  },
  {
    id: 'rover_mobility:steep_scarp',
    group: 'rover_mobility',
    groupLabel: 'Surface Rover Mobility',
    label: 'Rover Mobility · Steep Scarp & Talus',
    summary: 'Heavy geomorphology weighting for median/p95 slope & rock CFA traction',
    basePresetId: 'rover_mobility',
    domainWeights: {
      geochemistry: 0.14,
      morphology: 0.46,
      thermal: 0.12,
      atmospheric: 0.08,
      operations: 0.20,
    },
    astrobiologyMode: 'clean_instrument_test',
  },
  {
    id: 'rover_mobility:aeolian_dust',
    group: 'rover_mobility',
    groupLabel: 'Surface Rover Mobility',
    label: 'Rover Mobility · Aeolian Dust & Saltation',
    summary: 'Elevates atmospheric density, grain diameter & Shao-Lu saltation velocity',
    basePresetId: 'rover_mobility',
    domainWeights: {
      geochemistry: 0.14,
      morphology: 0.20,
      thermal: 0.12,
      atmospheric: 0.34,
      operations: 0.20,
    },
    astrobiologyMode: 'clean_instrument_test',
  },
  {
    id: 'rover_mobility:long_range',
    group: 'rover_mobility',
    groupLabel: 'Surface Rover Mobility',
    label: 'Rover Mobility · Hyper-Arid Long-Range Ops',
    summary: 'Prioritizes visual alienation, clear-sky endurance & logistics access',
    basePresetId: 'rover_mobility',
    domainWeights: {
      geochemistry: 0.18,
      morphology: 0.22,
      thermal: 0.16,
      atmospheric: 0.10,
      operations: 0.34,
    },
    astrobiologyMode: 'clean_instrument_test',
  },

  // Cryogenic Volatile Drill
  {
    id: 'cryogenic_drill:standard',
    group: 'cryogenic_drill',
    groupLabel: 'Cryogenic Volatile Drill',
    label: 'Cryogenic Drill · Polar Ice Table',
    summary: 'Prioritizes shallow ice table depth, WEH & sub-freezing thermal stability',
    basePresetId: 'cryogenic_drill',
    domainWeights: { ...PRESET_DOMAIN_WEIGHTS.cryogenic_drill },
    astrobiologyMode: 'clean_instrument_test',
  },
  {
    id: 'cryogenic_drill:cold_trap',
    group: 'cryogenic_drill',
    groupLabel: 'Cryogenic Volatile Drill',
    label: 'Cryogenic Drill · Deep Cold-Trap Thermal',
    summary: 'Maximizes thermal envelope, diurnal stability & low-temperature analog fit',
    basePresetId: 'cryogenic_drill',
    domainWeights: {
      geochemistry: 0.18,
      morphology: 0.24,
      thermal: 0.38,
      atmospheric: 0.04,
      operations: 0.16,
    },
    astrobiologyMode: 'clean_instrument_test',
  },
  {
    id: 'cryogenic_drill:polar_ops',
    group: 'cryogenic_drill',
    groupLabel: 'Cryogenic Volatile Drill',
    label: 'Cryogenic Drill · Grazing Sun & Polar Ops',
    summary: 'Emphasizes grazing solar angle hours, expedition logistics & terrain slope',
    basePresetId: 'cryogenic_drill',
    domainWeights: {
      geochemistry: 0.16,
      morphology: 0.24,
      thermal: 0.20,
      atmospheric: 0.04,
      operations: 0.36,
    },
    astrobiologyMode: 'clean_instrument_test',
  },
];

export interface GranularWeightTier {
  value: number;
  label: string;
}

export const GRANULAR_WEIGHT_TIERS: GranularWeightTier[] = [
  { value: 0.0, label: '0.00 · Off' },
  { value: 0.04, label: '0.04 · Minimal' },
  { value: 0.08, label: '0.08 · Very Low' },
  { value: 0.12, label: '0.12 · Low' },
  { value: 0.16, label: '0.16 · Moderate-Low' },
  { value: 0.20, label: '0.20 · Balanced' },
  { value: 0.25, label: '0.25 · Elevated' },
  { value: 0.30, label: '0.30 · High' },
  { value: 0.35, label: '0.35 · Very High' },
  { value: 0.42, label: '0.42 · Primary' },
  { value: 0.50, label: '0.50 · Dominant' },
  { value: 0.60, label: '0.60 · Critical' },
];

export function defaultProfileIdForPreset(presetId: MissionPresetId): string {
  if (presetId === 'custom') return 'custom';
  return `${presetId}:standard`;
}

export function findGranularProfile(
  profileId: string
): GranularWeightingProfile | undefined {
  return GRANULAR_WEIGHTING_PROFILES.find((p) => p.id === profileId);
}
