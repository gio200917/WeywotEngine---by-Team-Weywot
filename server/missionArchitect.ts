import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { buildDeterministicMissionDesign } from '../src/engine/localMissionArchitect.js';
import type {
  AiMissionComponent,
  AiMissionDesignResponse,
  AstrobiologyMode,
  CelestialBody,
  CelestialTarget,
  DomainWeights,
  MissionPresetId,
} from '../src/types/planetary.js';

type BasePreset = Exclude<MissionPresetId, 'custom'>;

const VALID_PRESETS: Set<BasePreset> = new Set([
  'moon_base_isru',
  'subsurface_void',
  'astrobiology',
  'rover_mobility',
  'cryogenic_drill',
]);

const VALID_ASTRO_MODES: Set<AstrobiologyMode> = new Set([
  'clean_instrument_test',
  'biosignature_habitability_analog',
  'ignore',
]);

function normalizeWeights(w: Partial<DomainWeights> | undefined): DomainWeights {
  const g = Math.max(0, Number(w?.geochemistry ?? 0.25) || 0);
  const m = Math.max(0, Number(w?.morphology ?? 0.25) || 0);
  const t = Math.max(0, Number(w?.thermal ?? 0.18) || 0);
  const a = Math.max(0, Number(w?.atmospheric ?? 0.12) || 0);
  const o = Math.max(0, Number(w?.operations ?? 0.20) || 0);
  const sum = g + m + t + a + o;
  if (sum <= 1e-6) {
    return {
      geochemistry: 0.25,
      morphology: 0.25,
      thermal: 0.18,
      atmospheric: 0.12,
      operations: 0.20,
    };
  }
  return {
    geochemistry: Number((g / sum).toFixed(2)),
    morphology: Number((m / sum).toFixed(2)),
    thermal: Number((t / sum).toFixed(2)),
    atmospheric: Number((a / sum).toFixed(2)),
    operations: Number((o / sum).toFixed(2)),
  };
}

function clampLat(lat: number): number {
  return Number(Math.max(-89.5, Math.min(89.5, Number.isFinite(lat) ? lat : 0)).toFixed(2));
}

function normalizeLon(lon: number): number {
  const v = Number.isFinite(lon) ? lon : 0;
  return Number((((((v + 180) % 360) + 360) % 360) - 180).toFixed(2));
}

function sanitizePresetId(val: string | undefined): BasePreset {
  if (val && VALID_PRESETS.has(val as BasePreset)) {
    return val as BasePreset;
  }
  return 'rover_mobility';
}

function sanitizeAstroMode(val: string | undefined, presetId: BasePreset): AstrobiologyMode {
  if (val && VALID_ASTRO_MODES.has(val as AstrobiologyMode)) {
    return val as AstrobiologyMode;
  }
  if (presetId === 'astrobiology') return 'biosignature_habitability_analog';
  if (presetId === 'moon_base_isru' || presetId === 'subsurface_void') return 'ignore';
  return 'clean_instrument_test';
}

