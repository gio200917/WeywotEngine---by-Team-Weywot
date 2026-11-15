import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Compass,
  Database,
  Info,
  Layers,
  Loader2,
  MapPin,
  Wrench,
} from 'lucide-react';
import type {
  CandidateEvaluation,
  MultiTargetTwoSitePortfolioResult,
  SearchScope,
  TargetEvaluationDossier,
} from '../../types/planetary.js';
import { DataLineageDrawer } from './DataLineageDrawer.js';

interface GuidedEarthResultsProps {
  dossiers: TargetEvaluationDossier[];
  activeDossier: TargetEvaluationDossier;
  multiTargetPortfolio: MultiTargetTwoSitePortfolioResult | null;
  selectedSiteId: string | null;
  scrollNonce: number;
  durationDays: number;
  maxSlopeFilterDeg: number;
  searchScope: SearchScope;
  batchVerifyState: {
    inFlight: boolean;
    total: number;
    completed: number;
    verifiedCount: number;
    partialCount?: number;
    error: string | null;
  };
  onSetSearchScope: (scope: SearchScope) => void;
  onRetryLiveCheck: () => void;
  onSelectSite: (targetId: string, siteId: string) => void;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function cleanSiteName(name: string): string {
  return name.replace(/\s*\(Visual Anti-Analog\)/i, '');
}

function fitTierLabel(score: number): { label: string; colorClass: string } {
  if (score >= 78) return { label: 'Strong Analog', colorClass: 'text-emerald-300' };
  if (score >= 65) return { label: 'Viable Analog', colorClass: 'text-cyan-300' };
  return { label: 'Partial Analog', colorClass: 'text-amber-300' };
}

function formatBestMonth(dayOfYear: number, durationDays: number): string {
  const idx = Math.max(0, Math.min(11, Math.floor(((dayOfYear - 1) % 365) / 30.4375)));
  return `${MONTH_NAMES[idx]} (${durationDays}-day campaign)`;
}

function sourceSummaryLabel(cand: CandidateEvaluation): string {
  if (cand.site.liveStatus === 'verified') return 'Live NASA POWER & DEM verified';
  if (cand.site.liveStatus === 'partial') return 'Partial live NASA/DEM + regional geology';
  if (cand.site.provenanceTier === 'tier2_live_probe') return 'Live NASA/DEM pin';
  return '1° Global screening baseline';
}

function GuidedDetailCard({
  candidate,
  durationDays,
  isSelected,
  scrollNonce,
  onSelect,
}: {
  candidate: CandidateEvaluation;
  durationDays: number;
  isSelected: boolean;
  scrollNonce: number;
  onSelect: () => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const lastHandledNonceRef = useRef<number>(0);

  const { site, hardwareSpecs, narrative } = candidate;
  const cleanName = cleanSiteName(site.name);
  const tier = fitTierLabel(candidate.missionFitPct);

  useEffect(() => {
    if (!isSelected) return;
    if (scrollNonce > 0 && scrollNonce !== lastHandledNonceRef.current) {
      lastHandledNonceRef.current = scrollNonce;
      articleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected, scrollNonce]);

  return (
    <article
      ref={articleRef}
      data-site-id={site.id}
      className={`rounded-lg border transition-colors ${
        isSelected
          ? 'bg-[#121926] border-cyan-400/75 ring-1 ring-cyan-500/30'
          : 'bg-[#0d121c] border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left p-3.5 cursor-pointer flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono tabular-nums text-xs font-semibold text-cyan-400">
              #{candidate.rank}
            </span>
            <h4 className="text-sm font-semibold text-slate-100 truncate">
              {cleanName}
            </h4>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {site.region}, {site.country}
          </p>
          <p className="text-[11px] font-mono text-slate-400 mt-1">
            {sourceSummaryLabel(candidate)}
          </p>
        </div>

        <div className="text-right shrink-0">
          <div className="font-mono tabular-nums text-xl font-semibold text-cyan-300 leading-none">
            {candidate.missionFitPct.toFixed(0)}
            <span className="text-xs text-slate-400 ml-0.5">%</span>
          </div>
          <div className={`text-[11px] font-medium mt-1 ${tier.colorClass}`}>
            {tier.label}
          </div>
        </div>
      </button>

      {/* Plain-English Exploration Sections */}
      <div className="px-3.5 pb-3 pt-2.5 space-y-2.5 text-xs leading-relaxed border-t border-slate-800/70">
        <div>
          <div className="font-semibold text-cyan-300 mb-0.5">Why It Matches</div>
          <p className="text-slate-200">{narrative.whyItMatches}</p>
        </div>

        <div>
          <div className="font-semibold text-amber-300 flex items-center gap-1.5 mb-0.5">
            <Wrench className="w-3.5 h-3.5 shrink-0" />
            <span>Key Limitations &amp; Hardware Needed</span>
          </div>
          <p className="text-slate-300">{narrative.whereItBreaksDown}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Gravity rig compensation: ~{Math.round((hardwareSpecs.offloadForcePer100KgN / 981) * 100)}% body-weight offload ({hardwareSpecs.offloadForcePer100KgN.toFixed(0)} N per 100 kg)
            {hardwareSpecs.requiresUvCChamber ? ' · Portable UV-C sterilizing chamber needed.' : '.'}
          </p>
        </div>

        <div>
          <div className="font-semibold text-emerald-300 flex items-center gap-1.5 mb-0.5">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>Best Field Window</span>
          </div>
          <p className="text-slate-200">
            Target <span className="font-medium text-emerald-200">{formatBestMonth(candidate.bestStartDayOfYear, durationDays)}</span>.{' '}
            {narrative.whatExplorationItEnables}
          </p>
        </div>

        <div className="pt-2 border-t border-slate-800/70 text-[11px] text-slate-300">
          <span className="font-semibold text-emerald-400">Earth Co-Benefits: </span>
          {site.earthCoBenefits}
        </div>
      </div>

      {/* Expandable Sources Drawer */}
      <div className="px-3.5 py-2 border-t border-slate-800 flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={() => setSourcesOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
        >
          <Database className="w-3.5 h-3.5" />
          <span>Verified Satellite &amp; Terrain Sources</span>
          {sourcesOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={onSelect}
          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
        >
          <MapPin className="w-3 h-3" />
          <span>Center on Earth</span>
        </button>
      </div>

      {sourcesOpen && (
        <DataLineageDrawer
          provenanceTier={site.provenanceTier}
          dataLineage={site.dataLineage}
          citations={site.citations}
        />
      )}
    </article>
  );
}

export function GuidedEarthResults({
  dossiers,
  activeDossier,
  multiTargetPortfolio,
  selectedSiteId,
  scrollNonce,
  durationDays,
  maxSlopeFilterDeg,
  searchScope,
  batchVerifyState,
  onSetSearchScope,
  onRetryLiveCheck,
  onSelectSite,
}: GuidedEarthResultsProps) {
  const isBroad = searchScope === 'broad_250';
  const filteredCandidates = activeDossier.rankedCandidates.filter(
    (c) => c.site.morphology.medianSlopeDeg <= maxSlopeFilterDeg
  );
  const leaderboard = filteredCandidates.slice(0, 12);
  const detailedList = filteredCandidates.slice(0, 15);
  const selectedOutsideTop15 =
    selectedSiteId &&
    !detailedList.some((c) => c.site.id === selectedSiteId)
      ? filteredCandidates.find((c) => c.site.id === selectedSiteId)
      : undefined;

  const cardsToShow = selectedOutsideTop15
    ? [selectedOutsideTop15, ...detailedList]
    : detailedList;

  const showCampaignSplit =
    (dossiers.length >= 2 && multiTargetPortfolio) ||
    Boolean(activeDossier.portfolio?.triggeredAutomatically);

  return (
    <div className="space-y-4">
      {/* 1. Algorithm Scope Disclosure & Live Verification Banner */}
      <div className="p-3 rounded-lg border border-slate-800 bg-[#0d121c] space-y-2 text-xs">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <div className="font-semibold text-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span>
                Top {isBroad ? 250 : 100} Regions Screened from 17,768 Cells
              </span>
              {batchVerifyState.inFlight ? (
                <span className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Live Check {batchVerifyState.completed}/{batchVerifyState.total}
                </span>
              ) : (
                <span className="font-mono text-[10px] text-emerald-300">
                  {batchVerifyState.verifiedCount > 0
                    ? `${batchVerifyState.verifiedCount} NASA/DEM Verified${
                        (batchVerifyState.partialCount ?? 0) > 0
                          ? ` · ${batchVerifyState.partialCount} Partial`
                          : ''
                      }`
                    : (batchVerifyState.partialCount ?? 0) > 0
                      ? `${batchVerifyState.partialCount} Partial Live`
                      : 'Global Shortlist Ready'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Because our fast global scan screens coarse 1° cells and spaces peaks across continents, these ranked regions may not capture every localized micro-site on Earth. Expand below for denser coverage.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
          <span className="text-[11px] text-slate-400 font-mono tabular-nums">
            Showing {filteredCandidates.length} regional matches
          </span>
          <button
            type="button"
            onClick={() => onSetSearchScope(isBroad ? 'standard_100' : 'broad_250')}
            className={`px-2.5 py-1 rounded border text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              isBroad
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                : 'border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>
              {isBroad ? 'Using Broad Top 250' : 'Broaden Search (Top 250)'}
            </span>
          </button>
        </div>

        {batchVerifyState.error && (
          <div className="pt-1.5 border-t border-amber-500/30 flex items-center justify-between gap-2 text-[11px] text-amber-300">
            <span>
              Live verification note: {batchVerifyState.error} (showing global baseline fits).
            </span>
            <button
              type="button"
              onClick={onRetryLiveCheck}
              className="px-2 py-0.5 rounded border border-amber-400/50 bg-amber-500/15 hover:bg-amber-500/25 text-[10px] font-medium text-amber-100 cursor-pointer shrink-0 whitespace-nowrap"
            >
              Retry Check
            </button>
          </div>
        )}
      </div>

      {filteredCandidates.length === 0 && (
        <div className="p-4 rounded-lg border border-slate-800 bg-[#0d121c] text-xs text-slate-300 space-y-2">
          <div className="font-semibold text-slate-100">No Matching Earth Sites Under Current Slope Limit</div>
          <p className="text-slate-400">
            Expand your search scope or switch to Expert Mode to widen terrain filters.
          </p>
        </div>
      )}

      {/* 2. Section A — Phase-by-Phase / 2-Site Split Cards */}
      {showCampaignSplit && (
        <div className="p-3.5 rounded-lg border border-emerald-500/40 bg-[#0c141d] space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                {dossiers.length >= 2 && multiTargetPortfolio
                  ? `Recommended 2-Hub Earth Campaign (${dossiers.length} Targets)`
                  : 'Complementary 2-Site Campaign'}
              </div>
              <h3 className="text-sm font-semibold text-slate-100 mt-0.5">
                Split Testing Across Two Complementary Earth Regions
              </h3>
            </div>
            <span className="font-mono tabular-nums text-base font-semibold text-emerald-400 shrink-0">
              {dossiers.length >= 2 && multiTargetPortfolio
                ? `${multiTargetPortfolio.combinedMinimaxPct.toFixed(0)}%`
                : `${activeDossier.portfolio?.combinedMinimaxPct.toFixed(0) ?? 0}%`}
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            {dossiers.length >= 2 && multiTargetPortfolio
              ? multiTargetPortfolio.rationale
              : activeDossier.portfolio?.rationale}
          </p>

          {dossiers.length >= 2 && multiTargetPortfolio ? (
            <div className="grid grid-cols-1 gap-2">
              {(['A', 'B'] as const).map((slot) => {
                const site = slot === 'A' ? multiTargetPortfolio.siteA : multiTargetPortfolio.siteB;
                const covered = multiTargetPortfolio.assignments.filter(
                  (a) => a.assignedSite === slot
                );
                const openTargetId = covered[0]?.targetId ?? activeDossier.target.id;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => onSelectSite(openTargetId, site.id)}
                    className={`text-left p-2.5 rounded border bg-[#090f18] transition-colors cursor-pointer ${
                      slot === 'A'
                        ? 'border-cyan-500/40 hover:border-cyan-400'
                        : 'border-amber-500/40 hover:border-amber-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          slot === 'A' ? 'text-cyan-300' : 'text-amber-300'
                        }`}
                      >
                        Hub {slot}: {cleanSiteName(site.name)}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">
                        {covered.length} of {multiTargetPortfolio.targetCount} phases
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {site.region}, {site.country}
                      {covered.length > 0
                        ? ` · Covers ${covered.map((c) => c.targetName).join(', ')}`
                        : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            activeDossier.portfolio && (
              <div className="grid grid-cols-1 gap-2">
                {(
                  [
                    {
                      slot: 'A',
                      site: activeDossier.portfolio.siteA,
                      score: activeDossier.portfolio.scoreAPct,
                      domains: activeDossier.portfolio.allocatedDomainsA,
                    },
                    {
                      slot: 'B',
                      site: activeDossier.portfolio.siteB,
                      score: activeDossier.portfolio.scoreBPct,
                      domains: activeDossier.portfolio.allocatedDomainsB,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.slot}
                    type="button"
                    onClick={() => onSelectSite(activeDossier.target.id, item.site.id)}
                    className={`text-left p-2.5 rounded border bg-[#090f18] transition-colors cursor-pointer ${
                      item.slot === 'A'
                        ? 'border-cyan-500/40 hover:border-cyan-400'
                        : 'border-amber-500/40 hover:border-amber-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          item.slot === 'A' ? 'text-cyan-300' : 'text-amber-300'
                        }`}
                      >
                        Site {item.slot}: {cleanSiteName(item.site.name)}
                      </span>
                      <span className="font-mono tabular-nums text-xs text-slate-200">
                        {item.score.toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {item.site.region}, {item.site.country} · Focuses on{' '}
                      {item.domains.join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* 3. Section B — Compact Ranked Match Leaderboard */}
      <div className="rounded-lg border border-slate-800 bg-[#0d121c] overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span>Ranked Match Leaderboard · {activeDossier.target.name}</span>
          </div>
          <span className="font-mono tabular-nums text-[10px] text-slate-400">
            Click any row to inspect &amp; fly
          </span>
        </div>

        <div className="divide-y divide-slate-800/70">
          {leaderboard.map((cand) => {
            const active = selectedSiteId === cand.site.id;
            const tier = fitTierLabel(cand.missionFitPct);
            return (
              <button
                key={cand.site.id}
                type="button"
                onClick={() => onSelectSite(activeDossier.target.id, cand.site.id)}
                className={`w-full text-left px-3.5 py-2 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                  active ? 'bg-cyan-500/12' : 'hover:bg-slate-800/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-[11px] font-semibold text-cyan-400 w-6 shrink-0">
                      #{cand.rank}
                    </span>
                    <span className="text-xs font-medium text-slate-100 truncate">
                      {cleanSiteName(cand.site.name)}
                    </span>
                  </div>
                  <div className="pl-8 text-[10px] text-slate-400 truncate">
                    {cand.site.country} · {sourceSummaryLabel(cand)}
                  </div>
                </div>

                <div className="w-28 shrink-0 text-right space-y-1">
                  <div className="flex items-center justify-end gap-1.5 font-mono tabular-nums text-xs">
                    <span className={tier.colorClass}>
                      {cand.missionFitPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{
                        width: `${Math.max(6, Math.min(100, cand.missionFitPct))}%`,
                      }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Section C — Plain-English Candidate Detail Cards */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-0.5">
          Plain-English Site Reports (Top {Math.min(cardsToShow.length, 15)})
        </div>

        {cardsToShow.map((cand) => (
          <GuidedDetailCard
            key={cand.site.id}
            candidate={cand}
            durationDays={durationDays}
            isSelected={selectedSiteId === cand.site.id}
            scrollNonce={scrollNonce}
            onSelect={() => onSelectSite(activeDossier.target.id, cand.site.id)}
          />
        ))}
      </div>
    </div>
  );
}
