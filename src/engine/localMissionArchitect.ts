import type {
  AiFollowUpQuestion,
  AiMissionComponent,
  AiMissionDesignResponse,
  AstrobiologyMode,
  CelestialBody,
  CelestialTarget,
  DomainWeights,
  MissionPresetId,
} from '../types/planetary.js';
import { PRESET_DOMAIN_WEIGHTS } from './evaluator.js';

type BasePreset = Exclude<MissionPresetId, 'custom'>;

interface ComponentDetector {
  id: string;
  pattern: RegExp;
  title: string;
  role: string;
  defaultBody: CelestialBody;
  marsLocation: { name: string; lat: number; lon: number };
  moonLocation: { name: string; lat: number; lon: number };
  basePresetId: BasePreset;
  astrobiologyMode: AstrobiologyMode;
  domainWeights: DomainWeights;
  rationale: string;
}

const COMPONENT_DETECTORS: ComponentDetector[] = [
  {
    id: 'comp_cryo_drill',
    pattern: /\b(cryo|ice|psr|permafrost|drill|volatile|cold trap|water ice)\b/i,
    title: 'Cryogenic Volatile Extraction',
    role: 'Subsurface Ice Drilling & Volatile Assay',
    defaultBody: 'moon',
    moonLocation: { name: 'Shackleton PSR Floor', lat: -89.5, lon: 0.0 },
    marsLocation: { name: 'Korolev Crater Ice Basin', lat: 72.77, lon: 164.58 },
    basePresetId: 'cryogenic_drill',
    astrobiologyMode: 'clean_instrument_test',
    domainWeights: {
      geochemistry: 0.22,
      morphology: 0.28,
      thermal: 0.26,
      atmospheric: 0.06,
      operations: 0.18,
    },
    rationale: 'Requires shallow ice-table permafrost and sub-freezing polar thermal conditions.',
  },
  {
    id: 'comp_subsurface_void',
    pattern: /\b(lava tube|skylight|cave|cavern|subsurface|underground|radiation shelter|pit)\b/i,
    title: 'Subsurface Skylight & Shelter Recon',
    role: 'Lava Tube Ingress & Radiation Shielding',
    defaultBody: 'moon',
    moonLocation: { name: 'Mare Tranquillitatis Pit', lat: 8.33, lon: 33.22 },
    marsLocation: { name: 'Arsia Mons Caldera Skylight', lat: -8.35, lon: -120.1 },
    basePresetId: 'subsurface_void',
    astrobiologyMode: 'ignore',
    domainWeights: {
      geochemistry: 0.18,
      morphology: 0.30,
      thermal: 0.18,
      atmospheric: 0.04,
      operations: 0.30,
    },
    rationale: 'Requires structural basaltic void geometry, skylight ingress slopes, and damped thermal swings.',
  },
  {
    id: 'comp_isru_base',
    pattern: /\b(isru|ilmenite|oxygen|sinter|moon base|permanent base|power relay|sunlit|ridge|habitat|dte|comms)\b/i,
    title: 'Surface Base, Power & ISRU Ops',
    role: 'Feedstock Processing, Solar Power & DTE Relay',
    defaultBody: 'moon',
    moonLocation: { name: 'Malapert Massif Rim', lat: -86.0, lon: -2.0 },
    marsLocation: { name: 'Elysium Planitia Base Site', lat: 4.5, lon: 135.62 },
    basePresetId: 'moon_base_isru',
    astrobiologyMode: 'ignore',
    domainWeights: {
      geochemistry: 0.30,
      morphology: 0.22,
      thermal: 0.16,
      atmospheric: 0.02,
      operations: 0.30,
    },
    rationale: 'Requires high solar illumination / DTE visibility, construction feedstock, and low plume hazard.',
  },
  {
    id: 'comp_astrobiology',
    pattern: /\b(astrobiology|biosignature|microb|extremophile|habitability|delta|clay|evaporite|lacustrine|organic|life)\b/i,
    title: 'Biosignature & Paleolake Sampling',
    role: 'Clay/Evaporite Geochemistry & Life Detection',
    defaultBody: 'mars',
    marsLocation: { name: 'Jezero Crater Delta', lat: 18.38, lon: 77.58 },
    moonLocation: { name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4 },
    basePresetId: 'astrobiology',
    astrobiologyMode: 'biosignature_habitability_analog',
    domainWeights: {
      geochemistry: 0.44,
      morphology: 0.14,
      thermal: 0.14,
      atmospheric: 0.08,
      operations: 0.20,
    },
    rationale: 'Maximizes phyllosilicate, sulfate, and carbonate preservation over habitable paleolake deposits.',
  },
  {
    id: 'comp_rover_scarp',
    pattern: /\b(rover|mobility|traction|traverse|scarp|steep|talus|dust storm|aeolian|saltation)\b/i,
    title: 'Surface Mobility & Terrain Traverse',
    role: 'Wheel Traction, Slope Climb & Dust Endurance',
    defaultBody: 'mars',
    marsLocation: { name: 'Olympus Mons Scarp', lat: 18.65, lon: -133.8 },
    moonLocation: { name: 'Tycho Crater Rim', lat: -43.3, lon: -11.4 },
    basePresetId: 'rover_mobility',
    astrobiologyMode: 'clean_instrument_test',
    domainWeights: {
      geochemistry: 0.18,
      morphology: 0.32,
      thermal: 0.14,
      atmospheric: 0.14,
      operations: 0.22,
    },
    rationale: 'Evaluates traction over basaltic talus slopes, boulder CFA, and aeolian dust regimes.',
  },
];