const REFERENCE_LANDMARKS = `
Reference IAU Mars Coordinates (lat, lon):
- Jezero Crater Delta: 18.38, 77.58 (paleolake clay/carbonate, astrobiology)
- Mawrth Vallis: 22.3, -16.5 (phyllosilicate clay stratigraphy, astrobiology)
- Eberswalde Crater Delta: -23.86, -33.3 (deltaic biosignature)
- Gale Crater / Aeolis Mons: -5.4, 137.8 (sulfate/mudstone rover traverse)
- Meridiani Planum: -1.95, -5.53 (hematite/evaporite plain)
- Olympus Mons Scarp: 18.65, -133.8 (steep volcanic talus & basaltic scarp)
- Arsia Mons Caldera Skylight: -8.35, -120.1 (volcanic lava tube / pit)
- Cerberus Fossae: 11.3, 166.4 (volcanic graben & fissure)
- Valles Marineris / Candor Chasma: -6.5, -70.9 (steep layered sulfate canyon)
- Utopia Planitia: 46.7, 117.5 (mid-latitude buried water ice)
- Arcadia Planitia: 46.7, -172.0 (shallow ice sheet for ISRU/drill)
- Korolev Crater: 72.77, 164.58 (north polar water-ice crater)
- Vastitas Borealis (Phoenix): 68.22, -125.75 (permafrost patterned ground)
- Elysium Planitia: 4.5, 135.62 (equatorial volcanic plain)

Reference IAU Moon Coordinates (lat, lon):
- Shackleton Crater PSR Floor: -89.5, 0.0 (south polar cold trap, cryogenic water ice)
- Cabeus Crater PSR: -84.9, -35.5 (south polar volatile ice basin)
- Faustini Crater PSR: -87.18, 84.3 (permanently shadowed volatile deposit)
- Malapert Massif Rim: -86.0, -2.0 (high solar illumination + Earth DTE relay ridge)
- de Gerlache Rim: -88.5, -87.1 (polar illuminated ridge)
- Nobile Crater Rim: -85.2, 53.5 (VIPER south polar rover traverse)
- Mare Tranquillitatis Pit: 8.33, 33.22 (confirmed lunar skylight / lava tube)
- Marius Hills Skylight: 14.1, -56.7 (volcanic dome lava tube pit)
- Vallis Schröteri: 26.2, -50.8 (sinuous volcanic rille)
- Oceanus Procellarum: 18.4, -57.4 (high-Ti mare basalt ISRU)
- Statio Tranquillitatis (A11): 0.67, 23.47 (high-Ti ilmenite basalt)
- Taurus-Littrow (A17): 20.19, 30.77 (highland-mare boundary)
- Tycho Crater Rim: -43.3, -11.4 (steep rocky impact ejecta)
- Schrödinger Basin: -75.0, 132.4 (far-side peak-ring basin)
`.trim();

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      description: 'Either "ready" if clear enough to configure, or "needs_clarification" ONLY if critical ambiguity or physics conflict exists.',
    },
    missionSummary: {
      type: Type.STRING,
      description: 'Concise 1-2 sentence technical mission summary.',
    },
    preset: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Short 3-6 word mission preset title.' },
        description: { type: Type.STRING, description: '1-sentence rationale of the weighting profile.' },
        basePresetId: {
          type: Type.STRING,
          description: 'One of: moon_base_isru, subsurface_void, astrobiology, rover_mobility, cryogenic_drill',
        },
        domainWeights: {
          type: Type.OBJECT,
          properties: {
            geochemistry: { type: Type.NUMBER },
            morphology: { type: Type.NUMBER },
            thermal: { type: Type.NUMBER },
            atmospheric: { type: Type.NUMBER },
            operations: { type: Type.NUMBER },
          },
          required: ['geochemistry', 'morphology', 'thermal', 'atmospheric', 'operations'],
        },
        astrobiologyMode: {
          type: Type.STRING,
          description: 'One of: clean_instrument_test, biosignature_habitability_analog, ignore',
        },
        durationDays: { type: Type.NUMBER, description: 'Recommended campaign window in days (3..90).' },
        maxSlopeFilterDeg: { type: Type.NUMBER, description: 'Recommended max median slope filter in degrees (5..45).' },
      },
      required: ['name', 'description', 'basePresetId', 'domainWeights', 'astrobiologyMode'],
    },
    isMultiComponent: {
      type: Type.BOOLEAN,
      description: 'True if the mission involves multiple distinct operational phases, conflicting terrain/thermal requirements, or multiple locations.',
    },
    splitRationale: {
      type: Type.STRING,
      description: 'Explanation of why the mission was split across multiple components/locations, or empty string if single-component.',
    },
    components: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          role: { type: Type.STRING },
          body: { type: Type.STRING, description: 'Either "mars" or "moon"' },
          locationName: { type: Type.STRING },
          lat: { type: Type.NUMBER },
          lon: { type: Type.NUMBER },
          basePresetId: { type: Type.STRING },
          domainWeights: {
            type: Type.OBJECT,
            properties: {
              geochemistry: { type: Type.NUMBER },
              morphology: { type: Type.NUMBER },
              thermal: { type: Type.NUMBER },
              atmospheric: { type: Type.NUMBER },
              operations: { type: Type.NUMBER },
            },
            required: ['geochemistry', 'morphology', 'thermal', 'atmospheric', 'operations'],
          },
          astrobiologyMode: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: [
          'id',
          'title',
          'role',
          'body',
          'locationName',
          'lat',
          'lon',
          'basePresetId',
          'domainWeights',
          'astrobiologyMode',
          'rationale',
        ],
      },
    },
    followUpQuestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          question: { type: Type.STRING },
          reason: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                answerValue: { type: Type.STRING },
              },
              required: ['label', 'answerValue'],
            },
          },
        },
        required: ['id', 'question', 'reason', 'options'],
      },
    },
    matchedConstraints: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          effect: { type: Type.STRING },
        },
        required: ['label', 'effect'],
      },
    },
  },
  required: [
    'status',
    'missionSummary',
    'preset',
    'isMultiComponent',
    'splitRationale',
    'components',
    'followUpQuestions',
    'matchedConstraints',
  ],
};

