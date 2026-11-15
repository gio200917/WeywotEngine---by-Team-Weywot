import type { DomainKey, DomainScoreDetail } from '../../types/planetary.js';

interface DomainRadarSvgProps {
  candidateDomains: Record<DomainKey, DomainScoreDetail>;
  candidateName: string;
}

const AXES: Array<{ key: DomainKey; label: string }> = [
  { key: 'geochemistry', label: 'GEO' },
  { key: 'morphology', label: 'MORPH' },
  { key: 'thermal', label: 'THERM' },
  { key: 'atmospheric', label: 'ATM' },
  { key: 'operations', label: 'OPS' },
];

export function DomainRadarSvg({
  candidateDomains,
  candidateName,
}: DomainRadarSvgProps) {
  const size = 210;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const maxR = 68;

  const pointAt = (idx: number, pct: number) => {
    const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / AXES.length;
    const r = (Math.max(0, Math.min(100, pct)) / 100) * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  const buildPoly = (values: number[]) =>
    values
      .map((v, idx) => {
        const pt = pointAt(idx, v);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      })
      .join(' ');

  const rings = [25, 50, 75, 100];
  const candValues = AXES.map((a) => candidateDomains[a.key].scorePct);

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-[210px] h-auto select-none"
        role="img"
        aria-label={`5-Axis Domain Fidelity Radar for ${candidateName}`}
      >
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={buildPoly(AXES.map(() => ring))}
            fill="none"
            stroke={ring === 100 ? '#f59e0b' : '#1e293b'}
            strokeWidth={ring === 100 ? 1 : 0.8}
            strokeDasharray={ring === 100 ? '3 3' : undefined}
            strokeOpacity={ring === 100 ? 0.45 : 0.9}
          />
        ))}

        {AXES.map((axis, idx) => {
          const outer = pointAt(idx, 100);
          const lbl = pointAt(idx, 124);
          const score = candValues[idx];
          return (
            <g key={axis.key}>
              <line
                x1={cx}
                y1={cy}
                x2={outer.x}
                y2={outer.y}
                stroke="#1e293b"
                strokeWidth={0.9}
              />
              <text
                x={lbl.x}
                y={lbl.y - 3}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-400 font-mono text-[8.5px]"
              >
                {axis.label}
              </text>
              <text
                x={lbl.x}
                y={lbl.y + 7}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-cyan-300 font-mono text-[8.5px] font-medium"
              >
                {score.toFixed(0)}%
              </text>
            </g>
          );
        })}

        <polygon
          points={buildPoly(candValues)}
          fill="rgba(6, 182, 212, 0.20)"
          stroke="#06b6d4"
          strokeWidth={1.8}
        />

        {candValues.map((v, idx) => {
          const pt = pointAt(idx, v);
          return (
            <circle
              key={AXES[idx].key}
              cx={pt.x}
              cy={pt.y}
              r={2.5}
              fill="#22d3ee"
              stroke="#07090e"
              strokeWidth={1}
            />
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] font-mono text-slate-400 mt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5 bg-cyan-400" />
          <span>{candidateName.split(' ')[0]}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5 border-t border-dashed border-amber-400" />
          <span>Target 100%</span>
        </span>
      </div>
    </div>
  );
}
