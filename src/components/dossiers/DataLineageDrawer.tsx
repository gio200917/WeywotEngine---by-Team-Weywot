import type { DataLineageItem, ProvenanceTier } from '../../types/planetary.js';

interface DataLineageDrawerProps {
  provenanceTier: ProvenanceTier;
  dataLineage: DataLineageItem[];
  citations: string[];
}

const PROVENANCE_LABEL: Record<ProvenanceTier, { label: string; colorClass: string }> = {
  tier1_literature_plus_nasa: {
    label: 'Tier-1 Literature · NASA POWER',
    colorClass: 'text-cyan-300',
  },
  tier2_live_probe: {
    label: 'Tier-2 Live NASA · Terrarium DEM',
    colorClass: 'text-emerald-300',
  },
  tier2_best_effort_fallback: {
    label: 'Tier-2 Probe (Fallback Priors Active)',
    colorClass: 'text-amber-300',
  },
  global_screening_1deg: {
    label: 'Global 1.0° Screening Grid',
    colorClass: 'text-slate-300',
  },
};

export function DataLineageDrawer({
  provenanceTier,
  dataLineage,
  citations,
}: DataLineageDrawerProps) {
  const prov = PROVENANCE_LABEL[provenanceTier] ?? PROVENANCE_LABEL.global_screening_1deg;

  return (
    <div className="px-4 pb-3 pt-2.5 border-t border-slate-800/80 bg-[#080b11] space-y-2.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">
          Verified Data Provenance
        </span>
        <span className={`font-mono text-[10px] ${prov.colorClass}`}>
          {prov.label}
        </span>
      </div>

      <div className="divide-y divide-slate-800/70">
        {dataLineage.map((item, idx) => (
          <div key={idx} className="flex flex-col py-1.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2 text-slate-200 font-medium">
              <span className="truncate">
                <span className="font-mono capitalize text-[10px] text-cyan-400 mr-1.5">
                  {item.domain} ·
                </span>
                {item.source}
              </span>
              <span className="font-mono text-[10px] text-slate-500 shrink-0">
                {item.resolutionOrPeriod}
              </span>
            </div>
            <span className="text-slate-400">{item.detail}</span>
          </div>
        ))}
      </div>

      {citations.length > 0 && (
        <div className="pt-1.5 border-t border-slate-800/60 text-[10px] font-mono text-slate-500 space-y-0.5">
          {citations.map((c, i) => (
            <div key={i}>{c}</div>
          ))}
        </div>
      )}
    </div>
  );
}
