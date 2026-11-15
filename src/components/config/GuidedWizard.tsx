import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Compass,
  Globe2,
  MapPin,
  Plus,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import {
  ARCHETYPE_OPTIONS,
  type SelectablePresetId,
} from '../../engine/targetSynthesizer.js';
import { useMissionStore } from '../../store/missionStore.js';
import type { CelestialBody } from '../../types/planetary.js';
import { AiMissionArchitect } from './AiMissionArchitect.js';

interface QuickLandmark {
  body: CelestialBody;
  name: string;
  lat: number;
  lon: number;
  archetype: SelectablePresetId;
  summary: string;
}

const QUICK_LANDMARKS: QuickLandmark[] = [
  {
    body: 'mars',
    name: 'Jezero Crater Delta',
    lat: 18.38,
    lon: 77.58,
    archetype: 'astrobiology',
    summary: 'Ancient river delta & clay lakebed',
  },
  {
    body: 'mars',
    name: 'Olympus Mons Scarp',
    lat: 18.65,
    lon: -133.8,
    archetype: 'rover_mobility',
    summary: 'Steep basalt volcanic slopes',
  },
  {
    body: 'mars',
    name: 'Arcadia Planitia Ice',
    lat: 39.2,
    lon: -172.0,
    archetype: 'cryogenic_drill',
    summary: 'Shallow buried glacier sheets',
  },
  {
    body: 'moon',
    name: 'Shackleton PSR',
    lat: -89.5,
    lon: 0.0,
    archetype: 'cryogenic_drill',
    summary: 'Permanently shadowed south pole ice',
  },
  {
    body: 'moon',
    name: 'Malapert Massif',
    lat: -86.0,
    lon: -2.5,
    archetype: 'moon_base_isru',
    summary: 'Sunlit polar ridge & Earth-facing comms',
  },
  {
    body: 'moon',
    name: 'Mare Tranquillitatis Pit',
    lat: 8.33,
    lon: 33.22,
    archetype: 'subsurface_void',
    summary: 'Collapsed skylight into lunar lava tube',
  },
];

const GUIDED_ARCHETYPES: Array<{
  id: SelectablePresetId;
  title: string;
  desc: string;
  defaultBody: CelestialBody;
}> = [
  {
    id: 'moon_base_isru',
    title: 'Permanent Moon Base & Construction',
    desc: 'Building materials, oxygen extraction, power, and flat terrain.',
    defaultBody: 'moon',
  },
  {
    id: 'subsurface_void',
    title: 'Lava Tube & Cave Shelter',
    desc: 'Collapsed skylights, basalt lava tubes, and cavern radiation shelters.',
    defaultBody: 'moon',
  },
  {
    id: 'astrobiology',
    title: 'Ancient Life & Biosignatures',
    desc: 'Ancient lake clays, evaporite salts, and clean ultra-arid deserts.',
    defaultBody: 'mars',
  },
  {
    id: 'rover_mobility',
    title: 'Surface Rover Traction & Driving',
    desc: 'Loose sand, steep rocky slopes, dust, and wheel-slip test terrain.',
    defaultBody: 'mars',
  },
  {
    id: 'cryogenic_drill',
    title: 'Buried Water Ice & Drilling',
    desc: 'Frozen permafrost ground and sub-zero cryogenic drilling.',
    defaultBody: 'moon',
  },
];

