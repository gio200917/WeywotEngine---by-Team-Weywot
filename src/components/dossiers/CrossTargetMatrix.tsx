import type { CrossTargetMatrix as CrossTargetMatrixType, CelestialTarget } from '../../types/planetary.js';

interface CrossTargetMatrixProps {
  matrix: CrossTargetMatrixType | null;
  targets: CelestialTarget[];
  onSelectSite: (siteId: string) => void;
}

export function CrossTargetMatrix({
  matrix,
  targets,
  onSelectSite,
}: CrossTargetMatrixProps) {
  if (!matrix || matrix.targetIds.length < 2) {
    return (
      <div className="p-4 rounded-lg border border-slate-800 bg-[#0d121c] text-xs text-slate-400">
        Select 2 or more celestial targets to inspect the non-destructive Cross-Target Comparison Matrix (Harmonic Versatility &amp; Pairwise Rank Dissonance).
      </div>
    );
  }

  const targetNameById = new Map(targets.map((t) => [t.id, t.name]));

  return (
    <div className="p-4 rounded-lg border border-slate-800 bg-[#0d121c] space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Cross-Target Comparison Matrix
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Isolated target scores compared without pooling or arithmetic averaging
          </p>
        </div>
        <div className="text-right font-mono tabular-nums shrink-0">
          <div className="text-xs text-amber-300">
            D_rank = {(matrix.meanPairwiseRankDissonance * 100).toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-500">Pairwise Rank Dissonance</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px] font-mono tabular-nums">
          <thead>
            <tr className="text-slate-400 border-b border-slate-800">
              <th className="py-1.5 pr-2 font-sans">Earth Site</th>
              {matrix.targetIds.map((tid) => (
                <th key={tid} className="py-1.5 px-2 text-right max-w-[90px] truncate">
                  {(targetNameById.get(tid) ?? tid).split(' ').slice(0, 2).join(' ')}
                </th>
              ))}
              <th className="py-1.5 pl-2 text-right text-cyan-300">Harmonic V</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {matrix.rows.slice(0, 14).map((row) => (
              <tr
                key={row.siteId}
                tabIndex={0}
                onClick={() => onSelectSite(row.siteId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSite(row.siteId);
                  }
                }}
                className="hover:bg-slate-800/40 cursor-pointer transition-colors"
              >
                <td className="py-1.5 pr-2 font-sans text-slate-200 truncate max-w-[135px]">
                  {row.siteName.replace(/\s*\(Visual Anti-Analog\)/i, '')}
                </td>
                {matrix.targetIds.map((tid) => {
                  const val = row.scoresByTargetId[tid] ?? 0;
                  return (
                    <td
                      key={tid}
                      className={`py-1.5 px-2 text-right ${
                        val >= 72
                          ? 'text-emerald-300'
                          : val >= 50
                            ? 'text-slate-200'
                            : 'text-slate-500'
                      }`}
                    >
                      {val.toFixed(1)}%
                    </td>
                  );
                })}
                <td className="py-1.5 pl-2 text-right font-semibold text-cyan-300">
                  {row.harmonicVersatilityIndex.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
