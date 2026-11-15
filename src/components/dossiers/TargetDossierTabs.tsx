import { Info, Layers, Loader2, Lock } from 'lucide-react';
import { useMissionStore } from '../../store/missionStore.js';
import { CandidateCard } from './CandidateCard.js';
import { CrossTargetMatrix } from './CrossTargetMatrix.js';
import { GuidedEarthResults } from './GuidedEarthResults.js';
import { PortfolioBuilder } from './PortfolioBuilder.js';

export function TargetDossierTabs() {
  const {
    targets,
    config,
    dossiers,
    crossTargetMatrix,
    multiTargetPortfolio,
    totalLocationsScreened,
    activeTargetTabId,
    setActiveTargetTabId,
    viewComplexity,
    selectedSiteId,
    siteScrollNonce,
    selectEarthSite,
    maxSlopeFilterDeg,
    computeLatencyMs,
    batchVerifyState,
    verifyShortlistLive,
    setSearchScope,
  } = useMissionStore();

  if (config.targetIds.length === 0 || dossiers.length === 0) {
    return (
      <section className="h-full flex flex-col items-center justify-center p-6 text-center bg-[#0a0e16] border-l border-slate-800">
        <Lock className="w-8 h-8 text-amber-400/80 mb-3" />
        <h2 className="text-sm font-semibold text-slate-200">
          {viewComplexity === 'guided'
            ? 'Start Your Mission in Steps 1 & 2'
            : 'Target-First Causality Lock'}
        </h2>
        <p className="text-xs text-slate-400 mt-1.5 max-w-xs leading-relaxed">
          {viewComplexity === 'guided'
            ? `Choose your mission focus in Step 1, then pick a Mars or Moon site in Step 2 (or click the globe) to screen all ${totalLocationsScreened.toLocaleString()} Earth grid cells.`
            : `Enter Mars or Moon coordinates in Column 1, search an IAU feature, or click anywhere on the Mars or Moon globe to screen all ${totalLocationsScreened.toLocaleString()} Earth grid locations.`}
        </p>
      </section>
    );
  }

  const activeDossier =
    dossiers.find((d) => d.target.id === activeTargetTabId) ?? dossiers[0];

  const isMatrixTab = viewComplexity === 'expert' && activeTargetTabId === 'matrix';
  const isPortfolioTab = viewComplexity === 'expert' && activeTargetTabId === 'portfolio';
  const anyAutoSplit = dossiers.some((d) => d.portfolio?.triggeredAutomatically);
  const searchScope = config.searchScope ?? 'standard_100';
  const isBroad = searchScope === 'broad_250';

  const filteredCandidates = activeDossier.rankedCandidates.filter(
    (c) => c.site.morphology.medianSlopeDeg <= maxSlopeFilterDeg
  );

  return (
    <section className="h-full flex flex-col bg-[#0a0e16] border-l border-slate-800 min-h-0">
      {/* Tab Bar */}
      <div className="px-3 pt-2.5 pb-2 border-b border-slate-800 bg-[#0d121c] shrink-0">
        {(viewComplexity === 'expert' || dossiers.length >= 2) && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {dossiers.map((d) => {
              const active = activeTargetTabId === d.target.id;
              return (
                <button
                  key={d.target.id}
                  type="button"
                  onClick={() => setActiveTargetTabId(d.target.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {d.target.name.split(' ').slice(0, 2).join(' ')}
                </button>
              );
            })}

            {viewComplexity === 'expert' && (
              <button
                type="button"
                onClick={() => setActiveTargetTabId('portfolio')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isPortfolioTab
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                2-Site Split{dossiers.length >= 2 ? ` (${dossiers.length})` : ''}
                {anyAutoSplit ? ' · Auto' : ''}
              </button>
            )}

            {viewComplexity === 'expert' && dossiers.length >= 2 && (
              <button
                type="button"
                onClick={() => setActiveTargetTabId('matrix')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isMatrixTab
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                CTCM Matrix
              </button>
            )}
          </div>
        )}

        {/* Header Summary Bar */}
        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 mt-1">
          {isPortfolioTab && dossiers.length >= 2 ? (
            <>
              <span>
                {dossiers.length} Selected Targets · All-Target 2-Site Splits
              </span>
              <span>{computeLatencyMs.toFixed(1)} ms</span>
            </>
          ) : viewComplexity === 'guided' ? (
            <>
              <span className="font-sans font-semibold text-xs text-slate-200 truncate">
                Earth Analog Report · {activeDossier.target.name}
              </span>
              <span className="shrink-0">
                Top {isBroad ? 250 : 100} regions
              </span>
            </>
          ) : (
            <>
              <span>
                {activeDossier.target.body === 'mars'
                  ? `Mars Ls ${activeDossier.ephemeris.marsLsDeg.toFixed(1)}°`
                  : `Moon β☉ ${activeDossier.ephemeris.lunarMaxSolarElevDeg.toFixed(1)}°${
                      activeDossier.ephemeris.lunarIsPermanentlyShadowed ? ' (PSR)' : ''
                    }`}{' '}
                · T_eff {activeDossier.ephemeris.targetEffectiveTempK.toFixed(0)} K
              </span>
              <span>
                {(activeDossier.totalLocationsScreened ?? totalLocationsScreened).toLocaleString()} screened · {filteredCandidates.length} NMS · {computeLatencyMs.toFixed(1)} ms
              </span>
            </>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isMatrixTab ? (
          <CrossTargetMatrix
            matrix={crossTargetMatrix}
            targets={targets}
            onSelectSite={(id) => selectEarthSite(id, 'dossier', dossiers[0].target.id)}
          />
        ) : isPortfolioTab ? (
          <PortfolioBuilder
            dossiers={dossiers}
            multiTargetPortfolio={multiTargetPortfolio}
            viewComplexity={viewComplexity}
            onSelectSite={(targetId, siteId) =>
              selectEarthSite(siteId, 'dossier', targetId)
            }
          />
        ) : viewComplexity === 'guided' ? (
          <GuidedEarthResults
            dossiers={dossiers}
            activeDossier={activeDossier}
            multiTargetPortfolio={multiTargetPortfolio}
            selectedSiteId={selectedSiteId}
            scrollNonce={siteScrollNonce}
            durationDays={config.durationDays}
            maxSlopeFilterDeg={maxSlopeFilterDeg}
            searchScope={searchScope}
            batchVerifyState={batchVerifyState}
            onSetSearchScope={setSearchScope}
            onRetryLiveCheck={() =>
              void verifyShortlistLive(isBroad ? 250 : 100, { force: true })
            }
            onSelectSite={(targetId, siteId) =>
              selectEarthSite(siteId, 'dossier', targetId)
            }
          />
        ) : (
          <>
            {/* Expert Mode Shortlist Live Verification & Algorithm Scope Disclosure */}
            <div className="p-2.5 rounded-lg border border-slate-800 bg-[#0d121c] text-[11px] space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>
                    Stage-2 Shortlist ({filteredCandidates.length} of Top {isBroad ? 250 : 100} NMS Regions)
                  </span>
                </span>
                {batchVerifyState.inFlight ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 shrink-0">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {batchVerifyState.completed}/{batchVerifyState.total}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSearchScope(isBroad ? 'standard_100' : 'broad_250')}
                    className={`px-2 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      isBroad
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                        : 'border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                    }`}
                  >
                    {isBroad ? 'Top 250 Active' : 'Broaden Search (Top 250)'}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Coarse 1° Stage-1 screening and Spatial NMS approximate global best fits; localized micro-analogs may exist outside this shortlist. Live NASA POWER &amp; Terrarium DEM augment shortlisted candidates non-destructively.
              </p>
            </div>

            {config.targetOverrides?.[activeDossier.target.id] && (
              <div className="p-2.5 rounded border border-cyan-500/40 bg-cyan-950/20 text-[11px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-cyan-200 truncate">
                    {config.targetOverrides[activeDossier.target.id].componentTitle ??
                      activeDossier.target.name}
                  </span>
                  <span className="font-mono text-[10px] text-cyan-300 shrink-0">
                    {config.targetOverrides[activeDossier.target.id].presetId}
                  </span>
                </div>
                {config.targetOverrides[activeDossier.target.id].componentRole && (
                  <div className="text-[10px] text-slate-300">
                    {config.targetOverrides[activeDossier.target.id].componentRole}
                  </div>
                )}
                <div className="font-mono tabular-nums text-[10px] text-slate-400">
                  {(['geochemistry', 'morphology', 'thermal', 'atmospheric', 'operations'] as const)
                    .map((k) => {
                      const lbl =
                        k === 'geochemistry'
                          ? 'Geo'
                          : k === 'morphology'
                            ? 'Morph'
                            : k === 'thermal'
                              ? 'Therm'
                              : k === 'atmospheric'
                                ? 'Atm'
                                : 'Ops';
                      const w = config.targetOverrides![activeDossier.target.id].domainWeights[k];
                      return `${lbl} ${Math.round(w * 100)}%`;
                    })
                    .join(' · ')}
                </div>
              </div>
            )}

            {/* Auto-triggered 2-Site Split Alert Banner */}
            {activeDossier.portfolio?.triggeredAutomatically && (
              <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/20 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Single-Site Ceiling (&lt; 72%) — 2-Site Split Active
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTargetTabId('portfolio')}
                    className="text-amber-200 underline hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Inspect Split
                  </button>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {activeDossier.portfolio.rationale}
                </p>
              </div>
            )}

            {filteredCandidates.length === 0 ? (
              <div className="p-4 rounded-lg border border-slate-800 bg-[#0d121c] text-xs text-slate-400">
                No discovered Earth regions match the current Permit / Slope filters. Widen slope or permit filters in Column 1.
              </div>
            ) : (
              filteredCandidates.map((cand) => (
                <CandidateCard
                  key={cand.site.id}
                  candidate={cand}
                  durationDays={config.durationDays}
                  viewComplexity={viewComplexity}
                  isSelected={selectedSiteId === cand.site.id}
                  scrollNonce={siteScrollNonce}
                  onSelect={() => selectEarthSite(cand.site.id, 'dossier')}
                />
              ))
            )}
          </>
        )}
      </div>
    </section>
  );
}