export function GuidedWizard() {
  const {
    guidedStep,
    setGuidedStep,
    config,
    customTargets,
    addCustomTarget,
    removeCustomTarget,
    clearTargets,
    setPreset,
    bodyFocus,
    setBodyFocus,
    setViewComplexity,
    aiMissionDesign,
    weightingProfileId,
    inspectPlanetaryPoint,
    setActiveTargetTabId,
  } = useMissionStore();

  const [goalMode, setGoalMode] = useState<'standard' | 'ai'>(
    aiMissionDesign ? 'ai' : 'standard'
  );
  const [coordOpen, setCoordOpen] = useState(false);
  const [coordBody, setCoordBody] = useState<CelestialBody>('mars');
  const [coordLat, setCoordLat] = useState('18.38');
  const [coordLon, setCoordLon] = useState('77.58');
  const [coordName, setCoordName] = useState('');
  const [coordError, setCoordError] = useState<string | null>(null);

  const isCustomPreset = config.presetId === 'custom';
  const selectedArchetype: SelectablePresetId | null =
    config.presetId === 'custom' ? null : config.presetId;

  const activeArchetypeInfo = selectedArchetype
    ? ARCHETYPE_OPTIONS.find((a) => a.id === selectedArchetype) ?? ARCHETYPE_OPTIONS[3]
    : null;

  const hasTargets = config.targetIds.length > 0;
  const activeTargetBody: CelestialBody = bodyFocus === 'moon' ? 'moon' : 'mars';
  const hasActiveOverrides =
    Boolean(config.targetOverrides) &&
    Object.keys(config.targetOverrides ?? {}).length > 0;
  const aiPlanNotReady =
    goalMode === 'ai' && aiMissionDesign?.status !== 'ready';

  const handleAddCoord = (ev: React.FormEvent) => {
    ev.preventDefault();
    const latNum = Number.parseFloat(coordLat);
    const lonNum = Number.parseFloat(coordLon);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setCoordError('Latitude must be between -90° and +90°.');
      return;
    }
    if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 360) {
      setCoordError('Longitude must be between -180° and +360°.');
      return;
    }
    setCoordError(null);
    addCustomTarget({
      body: coordBody,
      lat: latNum,
      lon: lonNum > 180 ? lonNum - 360 : lonNum,
      name: coordName.trim() || undefined,
      presetId: selectedArchetype ?? undefined,
    });
    setCoordName('');
    setCoordOpen(false);
  };

  const handleProceedToTarget = () => {
    const defaultBody =
      GUIDED_ARCHETYPES.find((a) => a.id === selectedArchetype)?.defaultBody ?? 'mars';
    setBodyFocus(customTargets[0]?.body ?? defaultBody);
    setGuidedStep('target');
  };

  const handleProceedToReview = () => {
    setGuidedStep('review');
    setBodyFocus('earth');
  };

  const steps: Array<{ id: 'goal' | 'target' | 'review'; num: number; label: string; enabled: boolean }> = [
    { id: 'goal', num: 1, label: 'Goal', enabled: true },
    { id: 'target', num: 2, label: 'Target', enabled: true },
    { id: 'review', num: 3, label: 'Earth Sites', enabled: hasTargets },
  ];

  const bodyLandmarks = QUICK_LANDMARKS.filter((l) => l.body === activeTargetBody);

  return (
    <aside className="h-full flex flex-col bg-[#0a0e16] border-r border-slate-800 min-h-0">
      {/* Locked Stepper Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-800 bg-[#0d121c] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Guided Setup
            </h2>
          </div>
          <span className="font-mono tabular-nums text-[11px] text-cyan-300">
            Step {guidedStep === 'goal' ? 1 : guidedStep === 'target' ? 2 : 3} of 3
          </span>
        </div>

        <nav aria-label="Guided Setup Steps" className="grid grid-cols-3 gap-1">
          {steps.map((s) => {
            const active = guidedStep === s.id;
            return (
              <button
                key={s.id}
                type="button"
                disabled={!s.enabled || (s.id === 'target' && guidedStep === 'goal' && aiPlanNotReady)}
                onClick={() => {
                  if (s.id === 'target') handleProceedToTarget();
                  else if (s.id === 'review') handleProceedToReview();
                  else setGuidedStep(s.id);
                }}
                className={`px-2 py-1.5 rounded border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-800 bg-[#070a10] text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                {s.num}. {s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Step Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {guidedStep === 'goal' && (
          <>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-100">
                Step 1: What is your mission testing?
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Pick one mission focus below, or switch to AI Custom Mission if you want to describe a multi-phase campaign.
              </p>
            </div>

            {/* Single Clean Toggle: Standard Goals vs Custom AI Mission */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded border border-slate-800 bg-[#070a10]">
              <button
                type="button"
                onClick={() => setGoalMode('standard')}
                className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  goalMode === 'standard'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Standard Mission Goal
              </button>
              <button
                type="button"
                onClick={() => setGoalMode('ai')}
                className={`py-1.5 px-2 rounded text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  goalMode === 'ai'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>AI Custom Mission</span>
              </button>
            </div>

            {goalMode === 'ai' ? (
              <AiMissionArchitect
                onPlanReady={() => {
                  setGuidedStep(
                    useMissionStore.getState().config.targetIds.length > 0 ? 'review' : 'target'
                  );
                }}
              />
            ) : (
              <div className="space-y-2">
                {isCustomPreset && (
                  <div className="p-2.5 rounded border border-amber-500/40 bg-amber-950/20 text-[11px] text-amber-200">
                    Custom domain weights from Expert Mode are currently active. Pick a standard goal below to reset weights, or continue to Step 2 to keep your custom weights.
                  </div>
                )}
                {GUIDED_ARCHETYPES.map((arch) => {
                  const selected = selectedArchetype === arch.id;
                  return (
                    <button
                      key={arch.id}
                      type="button"
                      onClick={() => setPreset(arch.id)}
                      className={`w-full text-left p-3 rounded border transition-colors cursor-pointer ${
                        selected
                          ? 'border-cyan-400/75 bg-cyan-500/12'
                          : 'border-slate-800 bg-[#0d121c] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-100">
                          {arch.title}
                        </span>
                        {selected && (
                          <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        {arch.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              {aiPlanNotReady && (
                <div className="text-[11px] text-amber-300/90 text-center">
                  Generate and complete your AI Custom Mission plan above, or switch to Standard Mission Goal.
                </div>
              )}
              <button
                type="button"
                disabled={aiPlanNotReady}
                onClick={handleProceedToTarget}
                className="w-full py-2.5 px-3 rounded border border-cyan-500/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs font-semibold text-cyan-100 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span>Continue to Step 2: Pick Target</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}

        {guidedStep === 'target' && (
          <>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-100">
                Step 2: Pick Mars or Moon Target
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Click any landmark below, search a crater above the map, or click directly on the {activeTargetBody.toUpperCase()} globe.
              </p>
            </div>

            {/* Active Body Switcher matching Landmarks below */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setBodyFocus('mars')}
                className={`py-2 px-2.5 rounded border text-xs font-medium cursor-pointer transition-colors ${
                  activeTargetBody === 'mars'
                    ? 'border-amber-400/75 bg-amber-500/15 text-amber-200'
                    : 'border-slate-700 bg-[#0d121c] text-slate-300 hover:border-amber-500/50'
                }`}
              >
                Mars Sites
              </button>
              <button
                type="button"
                onClick={() => setBodyFocus('moon')}
                className={`py-2 px-2.5 rounded border text-xs font-medium cursor-pointer transition-colors ${
                  activeTargetBody === 'moon'
                    ? 'border-cyan-400/75 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-700 bg-[#0d121c] text-slate-300 hover:border-cyan-500/50'
                }`}
              >
                Moon Sites
              </button>
            </div>

            {/* Filtered Landmarks for Current Body */}
            <div className="space-y-1.5">
              {bodyLandmarks.map((site) => {
                const isAdded = customTargets.some(
                  (t) =>
                    t.body === site.body &&
                    Math.abs(t.lat - site.lat) < 0.05 &&
                    Math.abs(t.lon - site.lon) < 0.05
                );
                return (
                  <button
                    key={site.name}
                    type="button"
                    onClick={() => {
                      if (!isAdded) {
                        addCustomTarget({
                          body: site.body,
                          lat: site.lat,
                          lon: site.lon,
                          name: site.name,
                          presetId: selectedArchetype ?? site.archetype,
                        });
                      } else {
                        inspectPlanetaryPoint({
                          body: site.body,
                          lat: site.lat,
                          lon: site.lon,
                          name: site.name,
                          flyTo: true,
                        });
                      }
                    }}
                    className={`w-full text-left p-2.5 rounded border transition-colors cursor-pointer ${
                      isAdded
                        ? 'border-emerald-500/70 bg-emerald-500/12'
                        : 'border-slate-800 bg-[#0d121c] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-100 flex items-center gap-1.5 truncate">
                        <MapPin
                          className={`w-3.5 h-3.5 shrink-0 ${
                            site.body === 'mars' ? 'text-amber-400' : 'text-cyan-400'
                          }`}
                        />
                        <span className="truncate">{site.name}</span>
                      </span>
                      <span
                        className={`font-mono text-[10px] shrink-0 ${
                          isAdded ? 'text-emerald-300 font-semibold' : 'text-slate-400'
                        }`}
                      >
                        {isAdded ? 'Selected ✓' : '+ Select'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 pl-5">
                      {site.summary}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Selected Targets Bucket */}
            {customTargets.length > 0 && (
              <div className="p-2.5 rounded border border-emerald-500/40 bg-emerald-950/15 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-emerald-300">
                    Your Selected Targets ({customTargets.length})
                  </span>
                  <button
                    type="button"
                    onClick={clearTargets}
                    className="text-slate-400 hover:text-red-300 cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
                <div className="space-y-1">
                  {customTargets.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-slate-800 bg-[#0d121c]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTargetTabId(t.id);
                          setBodyFocus(t.body);
                        }}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="text-xs font-medium text-slate-100 truncate">
                          {t.name}
                        </div>
                        <div className="font-mono tabular-nums text-[10px] text-slate-400">
                          {t.body.toUpperCase()} · {t.lat.toFixed(1)}°, {t.lon.toFixed(1)}°
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCustomTarget(t.id)}
                        aria-label={`Remove ${t.name}`}
                        className="px-1.5 py-0.5 text-xs text-slate-400 hover:text-red-300 cursor-pointer shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional Manual Coordinates */}
            <div>
              <button
                type="button"
                onClick={() => {
                  setCoordBody(activeTargetBody);
                  setCoordOpen((v) => !v);
                }}
                className="text-[11px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>{coordOpen ? 'Hide Manual Coordinates' : 'Enter Coordinates Manually'}</span>
              </button>

              {coordOpen && (
                <form
                  onSubmit={handleAddCoord}
                  className="mt-2 p-2.5 rounded border border-slate-800 bg-[#0d121c] space-y-2"
                >
                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Body</span>
                      <select
                        value={coordBody}
                        onChange={(e) => setCoordBody(e.target.value as CelestialBody)}
                        className="w-full px-1.5 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-100"
                      >
                        <option value="mars">Mars</option>
                        <option value="moon">Moon</option>
                      </select>
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Lat (°)</span>
                      <input
                        type="number"
                        step="any"
                        min={-90}
                        max={90}
                        value={coordLat}
                        onChange={(e) => setCoordLat(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-700 bg-[#070a10] font-mono text-[11px] text-slate-100"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Lon (°)</span>
                      <input
                        type="number"
                        step="any"
                        min={-180}
                        max={360}
                        value={coordLon}
                        onChange={(e) => setCoordLon(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-700 bg-[#070a10] font-mono text-[11px] text-slate-100"
                      />
                    </label>
                  </div>
                  <input
                    type="text"
                    value={coordName}
                    onChange={(e) => setCoordName(e.target.value)}
                    placeholder="Optional site label"
                    className="w-full px-2 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-100"
                  />
                  {coordError && <div className="text-[10px] text-red-300">{coordError}</div>}
                  <button
                    type="submit"
                    className="w-full py-1.5 rounded border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-medium text-amber-200 cursor-pointer"
                  >
                    Add Target
                  </button>
                </form>
              )}
            </div>

            {/* Footer Navigation */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              {!hasTargets && (
                <div className="text-[11px] text-amber-300/90 text-center">
                  Select at least 1 Mars or Moon site above to unlock Earth matches.
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGuidedStep('goal')}
                  className="px-3 py-2 rounded border border-slate-700 bg-[#0d121c] hover:border-slate-600 text-xs text-slate-300 flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={!hasTargets}
                  onClick={handleProceedToReview}
                  className="flex-1 py-2.5 px-3 rounded border border-emerald-500/60 bg-emerald-500/20 hover:bg-emerald-500/30 text-xs font-semibold text-emerald-100 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Globe2 className="w-3.5 h-3.5" />
                  <span>Find Matching Earth Sites</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}

        {guidedStep === 'review' && (
          <>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-100">
                Step 3: Review Earth Sites
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Click any ranked row or Earth pin to center the globe and inspect why it matches and what hardware is needed.
              </p>
            </div>

            {/* Locked Campaign Summary */}
            <div className="p-3 rounded border border-slate-800 bg-[#0d121c] space-y-2.5 text-xs">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Mission Goal
              </div>
              <div className="font-semibold text-slate-100">
                {weightingProfileId.startsWith('ai_preset_') &&
                aiMissionDesign?.status === 'ready'
                  ? aiMissionDesign.preset.name
                  : activeArchetypeInfo
                    ? activeArchetypeInfo.label
                    : 'Custom Numeric Profile'}
              </div>
              <div className="space-y-1 pt-2 border-t border-slate-800/80">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                  Target{customTargets.length > 1 ? 's' : ''}
                </div>
                {customTargets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-[11px] text-slate-200"
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="font-mono text-[10px] text-amber-300 shrink-0">
                      {t.body.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Step Navigation Back */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              {hasActiveOverrides && (
                <div className="p-2 rounded border border-cyan-500/40 bg-cyan-950/20 text-[10px] text-cyan-200 leading-snug">
                  AI multi-component weights are preserved on each phase target while adding or reviewing targets.
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleProceedToTarget}
                  className="py-1.5 px-2.5 rounded border border-slate-700 bg-[#0d121c] hover:border-slate-600 text-[11px] text-slate-300 cursor-pointer"
                >
                  {hasActiveOverrides ? '← Add / Inspect Targets' : '← Edit Target'}
                </button>
                <button
                  type="button"
                  onClick={() => setGuidedStep('goal')}
                  className="py-1.5 px-2.5 rounded border border-slate-700 bg-[#0d121c] hover:border-slate-600 text-[11px] text-slate-300 cursor-pointer"
                >
                  ← Change Goal
                </button>
              </div>

              <button
                type="button"
                onClick={() => setViewComplexity('expert')}
                className="w-full py-1.5 px-3 rounded border border-slate-700 bg-[#070a10] hover:border-amber-500/60 text-[11px] text-amber-300 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Customize Weights in Expert Mode</span>
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
