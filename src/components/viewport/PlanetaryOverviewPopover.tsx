import { Compass, Crosshair, Loader2, MapPin, X } from 'lucide-react';
import { useMissionStore } from '../../store/missionStore.js';

export function PlanetaryOverviewPopover() {
  const {
    bodyFocus,
    config,
    viewComplexity,
    probingInFlight,
    inspectedPlanetaryPoint,
    inspectedEarthPoint,
    promoteInspectedTarget,
    removeCustomTarget,
    clearInspectedPoint,
    probeEarthCoordinate,
    selectEarthSite,
  } = useMissionStore();

  const isGuided = viewComplexity === 'guided';

  // Mars or Moon Target Survey Popover
  if (
    inspectedPlanetaryPoint &&
    bodyFocus === inspectedPlanetaryPoint.body
  ) {
    const pt = inspectedPlanetaryPoint;
    const isAlreadyActive =
      pt.matchedTargetId !== null &&
      config.targetIds.includes(pt.matchedTargetId);

    return (
      <div
        role="dialog"
        aria-label={`${pt.body.toUpperCase()} Target Inspector`}
        className="absolute bottom-11 right-3 z-[850] w-[330px] max-w-[calc(100%-24px)] rounded border border-slate-700 bg-[#0d121c] p-3.5 shadow-xl space-y-2.5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-300">
              <Compass className="w-3 h-3 shrink-0" />
              <span>
                {pt.body} · {isAlreadyActive ? 'Active Target' : 'Candidate Survey Point'}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-slate-100 truncate mt-0.5">
              {pt.name}
            </h3>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {pt.lat.toFixed(2)}°, {pt.lon.toFixed(2)}°
            </div>
          </div>
          <button
            type="button"
            onClick={clearInspectedPoint}
            aria-label="Close target inspector"
            className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Computed Ephemeris & Terrain Regime */}
        <div className="py-2 border-y border-slate-800/80 space-y-1 text-[11px] font-mono tabular-nums">
          <div className="flex items-center justify-between text-slate-300">
            <span>
              {pt.body === 'mars'
                ? `Mars Ls ${pt.marsLsDeg.toFixed(0)}°`
                : `Sun angle ${pt.lunarMaxSolarElevDeg.toFixed(1)}°${
                    pt.lunarIsPermanentlyShadowed ? ' (PSR)' : ''
                  }`}
            </span>
            <span className="text-amber-300">
              ~{pt.estimatedTempK.toFixed(0)} K
            </span>
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            {pt.regimeNote}
          </div>
        </div>

        {/* Location Selection Action Only (Mission Goal Configured in Main Panel) */}
        <div className="flex items-center justify-end gap-2">
          {isAlreadyActive && pt.matchedTargetId ? (
            <>
              <button
                type="button"
                onClick={() => {
                  removeCustomTarget(pt.matchedTargetId!);
                  clearInspectedPoint();
                }}
                className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-300 hover:text-red-300 hover:border-red-500/50 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                Remove Target
              </button>
              <span className="px-1.5 py-1 text-[11px] font-medium text-emerald-300 whitespace-nowrap shrink-0">
                Active Target ✓
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={clearInspectedPoint}
                className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-300 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => promoteInspectedTarget()}
                className="px-3 py-1.5 rounded border border-amber-500/70 bg-amber-500/20 hover:bg-amber-500/30 text-[11px] font-medium text-amber-200 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                + Select Location
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Earth 1° Analog Cell / Searched Location Inspector
  if (inspectedEarthPoint && bodyFocus === 'earth') {
    const ep = inspectedEarthPoint;
    const hasActiveTargets = config.targetIds.length > 0;
    const isCell = ep.sourceKind === 'cell';

    return (
      <div
        role="dialog"
        aria-label={isCell ? 'Earth 1° Analog Cell Inspector' : 'Earth Location Inspection'}
        className="absolute bottom-11 right-3 z-[850] w-[345px] max-w-[calc(100%-24px)] rounded border border-slate-700 bg-[#0d121c] p-3.5 shadow-xl space-y-2.5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-300">
              <MapPin className="w-3 h-3 shrink-0" />
              <span>{isCell ? '1° Screening Analog Cell' : 'Earth Location'}</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-100 truncate mt-0.5">
              {ep.name}
            </h3>
            {ep.subtitle && (
              <div className="text-[11px] text-slate-400 truncate">
                {ep.subtitle}
              </div>
            )}
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {ep.lat.toFixed(2)}°, {ep.lon.toFixed(2)}°
            </div>
          </div>

          {typeof ep.cellScorePct === 'number' && (
            <div className="text-right shrink-0 font-mono tabular-nums">
              <div className="text-base font-semibold text-emerald-300 leading-none">
                {ep.cellScorePct.toFixed(0)}%
              </div>
              {ep.cellBestQuarter && (
                <div className="text-[10px] text-slate-400 mt-1">
                  Best Q{ep.cellBestQuarter}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={clearInspectedPoint}
            aria-label="Close Earth inspection"
            className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {(ep.lithologyNote || (ep.nearestSiteName && ep.nearestSiteId)) && (
          <div className="py-2 border-y border-slate-800/80 space-y-1.5 text-[11px]">
            {ep.lithologyNote && (
              <div className="text-slate-300 leading-snug">
                {ep.lithologyNote}
              </div>
            )}
            {ep.nearestSiteName && ep.nearestSiteId && (
              <div className="flex items-center justify-between gap-2 text-slate-400">
                <span className="truncate">
                  Nearest ranked analog: <span className="text-slate-200">{ep.nearestSiteName}</span> ({ep.nearestSiteDistKm} km)
                </span>
                <button
                  type="button"
                  onClick={() => selectEarthSite(ep.nearestSiteId!, 'dossier')}
                  className="text-cyan-300 hover:text-cyan-200 underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={clearInspectedPoint}
            className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-300 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Close
          </button>
          {!isGuided && (
            <button
              type="button"
              disabled={!hasActiveTargets || probingInFlight}
              onClick={() => void probeEarthCoordinate(ep.lat, ep.lon)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-cyan-500/70 bg-cyan-500/20 hover:bg-cyan-500/30 text-[11px] font-medium text-cyan-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {probingInFlight ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Crosshair className="w-3 h-3" />
              )}
              <span>
                {probingInFlight
                  ? 'Probing NASA/DEM...'
                  : hasActiveTargets
                    ? 'Probe Live NASA/DEM'
                    : 'Select Target First'}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
