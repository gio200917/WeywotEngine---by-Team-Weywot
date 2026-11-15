import {
  AlertTriangle,
  Crosshair,
  Globe2,
  Layers,
  Loader2,
  Map as MapIcon,
  Tag,
  X,
} from 'lucide-react';
import {
  type EarthOverlay,
  type MarsOverlay,
  type MoonOverlay,
  useMissionStore,
} from '../../store/missionStore.js';
import type { BodyType } from '../../types/planetary.js';
import { GlobeView } from './GlobeView.js';
import { MapView } from './MapView.js';
import { PlanetaryOverviewPopover } from './PlanetaryOverviewPopover.js';
import { UnifiedSearchBar } from './UnifiedSearchBar.js';

const PLANETARY_TABS: Array<{ id: BodyType; label: string }> = [
  { id: 'earth', label: 'Earth' },
  { id: 'mars', label: 'Mars' },
  { id: 'moon', label: 'Moon' },
];

export function SpatialViewport() {
  const {
    config,
    viewportMode,
    setViewportMode,
    bodyFocus,
    setBodyFocus,
    earthOverlay,
    setEarthOverlay,
    marsOverlay,
    setMarsOverlay,
    moonOverlay,
    setMoonOverlay,
    showLocationLabels,
    setShowLocationLabels,
    showDiscoveryHeatmap,
    setShowDiscoveryHeatmap,
    probeModeActive,
    setProbeModeActive,
    probingInFlight,
    probeStatusMsg,
    setProbeStatusMsg,
    probeErrorMsg,
    setProbeErrorMsg,
    probeWarnings,
    webglFallbackMsg,
    setWebglFallbackMsg,
    viewComplexity,
    guidedStep,
  } = useMissionStore();

  const targetLocked = config.targetIds.length === 0;
  const isGuided = viewComplexity === 'guided';
  const visibleTabs =
    isGuided && guidedStep !== 'review'
      ? PLANETARY_TABS.filter((t) => t.id !== 'earth')
      : PLANETARY_TABS;

  const guidedBannerText =
    guidedStep === 'goal'
      ? 'Step 1 of 3 — Pick your mission goal on the left, then click Continue to Step 2.'
      : guidedStep === 'target'
        ? `Step 2 of 3 — Click anywhere on ${bodyFocus.toUpperCase()} or pick a site on the left, then click Find Matching Earth Sites.`
        : 'Step 3 of 3 — Top regions are auto-verified with live NASA/DEM data. Click any Earth pin or ranked site to inspect.';

  return (
    <section className="h-full flex flex-col bg-[#07090e] min-h-0">
      {/* Viewport Control Bar */}
      <div className="px-3 py-1.5 border-b border-slate-800 bg-[#0d121c] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 3D GLOBE / 2D MAP switch */}
          <div className="inline-flex rounded border border-slate-700 bg-[#070a10] p-0.5">
            <button
              type="button"
              onClick={() => setViewportMode('globe')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                viewportMode === 'globe'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe2 className="w-3 h-3" />
              <span>3D GLOBE</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('map')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                viewportMode === 'map'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MapIcon className="w-3 h-3" />
              <span>2D MAP</span>
            </button>
          </div>

          {/* Tab-Style Planetary Switcher */}
          <div
            role="tablist"
            aria-label="Planetary Body Tabs"
            className="inline-flex items-end border-b border-slate-700/80 gap-0.5 px-0.5"
          >
            {visibleTabs.map((tab) => {
              const active = bodyFocus === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setBodyFocus(tab.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wide whitespace-nowrap shrink-0 cursor-pointer transition-colors rounded-t ${
                    active
                      ? 'bg-[#121a28] text-slate-100 font-semibold border-x border-t border-slate-700/80 -mb-px pb-[7px]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <span>{tab.label}</span>
                  {active && (
                    <span
                      className={`absolute inset-x-0 bottom-0 h-[2px] ${
                        tab.id === 'earth'
                          ? 'bg-cyan-400'
                          : tab.id === 'mars'
                            ? 'bg-amber-400'
                            : 'bg-slate-300'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Body Overlay Selector (Expert Mode Only) */}
          {!isGuided && bodyFocus === 'earth' && (
            <select
              aria-label="Earth Base Layer"
              value={earthOverlay}
              onChange={(e) => setEarthOverlay(e.target.value as EarthOverlay)}
              className="px-2 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="google_satellite">Google Satellite (HD)</option>
              <option value="sentinel_cloudless">Sentinel-2 Cloudless</option>
              <option value="blue_marble">NASA Blue Marble</option>
              <option value="aster_gdem">ASTER GDEM Relief</option>
              <option value="osm">Street &amp; Terrain</option>
            </select>
          )}

          {!isGuided && bodyFocus === 'mars' && (
            <select
              aria-label="Mars Trek Layer"
              value={marsOverlay}
              onChange={(e) => setMarsOverlay(e.target.value as MarsOverlay)}
              className="px-2 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="mola_color">MOLA Color Shaded Relief</option>
              <option value="themis_ir">THEMIS IR Day Mosaic</option>
            </select>
          )}

          {!isGuided && bodyFocus === 'moon' && (
            <select
              aria-label="Moon Trek Layer"
              value={moonOverlay}
              onChange={(e) => setMoonOverlay(e.target.value as MoonOverlay)}
              className="px-2 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="lro_wac">LRO WAC Global 303ppd</option>
            </select>
          )}
        </div>

        {/* Right Action Toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(!isGuided || guidedStep !== 'goal') && <UnifiedSearchBar />}

          <button
            type="button"
            onClick={() => setShowLocationLabels(!showLocationLabels)}
            title="Toggle geographic & IAU planetary feature names"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              showLocationLabels
                ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                : 'border-slate-700 bg-[#070a10] text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            <Tag className="w-3 h-3" />
            <span>Labels {showLocationLabels ? 'ON' : 'OFF'}</span>
          </button>

          {!isGuided && (
            <>
              <button
                type="button"
                disabled={targetLocked}
                onClick={() => setShowDiscoveryHeatmap(!showDiscoveryHeatmap)}
                title="Toggle 17,768-cell 1° Earth Screening Grid"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  showDiscoveryHeatmap
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                    : 'border-slate-700 bg-[#070a10] text-slate-300 hover:border-slate-600'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Analog Cells</span>
              </button>

              <button
                type="button"
                disabled={targetLocked || bodyFocus !== 'earth' || probingInFlight}
                onClick={() => setProbeModeActive(!probeModeActive)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  probeModeActive
                    ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                    : 'border-slate-700 bg-[#070a10] text-slate-300 hover:border-slate-600'
                }`}
              >
                {probingInFlight ? (
                  <Loader2 className="w-3 h-3 animate-spin text-cyan-300" />
                ) : (
                  <Crosshair className="w-3 h-3" />
                )}
                <span>
                  {probingInFlight
                    ? 'Probing Live NASA/DEM...'
                    : probeModeActive
                      ? 'Click Earth to Probe'
                      : '+ Probe Earth Coordinate'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Guided Mode Step-Locked Action Banner */}
      {isGuided && (
        <div className="px-3 py-1 border-b border-slate-800/80 bg-[#090d16] text-[11px] text-slate-300 shrink-0">
          <span className="truncate block">{guidedBannerText}</span>
        </div>
      )}

      {/* Discreet WebGL Fallback Notice Banner */}
      {webglFallbackMsg && (
        <div className="px-3 py-1.5 border-b border-amber-500/40 bg-amber-950/30 text-[11px] text-amber-200 flex items-center justify-between gap-2 shrink-0">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{webglFallbackMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setWebglFallbackMsg(null)}
            className="text-amber-300 hover:text-white cursor-pointer"
            aria-label="Dismiss WebGL fallback notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Probe Error Toast Banner */}
      {probeErrorMsg && (
        <div className="px-3 py-1.5 border-b border-red-500/50 bg-red-950/35 text-[11px] text-red-200 flex items-center justify-between gap-2 shrink-0">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span>{probeErrorMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setProbeErrorMsg(null)}
            className="text-red-300 hover:text-white cursor-pointer"
            aria-label="Dismiss probe error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Probe Status & Enrichment Warnings Banner */}
      {probeStatusMsg && !isGuided && (
        <div className="px-3 py-1.5 border-b border-slate-800 bg-[#0b111b] text-[11px] font-mono text-cyan-300 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            {probingInFlight && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
            <span>{probeStatusMsg}</span>
            {probeWarnings.length > 0 && (
              <span className="text-amber-300/90 text-[10px]">
                · {probeWarnings.join(' · ')}
              </span>
            )}
          </div>
          {!probingInFlight && (
            <button
              type="button"
              onClick={() => setProbeStatusMsg(null)}
              className="text-slate-400 hover:text-white cursor-pointer shrink-0"
              aria-label="Dismiss probe status"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Spatial Canvas */}
      <div className="flex-1 min-h-0 relative">
        {viewportMode === 'map' ? <MapView /> : <GlobeView />}
        <PlanetaryOverviewPopover />
      </div>
    </section>
  );
}
