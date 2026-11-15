import { useMemo, useState } from 'react';
import { optimizeMultiTargetTwoSitePortfolio } from '../../engine/portfolio.js';
import type { ViewComplexity } from '../../store/missionStore.js';
import type {
  DomainKey,
  MultiTargetTwoSitePortfolioResult,
  TargetEvaluationDossier,
} from '../../types/planetary.js';

interface PortfolioBuilderProps {
  dossiers: TargetEvaluationDossier[];
  multiTargetPortfolio?: MultiTargetTwoSitePortfolioResult | null;
  viewComplexity: ViewComplexity;
  onSelectSite: (targetId: string, siteId: string) => void;
}

const DOMAIN_KEYS: DomainKey[] = [
  'geochemistry',
  'morphology',
  'thermal',
  'atmospheric',
  'operations',
];

function cleanSiteName(name: string): string {
  return name.replace(/\s*\(Visual Anti-Analog\)/i, '');
}

export function PortfolioBuilder({
  dossiers,
  multiTargetPortfolio,
  viewComplexity,
  onSelectSite,
}: PortfolioBuilderProps) {
  const [expandedMatrices, setExpandedMatrices] = useState<Record<string, boolean>>({});
  const multiTargetSplit = useMemo(
    () => multiTargetPortfolio ?? optimizeMultiTargetTwoSitePortfolio(dossiers),
    [multiTargetPortfolio, dossiers]
  );

  const toggleMatrix = (targetId: string) => {
    setExpandedMatrices((prev) => ({ ...prev, [targetId]: !prev[targetId] }));
  };

  if (dossiers.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-slate-800 bg-[#0d121c] text-xs text-slate-400">
        Select at least 1 Mars or Moon target to compute 2-site split portfolios.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Joint Multi-Target 2-Site Campaign Split (when 2+ targets selected) */}
      {multiTargetSplit && (
        <div className="p-4 rounded-lg border border-emerald-500/40 bg-[#0c141d] space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                All {multiTargetSplit.targetCount} Selected Targets · Joint Campaign Split
              </div>
              <h3 className="text-sm font-semibold text-slate-100 mt-0.5">
                Combined Minimax 2-Site Earth Campaign
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Maximizes worst-case mission fit across all selected targets without target averaging
              </p>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <div className="text-lg font-semibold text-emerald-400">
                {multiTargetSplit.combinedMinimaxPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-400">
                {multiTargetSplit.gainPct >= 0 ? '+' : ''}
                {multiTargetSplit.gainPct.toFixed(1)}% vs{' '}
                {multiTargetSplit.singleSiteMinimaxPct.toFixed(1)}% single max
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed border-t border-slate-800/80 pt-2.5">
            {multiTargetSplit.rationale}
          </p>

          <div className="grid grid-cols-1 gap-2.5 pt-1">
            {(['A', 'B'] as const).map((slot) => {
              const site = slot === 'A' ? multiTargetSplit.siteA : multiTargetSplit.siteB;
              const covered = multiTargetSplit.assignments.filter(
                (a) => a.assignedSite === slot
              );
              const targetToOpen = covered[0]?.targetId ?? dossiers[0].target.id;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => onSelectSite(targetToOpen, site.id)}
                  className={`text-left p-3 rounded border bg-[#0a1019] transition-colors cursor-pointer ${
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
                      Campaign Site {slot} · {cleanSiteName(site.name)}
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-300 shrink-0">
                      {covered.length} of {multiTargetSplit.targetCount} targets
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {site.region}, {site.country}
                  </div>
                  <div className="text-[11px] font-mono text-slate-300 mt-1.5">
                    {covered.length > 0
                      ? `Leads: ${covered
                          .map((c) => `${c.targetName} (${c.scorePct.toFixed(1)}%)`)
                          .join(' · ')}`
                      : 'Secondary backup coverage across selected targets'}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            <div className="text-[11px] font-medium text-slate-300 mb-1.5">
              Per-Target Campaign Coverage
            </div>
            <table className="w-full text-left font-mono tabular-nums text-[11px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-1">Selected Target</th>
                  <th className="py-1">Assigned</th>
                  <th className="py-1 text-right">Split Fit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {multiTargetSplit.assignments.map((a) => (
                  <tr key={a.targetId}>
                    <td className="py-1 pr-2 truncate max-w-[170px]">{a.targetName}</td>
                    <td
                      className={`py-1 ${
                        a.assignedSite === 'A' ? 'text-cyan-300' : 'text-amber-300'
                      }`}
                    >
                      Site {a.assignedSite}
                    </td>
                    <td className="py-1 text-right text-emerald-300">
                      {a.scorePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Target Non-Negative 2-Site Split Breakdown (For ALL Selected Targets) */}
      {dossiers.map((dossier, idx) => {
        const { portfolio, target } = dossier;
        if (!portfolio) {
          return (
            <div
              key={target.id}
              className="p-4 rounded-lg border border-slate-800 bg-[#0d121c] text-xs text-slate-400"
            >
              <div className="font-semibold text-slate-200 mb-1">
                {target.name} ({target.body.toUpperCase()})
              </div>
              Need at least 2 eligible Earth sites to compute a non-negative 2-site split portfolio.
            </div>
          );
        }

        return (
          <div
            key={target.id}
            className="p-4 rounded-lg border border-slate-800 bg-[#0d121c] space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300">
                  {dossiers.length > 1
                    ? `Target ${idx + 1} of ${dossiers.length} · ${target.body.toUpperCase()}`
                    : `${target.body.toUpperCase()} Target`}
                </div>
                <h3 className="text-sm font-semibold text-slate-100 mt-0.5">
                  Non-Negative 2-Site Split · {target.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {portfolio.triggeredAutomatically
                    ? 'Auto-triggered (single-site max < 72%)'
                    : 'Manual split evaluation'}
                </p>
              </div>
              <div className="text-right font-mono tabular-nums shrink-0">
                <div className="text-lg font-semibold text-emerald-400">
                  {portfolio.combinedMinimaxPct.toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-400">
                  {portfolio.gainPct >= 0 ? '+' : ''}
                  {portfolio.gainPct.toFixed(1)}% vs {portfolio.singleSiteMaxPct.toFixed(1)}% single max
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed border-t border-slate-800/80 pt-2.5">
              {portfolio.rationale}
            </p>

            <div className="grid grid-cols-1 gap-3 pt-1">
              {/* Site A */}
              <button
                type="button"
                onClick={() => onSelectSite(target.id, portfolio.siteA.id)}
                className="text-left p-3 rounded border border-cyan-500/40 bg-[#0a1019] hover:border-cyan-400 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-cyan-300">
                    Site A · {cleanSiteName(portfolio.siteA.name)}
                  </span>
                  <span className="font-mono tabular-nums text-sm font-semibold text-cyan-200">
                    {portfolio.scoreAPct.toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {portfolio.siteA.region}, {portfolio.siteA.country}
                </div>
                <div className="text-[11px] font-mono text-slate-300 mt-2">
                  Assigned domains: {portfolio.allocatedDomainsA.join(' · ')}
                </div>
              </button>

              {/* Site B */}
              <button
                type="button"
                onClick={() => onSelectSite(target.id, portfolio.siteB.id)}
                className="text-left p-3 rounded border border-amber-500/40 bg-[#0a1019] hover:border-amber-400 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-300">
                    Site B · {cleanSiteName(portfolio.siteB.name)}
                  </span>
                  <span className="font-mono tabular-nums text-sm font-semibold text-amber-200">
                    {portfolio.scoreBPct.toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {portfolio.siteB.region}, {portfolio.siteB.country}
                </div>
                <div className="text-[11px] font-mono text-slate-300 mt-2">
                  Assigned domains: {portfolio.allocatedDomainsB.join(' · ')}
                </div>
              </button>
            </div>

            {/* Exact Weight Partition Table (Always shown in Expert, toggleable in Guided) */}
            {(viewComplexity === 'expert' || expandedMatrices[target.id]) ? (
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-300 mb-1.5">
                  <span>Weight Conservation Matrix (w_A + w_B = w_μ)</span>
                  {viewComplexity === 'guided' && (
                    <button
                      type="button"
                      onClick={() => toggleMatrix(target.id)}
                      className="text-slate-400 hover:text-slate-200 font-mono text-[10px] cursor-pointer"
                    >
                      Hide
                    </button>
                  )}
                </div>
                <table className="w-full text-left font-mono tabular-nums text-[11]">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-1">Domain</th>
                      <th className="py-1 text-right">w_A</th>
                      <th className="py-1 text-right">w_B</th>
                      <th className="py-1 text-right">w_μ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {DOMAIN_KEYS.map((k) => (
                      <tr key={k}>
                        <td className="py-1 capitalize">{k}</td>
                        <td className="py-1 text-right text-cyan-300">
                          {portfolio.weightsA[k].toFixed(2)}
                        </td>
                        <td className="py-1 text-right text-amber-300">
                          {portfolio.weightsB[k].toFixed(2)}
                        </td>
                        <td className="py-1 text-right text-slate-400">
                          {(portfolio.weightsA[k] + portfolio.weightsB[k]).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="pt-1.5 border-t border-slate-800/80 flex justify-end">
                <button
                  type="button"
                  onClick={() => toggleMatrix(target.id)}
                  className="text-[11px] font-mono text-slate-400 hover:text-cyan-300 cursor-pointer"
                >
                  Show Weight Partition (w_A + w_B)
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
