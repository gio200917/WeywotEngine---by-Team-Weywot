import { useEffect, useMemo, useState } from 'react';
import {
  Compass,
  Filter,
  Lock,
  Plus,
  Scale,
  Trash2,
} from 'lucide-react';
import {
  computeMarsLsDeg,
  parseEpochDate,
} from '../../engine/physics.js';
import {
  GRANULAR_WEIGHTING_PROFILES,
  type WeightingProfileGroup,
} from '../../engine/weightingProfiles.js';
import { useMissionStore } from '../../store/missionStore.js';
import type {
  AstrobiologyMode,
  CelestialBody,
  DomainKey,
  PermitTier,
} from '../../types/planetary.js';
import { AiMissionArchitect } from './AiMissionArchitect.js';
import { GuidedWizard } from './GuidedWizard.js';

const PROFILE_GROUPS: Array<{ id: WeightingProfileGroup; label: string }> = [
  { id: 'moon_base_isru', label: 'Moon Base & ISRU' },
  { id: 'subsurface_void', label: 'Subsurface Cave / Lava Tube' },
  { id: 'astrobiology', label: 'Astrobiology & Extremophiles' },
  { id: 'rover_mobility', label: 'Surface Rover Mobility' },
  { id: 'cryogenic_drill', label: 'Cryogenic Volatile Drill' },
];

const DOMAINS: Array<{ key: DomainKey; label: string }> = [
  { key: 'geochemistry', label: 'Geochemistry & Mineralogy' },
  { key: 'morphology', label: 'Geomorphology & Regolith' },
  { key: 'thermal', label: 'Thermal & Radiative' },
  { key: 'atmospheric', label: 'Atmospheric & Aeolian' },
  { key: 'operations', label: 'Operations & Logistics' },
];

const PERMIT_LABELS: Array<{ id: PermitTier; label: string }> = [
  { id: 'open_public', label: 'Open Public Land' },
  { id: 'regulated_research', label: 'Regulated Research' },
  { id: 'protected_park', label: 'Protected Park' },
  { id: 'polar_expedition', label: 'Polar Expedition' },
];

function NumericField({
  value,
  min,
  max,
  step,
  decimals = 2,
  ariaLabel,
  onCommit,
  disabled = false,
  className = 'w-16',
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  ariaLabel: string;
  onCommit: (next: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value.toFixed(decimals));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value.toFixed(decimals));
    }
  }, [value, decimals, focused]);

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft);
    const next = Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : value;
    onCommit(next);
    setDraft(next.toFixed(decimals));
  };

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitDraft();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value.toFixed(decimals));
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setFocused(false);
        commitDraft();
      }}
      className={`${className} px-1.5 py-0.5 rounded border border-slate-700 bg-[#070a10] font-mono tabular-nums text-[11px] text-right text-slate-100 focus:outline-none focus:border-cyan-500 disabled:opacity-45 disabled:cursor-not-allowed`}
    />
  );
}

