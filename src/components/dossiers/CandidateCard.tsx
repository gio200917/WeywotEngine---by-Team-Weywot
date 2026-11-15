import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Database, ShieldAlert, Wrench } from 'lucide-react';
import type { ViewComplexity } from '../../store/missionStore.js';
import type { CandidateEvaluation, DomainKey } from '../../types/planetary.js';
import { DataLineageDrawer } from './DataLineageDrawer.js';
import { DomainRadarSvg } from './DomainRadarSvg.js';
import { PentadMonthlySvg } from './PentadMonthlySvg.js';

interface CandidateCardProps {
  candidate: CandidateEvaluation;
  durationDays: number;
  viewComplexity: ViewComplexity;
  isSelected: boolean;
  scrollNonce: number;
  onSelect: () => void;
}

const DOMAIN_ORDER: DomainKey[] = [
  'geochemistry',
  'morphology',
  'thermal',
  'atmospheric',
  'operations',
];

const PERMIT_LABELS: Record<string, string> = {
  open_public: 'Open Public Access',
  regulated_research: 'Regulated Research Permit',
  protected_park: 'Protected Park Permit',
  polar_expedition: 'Polar Expedition Logistics',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatBestWindow(dayOfYear: number, durationDays: number): string {
  const idx = Math.max(0, Math.min(11, Math.floor(((dayOfYear - 1) % 365) / 30.4375)));
  return `${MONTH_NAMES[idx]} (${durationDays} d campaign)`;
}

function fitTierLabel(score: number): string {
  if (score >= 78) return 'Strong Analog';
  if (score >= 65) return 'Viable Analog';
  return 'Partial Analog';
}

export function CandidateCard({
  candidate,
  durationDays,
  viewComplexity,
  isSelected,
  scrollNonce,
  onSelect,
}: CandidateCardProps) {
  const [lineageOpen, setLineageOpen] = useState(false);
  const [localExpertOpen, setLocalExpertOpen] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const lastHandledNonceRef = useRef<number>(0);

  const isExpert = viewComplexity === 'expert';
  const showExpertDetails = isExpert || localExpertOpen;
  const { site, hardwareSpecs, narrative } = candidate;
  const cleanName = site.name.replace(/\s*\(Visual Anti-Analog\)/i, '');

  useEffect(() => {
    if (!isSelected) return;
    if (scrollNonce > 0 && scrollNonce !== lastHandledNonceRef.current) {
      lastHandledNonceRef.current = scrollNonce;
      setLocalExpertOpen(true);
      setLineageOpen(true);
      articleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected, scrollNonce]);

  const verificationLabel =
    site.liveStatus === 'verified'
      ? 'Live NASA POWER & DEM Verified'
      : site.liveStatus === 'partial'
        ? 'Partial Live NASA/DEM'
        : site.provenanceTier === 'tier2_live_probe'
          ? 'Live Tier-2 Probe'
          : site.provenanceTier === 'tier2_best_effort_fallback'
            ? 'Tier-2 Fallback Prior'
            : 'Global 1° Grid';

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
      {/* Card Header */}
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left p-4 cursor-pointer flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono tabular-nums text-xs font-semibold text-cyan-400">
              #{candidate.rank}
            </span>
            <h3 className="text-sm font-semibold text-slate-100 truncate">
              {cleanName}
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {site.region}, {site.country} · {PERMIT_LABELS[site.permitTier] ?? site.permitTier}
          </p>
          <p className="text-[11px] font-mono text-emerald-300/90 mt-0.5 truncate">
            {verificationLabel}
          </p>
        </div>

        <div className="text-right shrink-0">
          <div className="font-mono tabular-nums text-xl font-semibold text-cyan-300 leading-none">
            {candidate.missionFitPct.toFixed(1)}
            <span className="text-xs text-slate-400 ml-0.5">%</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            {isExpert
              ? `${candidate.earthFrontierPct.toFixed(0)}% Earth limit`
              : fitTierLabel(candidate.missionFitPct)}
          </div>
        </div>
      </button>

      {/* Expert Mode Quantitative Telemetry Strip */}
      {showExpertDetails && (
        <div className="px-4 pb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums text-slate-400 border-b border-slate-800/80">
          <span>
            Process: {candidate.processEval.classification} ({candidate.processEval.similarityPct.toFixed(0)}%)
          </span>
          {candidate.rank <= 5 && (
            <span>
              ±15% Range: {candidate.sensitivityRange[0].toFixed(1)}–{candidate.sensitivityRange[1].toFixed(1)}%
            </span>
          )}
          {candidate.voidEval.active && (
            <span className="text-amber-300">
              Void: {candidate.voidEval.scorePct.toFixed(0)}% ({candidate.voidEval.voidTypeMatch})
            </span>
          )}
          {candidate.isruEval.active && (
            <span className="text-emerald-300">
              ISRU: {candidate.isruEval.scorePct.toFixed(0)}% (DTE {candidate.isruEval.dteCommsPct.toFixed(0)}%)
            </span>
          )}
        </div>
      )}

      {/* 3-Part Scientific Exploration Narrative */}
      <div className="px-4 pb-3 pt-2 space-y-2 text-xs leading-relaxed border-t border-slate-800/60">
        <div>
          <span className="font-semibold text-cyan-300">Why It Matches: </span>
          <span className="text-slate-200">{narrative.whyItMatches}</span>
        </div>
        <div>
          <span className="font-semibold text-amber-300">Where It Breaks Down: </span>
          <span className="text-slate-300">{narrative.whereItBreaksDown}</span>
        </div>
        <div>
          <span className="font-semibold text-emerald-300">What Exploration It Enables: </span>
          <span className="text-slate-300">{narrative.whatExplorationItEnables}</span>
        </div>
      </div>

      {/* Quick Campaign Summary vs Expert Dual Charts */}
      {!showExpertDetails ? (
        <div className="px-4 py-2.5 bg-[#090d14] border-t border-slate-800/80 space-y-1.5 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300 font-mono tabular-nums">
            <span>Best Window: {formatBestWindow(candidate.bestStartDayOfYear, durationDays)}</span>
            <span className="text-amber-300">
              Offload: {hardwareSpecs.offloadForcePer100KgN.toFixed(0)} N/100kg
            </span>
          </div>
          <p className="text-slate-400">
            <span className="text-emerald-400 font-medium">Earth Co-Benefit: </span>
            {site.earthCoBenefits}
          </p>
        </div>
      ) : (
        <>
          {/* Dual Visualizations: 5-Axis Radar + 12-Month Window Curve */}
          <div className="px-4 pb-4 grid grid-cols-2 gap-3 items-center border-t border-slate-800/80 pt-3">
            <DomainRadarSvg
              candidateDomains={candidate.domainScores}
              candidateName={cleanName}
            />
            <PentadMonthlySvg
              monthlyScores={candidate.monthlyScores}
              monthlyBins={site.monthly}
              bestStartDayOfYear={candidate.bestStartDayOfYear}
              durationDays={durationDays}
            />
          </div>

          {/* Hardware Compensation & Earth Co-Benefits */}
          <div className="px-4 py-3 bg-[#090d14] border-t border-slate-800/80 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-slate-200">
              <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Hardware Compensation Checklist</span>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px] text-slate-300">
              <div>
                Gravity Offload: <span className="text-amber-300">{hardwareSpecs.offloadForcePer100KgN.toFixed(0)} N / 100 kg</span>
              </div>
              <div>
                UV-C Chamber: <span className={hardwareSpecs.requiresUvCChamber ? 'text-amber-300' : 'text-slate-400'}>
                  {hardwareSpecs.requiresUvCChamber ? `Required (${hardwareSpecs.targetUvCFluxWm2.toFixed(1)} W/m²)` : 'Cryo/GCR TVAC'}
                </span>
              </div>
              <div className="col-span-2 text-slate-400">
                Grazing Sun: {hardwareSpecs.optimalLocalWindowNote}
              </div>
            </div>
            <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
              <span className="text-emerald-400 font-medium">Earth Co-Benefit: </span>
              {site.earthCoBenefits}
            </p>
          </div>
        </>
      )}

      {/* Action Footer: Live NASA Lineage + Inspect Charts & Physics Toggle */}
      <div className="px-4 py-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={() => setLineageOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Database className="w-3.5 h-3.5" />
          <span>Data Lineage</span>
          {lineageOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {!isExpert && (
          <button
            type="button"
            onClick={() => setLocalExpertOpen((v) => !v)}
            className="text-slate-400 hover:text-slate-200 font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {localExpertOpen ? 'Hide Charts & Physics' : 'Charts & Physics'}
          </button>
        )}
      </div>

      {/* Expandable Live NASA Data Lineage Drawer */}
      {lineageOpen && (
        <DataLineageDrawer
          provenanceTier={site.provenanceTier}
          dataLineage={site.dataLineage}
          citations={site.citations}
        />
      )}

      {/* Expert Physics & Deficit Drawer */}
      {showExpertDetails && (
        <div className="px-4 pb-4 pt-3 border-t border-slate-800 bg-[#070a10] space-y-3 text-[11px]">
          <div className="font-mono text-slate-300 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
            <span>Window Mean: {candidate.baseWindowMeanPct.toFixed(1)}%</span>
            <span>Drift P_drift: -{candidate.downsideDriftPenalty.toFixed(2)}%</span>
            <span>Rain Cliff: -{candidate.rainCliffPenalty.toFixed(2)}% (P={((candidate.rainExceedanceProb) * 100).toFixed(1)}%)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono tabular-nums text-[11px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-1 pr-2">Domain</th>
                  <th className="py-1 px-2">Score</th>
                  <th className="py-1 px-2">Frontier</th>
                  <th className="py-1 px-2">d²</th>
                  <th className="py-1 pl-2">p_eff (dims)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {DOMAIN_ORDER.map((k) => {
                  const ds = candidate.domainScores[k];
                  return (
                    <tr key={k}>
                      <td className="py-1 pr-2 capitalize">{k}</td>
                      <td className="py-1 px-2 text-cyan-300">{ds.scorePct.toFixed(1)}%</td>
                      <td className="py-1 px-2">{ds.frontierPct.toFixed(0)}%</td>
                      <td className="py-1 px-2">{ds.distanceSq.toFixed(2)}</td>
                      <td className="py-1 pl-2">{ds.pEff.toFixed(2)} ({ds.observedDims})</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {candidate.deficits.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5 text-amber-300 font-medium">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Unreplicated Deficits &amp; Mitigation</span>
              </div>
              <div className="divide-y divide-slate-800/70">
                {candidate.deficits.map((def) => (
                  <div key={def.id} className="py-1.5 first:pt-0 last:pb-0">
                    <div className="font-medium text-slate-200">{def.label}</div>
                    <div className="text-slate-400 mt-0.5">{def.detail}</div>
                    <div className="text-cyan-300/90 mt-0.5 font-mono text-[10px]">
                      Spec: {def.compensationSpec}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