export async function designMissionWithGemini(params: {
  prompt: string;
  clarificationAnswers?: Array<{ question: string; answer: string }>;
  activeTargets?: CelestialTarget[];
}): Promise<AiMissionDesignResponse> {
  const { prompt, clarificationAnswers = [], activeTargets = [] } = params;
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return buildDeterministicMissionDesign(prompt, clarificationAnswers, activeTargets);
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const targetContext =
    activeTargets.length > 0
      ? activeTargets
          .map(
            (t) =>
              `- ${t.name} (${t.body}, lat=${t.lat.toFixed(2)}, lon=${t.lon.toFixed(2)}, preset=${t.defaultPreset}, vacuum=${t.isVacuumRegime}, cryo=${t.requiresCryogenicIce}, void=${t.isSubsurfaceVoidTarget})`
          )
          .join('\n')
      : 'None currently selected.';

  const qaContext =
    clarificationAnswers.length > 0
      ? clarificationAnswers
          .map((qa, idx) => `Q${idx + 1}: ${qa.question}\nA${idx + 1}: ${qa.answer}`)
          .join('\n\n')
      : 'None yet.';

  const systemInstruction = `You are the WeywotEngine Planetary Mission Architect.
Your job is to convert natural-language planetary mission descriptions into:
1. A named custom Mission Preset with calibrated 5-domain weights (geochemistry, morphology, thermal, atmospheric, operations summing to 1.0) plus basePresetId and astrobiologyMode.
2. Follow-up questions ONLY when something is genuinely ambiguous, contradictory, or missing critical mission constraints (e.g., unclear Mars vs Moon when no targets are selected and description fits both; physics contradiction like atmospheric wind/dust-storm abrasion on a vacuum lunar target; contradictory flat-playa vs steep-cliff terrain; unclear whether cryogenic ice drilling is polar PSR vs mid-latitude). If the prompt is clear and actionable (or clarifications have already been provided), set status="ready" and followUpQuestions=[] immediately! Never ask redundant or trivial questions.
3. Automatic Multi-Component Mission Splitting: If the mission describes a complex, multi-phase, or multi-environment campaign (e.g., ice drilling + sunlit power/DTE relay + lava tube shelter; or paleolake biosignature sampling + steep volcanic scarp rover traction; or dual-body Mars+Moon validation), set isMultiComponent=true and decompose it into 2 to 4 distinct components across different Mars/Moon locations, each with its own dedicated planetary coordinates, basePresetId, and custom domainWeights. If the mission is single-phase/single-site, set isMultiComponent=false and return 1 component.

Important rules:
- Always ground Mars/Moon coordinates in the reference landmarks below or realistic planetary coordinates.
- For Moon missions, atmospheric wind/saltation is zero (vacuum), so keep atmospheric weight low (0.00-0.06) unless testing lunar dust/plume mechanics specifically.
- Return valid JSON matching the schema. Do not include markdown or extra commentary.`;

  const userContent = `Active Planetary Targets:\n${targetContext}\n\n${REFERENCE_LANDMARKS}\n\nUser Mission Description:\n"${prompt}"\n\nFollow-up Clarification History:\n${qaContext}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: userContent,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      throw new Error('Gemini returned an empty response for mission architecture.');
    }

    const parsed = JSON.parse(rawText) as {
      status?: string;
      missionSummary?: string;
      preset?: {
        name?: string;
        description?: string;
        basePresetId?: string;
        domainWeights?: Partial<DomainWeights>;
        astrobiologyMode?: string;
        durationDays?: number;
        maxSlopeFilterDeg?: number;
      };
      isMultiComponent?: boolean;
      splitRationale?: string;
      components?: Array<{
        id?: string;
        title?: string;
        role?: string;
        body?: string;
        locationName?: string;
        lat?: number;
        lon?: number;
        basePresetId?: string;
        domainWeights?: Partial<DomainWeights>;
        astrobiologyMode?: string;
        rationale?: string;
      }>;
      followUpQuestions?: Array<{
        id?: string;
        question?: string;
        reason?: string;
        options?: Array<{ label?: string; answerValue?: string }>;
      }>;
      matchedConstraints?: Array<{ label?: string; effect?: string }>;
    };

    const basePresetId = sanitizePresetId(parsed.preset?.basePresetId);
    const presetWeights = normalizeWeights(parsed.preset?.domainWeights);
    const astroMode = sanitizeAstroMode(parsed.preset?.astrobiologyMode, basePresetId);

    const followUpQuestions = (parsed.followUpQuestions ?? [])
      .filter((q) => q.question && q.question.trim().length > 0)
      .slice(0, 3)
      .map((q, idx) => ({
        id: q.id || `fq_${idx + 1}`,
        question: q.question!.trim(),
        reason: (q.reason ?? '').trim(),
        options: (q.options ?? [])
          .filter((o) => o.label && o.answerValue)
          .slice(0, 4)
          .map((o) => ({
            label: o.label!.trim(),
            answerValue: o.answerValue!.trim(),
          })),
      }));

    const status: 'ready' | 'needs_clarification' =
      parsed.status === 'needs_clarification' && followUpQuestions.length > 0
        ? 'needs_clarification'
        : 'ready';

    const components: AiMissionComponent[] = (parsed.components ?? [])
      .slice(0, 4)
      .map((c, idx) => {
        const compBody: CelestialBody =
          String(c.body).toLowerCase() === 'mars' ? 'mars' : 'moon';
        const compPreset = sanitizePresetId(c.basePresetId);
        return {
          id: c.id || `comp_${idx + 1}`,
          title: (c.title || `Component ${idx + 1}`).trim(),
          role: (c.role || 'Mission Phase').trim(),
          body: compBody,
          locationName: (
            c.locationName || `${compBody === 'mars' ? 'Mars' : 'Moon'} Site ${idx + 1}`
          ).trim(),
          lat: clampLat(Number(c.lat)),
          lon: normalizeLon(Number(c.lon)),
          basePresetId: compPreset,
          domainWeights: normalizeWeights(c.domainWeights),
          astrobiologyMode: sanitizeAstroMode(c.astrobiologyMode, compPreset),
          rationale: (c.rationale || '').trim(),
        };
      });

    const isMultiComponent = Boolean(parsed.isMultiComponent && components.length >= 2);

    return {
      status,
      source: 'gemini',
      missionSummary: (parsed.missionSummary || 'Custom mission preset configured.').trim(),
      preset: {
        name: (parsed.preset?.name || 'AI Custom Mission').trim(),
        description: (parsed.preset?.description || prompt.slice(0, 160)).trim(),
        basePresetId,
        domainWeights: presetWeights,
        astrobiologyMode: astroMode,
        durationDays:
          typeof parsed.preset?.durationDays === 'number' &&
          Number.isFinite(parsed.preset.durationDays)
            ? Math.max(3, Math.min(90, Math.round(parsed.preset.durationDays)))
            : undefined,
        maxSlopeFilterDeg:
          typeof parsed.preset?.maxSlopeFilterDeg === 'number' &&
          Number.isFinite(parsed.preset.maxSlopeFilterDeg)
            ? Math.max(5, Math.min(45, Math.round(parsed.preset.maxSlopeFilterDeg)))
            : undefined,
      },
      isMultiComponent,
      splitRationale: isMultiComponent
        ? (parsed.splitRationale || 'Mission split across distinct planetary regimes.').trim()
        : null,
      components,
      followUpQuestions: status === 'needs_clarification' ? followUpQuestions : [],
      matchedConstraints: (parsed.matchedConstraints ?? [])
        .filter((mc) => mc.label && mc.effect)
        .slice(0, 6)
        .map((mc) => ({
          label: mc.label!.trim(),
          effect: mc.effect!.trim(),
        })),
      warnings: [],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Gemini service unavailable';
    const fallback = buildDeterministicMissionDesign(prompt, clarificationAnswers, activeTargets);
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        `Gemini Architect fallback active (${reason}) — used deterministic mission planner.`,
      ],
    };
  }
}