export function MissionConfigPanel() {
  const {
    customTargets,
    config,
    toggleTarget,
    addCustomTarget,
    removeCustomTarget,
    clearTargets,
    weightingProfileId,
    customPresets,
    selectWeightingProfile,
    setDomainWeight,
    normalizeDomainWeights,
    setEpochDate,
    setDurationDays,
    setAstrobiologyMode,
    togglePermitTier,
    maxSlopeFilterDeg,
    setMaxSlopeFilter,
    setSearchScope,
    batchVerifyState,
    verifyShortlistLive,
    setBodyFocus,
    viewComplexity,
    clearTargetOverrides,
  } = useMissionStore();

  const [coordBody, setCoordBody] = useState<CelestialBody>('mars');
  const [coordLat, setCoordLat] = useState('18.38');
  const [coordLon, setCoordLon] = useState('77.58');
  const [coordName, setCoordName] = useState('');
  const [coordError, setCoordError] = useState<string | null>(null);

  const epochDate = useMemo(
    () => parseEpochDate(config.epochDateIso),
    [config.epochDateIso]
  );
  const marsLs = useMemo(() => computeMarsLsDeg(epochDate), [epochDate]);

  const selectedTargets = useMemo(
    () => customTargets.filter((t) => config.targetIds.includes(t.id)),
    [customTargets, config.targetIds]
  );
  const allTargetsVacuum =
    selectedTargets.length > 0 && selectedTargets.every((t) => t.isVacuumRegime);
  const overrideCount = config.targetOverrides
    ? Object.keys(config.targetOverrides).length
    : 0;

  const rawWeightSum = useMemo(
    () =>
      Object.entries(config.domainWeights).reduce(
        (acc, [k, v]) => (allTargetsVacuum && k === 'atmospheric' ? acc : acc + v),
        0
      ),
    [config.domainWeights, allTargetsVacuum]
  );
  const weightTotal = rawWeightSum > 1e-6 ? rawWeightSum : 1;

  if (viewComplexity === 'guided') {
    return <GuidedWizard />;
  }

  const handleAddCoordTarget = (ev: React.FormEvent) => {
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
    });
    setCoordName('');
  };

  const isBroad = config.searchScope === 'broad_250';

  return (
    <aside className="h-full flex flex-col bg-[#0a0e16] border-r border-slate-800 min-h-0">
      <div className="px-3.5 py-2.5 border-b border-slate-800 bg-[#0d121c] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-amber-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Mission Configuration
          </h2>
        </div>
        <span className="font-mono tabular-nums text-[11px] text-slate-400">
          {config.targetIds.length} active ·{' '}
          <span className="text-amber-300">Expert</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* AI Mission Architect (Custom Presets, Ambiguity Follow-Ups, Multi-Component Split) */}
        <AiMissionArchitect />

        {/* 1. Target-First Selector */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              1. Extraterrestrial Targets
            </h3>
            {config.targetIds.length > 0 && (
              <button
                type="button"
                onClick={clearTargets}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-300 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {config.targetIds.length === 0 && (
            <div className="p-2.5 rounded border border-amber-500/40 bg-amber-950/20 text-[11px] text-amber-200 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Target-First Lock: Enter Mars or Moon coordinates below, search an IAU crater/region, or click anywhere on the Mars/Moon globe to unlock full-Earth discovery.
              </span>
            </div>
          )}

          {config.targetIds.length >= 2 && (
            <div className="p-2.5 rounded border border-cyan-500/40 bg-cyan-950/20 text-[11px] text-cyan-200">
              Isolated Pipelines Active ({config.targetIds.length} targets) · Zero target averaging; each target maintains an independent ranking tab and CTCM row.
            </div>
          )}

          {/* Quick Body Focus Links (2D Map & 3D Globe) */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setBodyFocus('mars')}
              className="px-2.5 py-1.5 rounded border border-amber-500/40 bg-[#0d121c] hover:border-amber-400 text-[11px] font-mono text-amber-300 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              Focus Mars · Ls {marsLs.toFixed(0)}°
            </button>
            <button
              type="button"
              onClick={() => setBodyFocus('moon')}
              className="px-2.5 py-1.5 rounded border border-slate-600 bg-[#0d121c] hover:border-cyan-400 text-[11px] font-mono text-cyan-300 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              Focus Moon
            </button>
          </div>

          {/* Add Coordinate Target Form */}
          <form
            onSubmit={handleAddCoordTarget}
            className="p-2.5 rounded border border-slate-800 bg-[#0d121c] space-y-2"
          >
            <div className="text-[11px] font-medium text-slate-300">
              Add Coordinate Target
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <label className="space-y-0.5">
                <span className="text-[10px] text-slate-400">Body</span>
                <select
                  aria-label="Target Planetary Body"
                  value={coordBody}
                  onChange={(e) => setCoordBody(e.target.value as CelestialBody)}
                  className="w-full px-1.5 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-100 focus:outline-none focus:border-cyan-500"
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
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-[#070a10] font-mono tabular-nums text-[11px] text-slate-100 focus:outline-none focus:border-cyan-500"
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
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-[#070a10] font-mono tabular-nums text-[11px] text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>
            </div>

            <label className="block space-y-0.5">
              <span className="text-[10px] text-slate-400">Label (optional)</span>
              <input
                type="text"
                value={coordName}
                onChange={(e) => setCoordName(e.target.value)}
                placeholder="Auto IAU or lat/lon"
                className="w-full px-2 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </label>

            {coordError && (
              <div className="text-[10px] text-red-300">{coordError}</div>
            )}

            <button
              type="submit"
              className="w-full py-1.5 rounded border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-medium text-amber-200 flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Target &amp; Screen 17,768 Cells</span>
            </button>
          </form>

          {/* Active & Synthesized Coordinate Targets */}
          {customTargets.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[11px] text-slate-400">
                Selected Targets ({customTargets.length})
              </div>
              <div className="grid grid-cols-1 gap-1">
                {customTargets.map((t) => {
                  const active = config.targetIds.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded border transition-colors ${
                        active
                          ? 'border-amber-500/60 bg-amber-500/10 text-slate-100'
                          : 'border-slate-800 bg-[#0d121c] text-slate-400'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTarget(t.id)}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium truncate">
                            {t.name}
                          </span>
                          <span className="font-mono tabular-nums text-[10px] text-slate-400 shrink-0">
                            {t.body.toUpperCase()} · {t.lat.toFixed(1)}°, {t.lon.toFixed(1)}°
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {t.missionArchetype}
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
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* 2. Starting Profile & Direct Continuous Domain Weights */}
        <section className="space-y-2.5 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              2. Starting Profile &amp; Domain Weights
            </h3>
            <span className="font-mono tabular-nums text-[10px] text-slate-400">
              Σ = {rawWeightSum.toFixed(2)}
            </span>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">
              Weighting Profile Starter
            </span>
            <select
              aria-label="Mission Weighting Profile Starter"
              value={weightingProfileId}
              onChange={(e) => selectWeightingProfile(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-700 bg-[#0d121c] text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              {customPresets.length > 0 && (
                <optgroup label="AI-Generated Mission Presets">
                  {customPresets.map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {PROFILE_GROUPS.map((grp) => (
                <optgroup key={grp.id} label={grp.label}>
                  {GRANULAR_WEIGHTING_PROFILES.filter(
                    (p) => p.group === grp.id
                  ).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="custom">Custom Numeric Weights</option>
            </select>
          </label>

          {overrideCount > 0 && (
            <div className="p-2 rounded border border-cyan-500/40 bg-cyan-950/20 text-[10px] text-cyan-200 flex items-center justify-between gap-2">
              <span className="leading-snug">
                AI component weights active on {overrideCount} target{overrideCount > 1 ? 's' : ''}. Global sliders apply only after reset.
              </span>
              <button
                type="button"
                onClick={clearTargetOverrides}
                className="px-2 py-0.5 rounded border border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/25 font-mono text-[10px] text-cyan-100 cursor-pointer whitespace-nowrap shrink-0"
              >
                Reset Overrides
              </button>
            </div>
          )}

          {/* Direct Continuous Sliders + Numeric Inputs (Zero Preset Tier Dropdowns) */}
          <div className="space-y-2.5 p-2.5 rounded border border-slate-800 bg-[#0d121c]">
            {DOMAINS.map(({ key, label }) => {
              const vacuumLocked = allTargetsVacuum && key === 'atmospheric';
              const raw = vacuumLocked ? 0 : config.domainWeights[key];
              const pct = vacuumLocked ? 0 : Math.round((raw / weightTotal) * 100);

              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={`truncate ${vacuumLocked ? 'text-slate-500' : 'text-slate-300'}`}>
                      {label}
                      {vacuumLocked ? ' · Vacuum Guard (0%)' : ''}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono tabular-nums text-[10px] text-cyan-300 w-7 text-right">
                        {pct}%
                      </span>
                      <NumericField
                        ariaLabel={`${label} numeric weight`}
                        value={raw}
                        min={0}
                        max={1}
                        step={0.01}
                        decimals={2}
                        disabled={vacuumLocked}
                        onCommit={(val) => setDomainWeight(key, val)}
                      />
                    </div>
                  </div>
                  <input
                    type="range"
                    aria-label={`${label} weight slider`}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={vacuumLocked}
                    value={raw}
                    onChange={(e) => setDomainWeight(key, Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer h-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                </div>
              );
            })}

            {Math.abs(rawWeightSum - 1.0) > 0.015 && (
              <button
                type="button"
                onClick={normalizeDomainWeights}
                className="w-full py-1 px-2 rounded border border-slate-700 bg-[#070a10] hover:border-cyan-500/60 text-[10px] font-mono text-cyan-300 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Scale className="w-3 h-3" />
                <span>Normalize Weights to 1.00</span>
              </button>
            )}
          </div>
        </section>

        {/* 3. Ephemeris Epoch & Campaign Window */}
        <section className="space-y-2.5 pt-2 border-t border-slate-800/80">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            3. Ephemeris Epoch &amp; Campaign Window
          </h3>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">Epoch Date (UTC)</span>
              <input
                type="date"
                value={config.epochDateIso}
                onChange={(e) => setEpochDate(e.target.value)}
                className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0d121c] font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400">
                <span>Days</span>
                <NumericField
                  ariaLabel="Campaign duration days"
                  value={config.durationDays}
                  min={3}
                  max={90}
                  step={1}
                  decimals={0}
                  className="w-14"
                  onCommit={(val) => setDurationDays(val)}
                />
              </div>
              <input
                type="range"
                aria-label="Campaign duration slider"
                min={3}
                max={90}
                step={1}
                value={config.durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer h-1.5 mt-1.5"
              />
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">
              Astrobiology Layer C Mode
            </span>
            <select
              value={config.astrobiologyMode}
              onChange={(e) =>
                setAstrobiologyMode(e.target.value as AstrobiologyMode)
              }
              className="w-full px-2.5 py-1.5 rounded border border-slate-700 bg-[#0d121c] text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="clean_instrument_test">
                Clean Instrument Test (Penalize High TOC)
              </option>
              <option value="biosignature_habitability_analog">
                Biosignature &amp; Habitability Analog
              </option>
              <option value="ignore">Ignore Biotic Signal (Structural/ISRU)</option>
            </select>
          </label>
        </section>

        {/* 4. Global Screening Depth & Access Filters */}
        <section className="space-y-2.5 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              4. Screening Scope &amp; Access Filters
            </h3>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Stage-2 Live Verification Depth</span>
              {batchVerifyState.total > 0 && (
                <span className="font-mono tabular-nums text-[10px] text-cyan-300">
                  {batchVerifyState.completed}/{batchVerifyState.total}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setSearchScope('standard_100')}
                className={`py-1 px-2 rounded border text-[11px] font-mono cursor-pointer transition-colors ${
                  !isBroad
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-700 bg-[#0d121c] text-slate-400 hover:text-slate-200'
                }`}
              >
                Top 100 NMS
              </button>
              <button
                type="button"
                onClick={() => setSearchScope('broad_250')}
                className={`py-1 px-2 rounded border text-[11px] font-mono cursor-pointer transition-colors ${
                  isBroad
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                    : 'border-slate-700 bg-[#0d121c] text-slate-400 hover:text-slate-200'
                }`}
              >
                Broaden Top 250
              </button>
            </div>
            {config.targetIds.length > 0 && !batchVerifyState.inFlight && (
              <button
                type="button"
                onClick={() =>
                  void verifyShortlistLive(isBroad ? 250 : 100, { force: true })
                }
                className="w-full py-1 px-2 rounded border border-slate-700 bg-[#070a10] hover:border-emerald-500/50 text-[10px] font-mono text-emerald-300 cursor-pointer"
              >
                Refresh Live NASA POWER / DEM Shortlist
              </button>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-400">Max Median Slope (°)</span>
              <NumericField
                ariaLabel="Max median slope degrees"
                value={maxSlopeFilterDeg}
                min={5}
                max={45}
                step={1}
                decimals={0}
                className="w-14"
                onCommit={(val) => setMaxSlopeFilter(Math.round(val))}
              />
            </div>
            <input
              type="range"
              aria-label="Max median slope slider"
              min={5}
              max={45}
              step={1}
              value={maxSlopeFilterDeg}
              onChange={(e) => setMaxSlopeFilter(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer h-1.5"
            />
          </div>

          <div className="space-y-1">
            <span className="text-[11px] text-slate-400">
              Allowed Field Permit Tiers
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {PERMIT_LABELS.map((tier) => {
                const checked = config.allowedPermitTiers.includes(tier.id);
                return (
                  <label
                    key={tier.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] cursor-pointer ${
                      checked
                        ? 'border-slate-600 bg-[#121926] text-slate-200'
                        : 'border-slate-800 bg-[#0a0e16] text-slate-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePermitTier(tier.id)}
                      className="accent-cyan-400"
                    />
                    <span className="truncate">{tier.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}