function normalizeWeights(w: DomainWeights): DomainWeights {
  const sum =
    w.geochemistry + w.morphology + w.thermal + w.atmospheric + w.operations;
  if (sum <= 0) return { ...PRESET_DOMAIN_WEIGHTS.rover_mobility };
  return {
    geochemistry: Number((w.geochemistry / sum).toFixed(2)),
    morphology: Number((w.morphology / sum).toFixed(2)),
    thermal: Number((w.thermal / sum).toFixed(2)),
    atmospheric: Number((w.atmospheric / sum).toFixed(2)),
    operations: Number((w.operations / sum).toFixed(2)),
  };
}

export function buildDeterministicMissionDesign(
  prompt: string,
  clarificationAnswers: Array<{ question: string; answer: string }> = [],
  activeTargets: CelestialTarget[] = []
): AiMissionDesignResponse {
  const combinedText = [
    prompt,
    ...clarificationAnswers.map((a) => `${a.question} ${a.answer}`),
  ]
    .join(' ')
    .trim();

  const mentionsMars = /\b(mars|martian|jezero|olympus|valles|gale|syrtis|elysium|hellas|mawrth|arsia|co2)\b/i.test(
    combinedText
  );
  const mentionsMoon = /\b(moon|lunar|artemis|mare|psr|shackleton|malapert|tycho|copernicus|south pole|ilmenite|regolith)\b/i.test(
    combinedText
  );

  const matched = COMPONENT_DETECTORS.filter((d) => d.pattern.test(combinedText));
  const followUpQuestions: AiFollowUpQuestion[] = [];

  // Only ask follow-up questions if genuinely ambiguous or contradictory
  if (
    !mentionsMars &&
    !mentionsMoon &&
    activeTargets.length === 0 &&
    clarificationAnswers.length === 0
  ) {
    followUpQuestions.push({
      id: 'q_body',
      question: 'Which planetary body is this mission targeting?',
      reason:
        'Gravity, vacuum vs CO₂ atmosphere, and ilmenite vs phyllosilicate geochemistry differ fundamentally between Mars and the Moon.',
      options: [
        { label: 'Moon (Vacuum / Artemis / Lunar Regolith)', answerValue: 'Target the Moon' },
        { label: 'Mars (CO₂ Atmosphere / Rovers & Astrobiology)', answerValue: 'Target Mars' },
        { label: 'Dual-Body Campaign (Both Mars & Moon)', answerValue: 'Split across both Moon and Mars' },
      ],
    });
  }

  if (
    mentionsMoon &&
    !mentionsMars &&
    /\b(dust storm|aeolian|saltation|wind abrasion)\b/i.test(combinedText) &&
    clarificationAnswers.length === 0
  ) {
    followUpQuestions.push({
      id: 'q_vacuum_wind',
      question:
        'You requested wind/aeolian dust-storm testing for a lunar mission (which is a vacuum). How should we resolve this?',
      reason: 'The Moon has zero atmospheric wind or aeolian saltation.',
      options: [
        {
          label: 'Switch wind testing to electrostatic/plume dust hazard',
          answerValue: 'Use lunar plume dust hazard instead of atmospheric wind',
        },
        {
          label: 'Split wind/aeolian qualification onto a Mars target',
          answerValue: 'Split aeolian dust storm testing onto Mars',
        },
      ],
    });
  }

  if (matched.length === 0 && clarificationAnswers.length === 0 && combinedText.split(/\s+/).length < 6) {
    followUpQuestions.push({
      id: 'q_objective',
      question: 'What is the primary operational or scientific objective of this mission?',
      reason: 'Insufficient mission details to calibrate geochemistry vs mobility vs thermal weights.',
      options: [
        { label: 'Surface Rover Mobility & Terrain Traverse', answerValue: 'Surface rover mobility and traction' },
        { label: 'Cryogenic Volatile / Water-Ice Drilling', answerValue: 'Cryogenic water-ice drilling' },
        { label: 'ISRU Oxygen / Permanent Base Ops', answerValue: 'Permanent base ISRU and power ops' },
        { label: 'Subsurface Lava Tube / Skylight Recon', answerValue: 'Subsurface lava tube reconnaissance' },
      ],
    });
  }

  if (followUpQuestions.length > 0) {
    return {
      status: 'needs_clarification',
      source: 'deterministic_fallback',
      missionSummary: 'Clarification needed to finalize planetary targets and domain weights.',
      preset: {
        name: 'Pending Clarification',
        description: combinedText,
        basePresetId: 'rover_mobility',
        domainWeights: { ...PRESET_DOMAIN_WEIGHTS.rover_mobility },
        astrobiologyMode: 'clean_instrument_test',
      },
      isMultiComponent: false,
      splitRationale: null,
      components: [],
      followUpQuestions,
      matchedConstraints: [],
      warnings: [],
    };
  }

  const chosenDetectors =
    matched.length > 0 ? matched : [COMPONENT_DETECTORS[4]];

  const primary = chosenDetectors[0];
  const avgWeights: DomainWeights = normalizeWeights({
    geochemistry:
      chosenDetectors.reduce((s, d) => s + d.domainWeights.geochemistry, 0) /
      chosenDetectors.length,
    morphology:
      chosenDetectors.reduce((s, d) => s + d.domainWeights.morphology, 0) /
      chosenDetectors.length,
    thermal:
      chosenDetectors.reduce((s, d) => s + d.domainWeights.thermal, 0) /
      chosenDetectors.length,
    atmospheric:
      chosenDetectors.reduce((s, d) => s + d.domainWeights.atmospheric, 0) /
      chosenDetectors.length,
    operations:
      chosenDetectors.reduce((s, d) => s + d.domainWeights.operations, 0) /
      chosenDetectors.length,
  });

  const isMultiComponent = chosenDetectors.length >= 2;
  const components: AiMissionComponent[] = chosenDetectors.slice(0, 4).map((det, idx) => {
    let body: CelestialBody = det.defaultBody;
    if (mentionsMars && !mentionsMoon) body = 'mars';
    else if (mentionsMoon && !mentionsMars) body = 'moon';
    else if (!mentionsMars && !mentionsMoon && activeTargets[idx]) {
      body = activeTargets[idx].body;
    }

    const loc = body === 'mars' ? det.marsLocation : det.moonLocation;
    return {
      id: `${det.id}_${idx + 1}`,
      title: det.title,
      role: det.role,
      body,
      locationName: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      basePresetId: det.basePresetId,
      domainWeights: { ...det.domainWeights },
      astrobiologyMode: det.astrobiologyMode,
      rationale: det.rationale,
    };
  });

  const presetName = isMultiComponent
    ? `AI Multi-Phase · ${components.map((c) => c.title.split(' ')[0]).join(' + ')}`
    : `AI Custom · ${primary.title}`;

  return {
    status: 'ready',
    source: 'deterministic_fallback',
    missionSummary: isMultiComponent
      ? `Decomposed into ${components.length} specialized mission components across distinct planetary locations.`
      : `Configured custom preset "${presetName}" tailored to your mission brief.`,
    preset: {
      name: presetName,
      description: prompt.slice(0, 180),
      basePresetId: primary.basePresetId,
      domainWeights: avgWeights,
      astrobiologyMode: primary.astrobiologyMode,
    },
    isMultiComponent,
    splitRationale: isMultiComponent
      ? `Separated ${components.length} conflicting or phase-distinct operational regimes across dedicated planetary sites so each phase optimizes its own Earth analog candidates.`
      : null,
    components,
    followUpQuestions: [],
    matchedConstraints: components.map((c) => ({
      label: c.title,
      effect: `${c.body.toUpperCase()} · ${c.locationName}`,
    })),
    warnings: [],
  };
}
