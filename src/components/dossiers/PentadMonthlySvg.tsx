import { useState } from 'react';
import type { MonthlyClimatologyBin } from '../../types/planetary.js';

interface PentadMonthlySvgProps {
  monthlyScores: number[];
  monthlyBins: MonthlyClimatologyBin[];
  bestStartDayOfYear: number;
  durationDays: number;
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PentadMonthlySvg({
  monthlyScores,
  monthlyBins,
  bestStartDayOfYear,
  durationDays,
}: PentadMonthlySvgProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const w = 230;
  const h = 118;
  const padL = 24;
  const padR = 10;
  const padT = 14;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xForMonth = (idx: number) => padL + (idx / 11) * plotW;
  const yForScore = (s: number) => padT + (1 - Math.max(0, Math.min(100, s)) / 100) * plotH;

  const points = monthlyScores.map((s, idx) => `${xForMonth(idx).toFixed(1)},${yForScore(s).toFixed(1)}`).join(' ');

  // Optimal window shading in normalized year [0, 1]
  const startFrac = (bestStartDayOfYear - 1) / 365;
  const durFrac = Math.min(1, durationDays / 365);
  const winX = padL + startFrac * plotW;
  const winW = durFrac * plotW;
  const overflowW = Math.max(0, winX + winW - (padL + plotW));
  const mainW = Math.max(4, winW - overflowW);

  const activeHover = hoverIdx !== null ? hoverIdx : null;

  return (
    <div className="flex flex-col">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full max-w-[240px] h-auto select-none"
        role="img"
        aria-label="12-month analog fidelity and storm risk curve"
      >
        {/* Horizontal gridlines */}
        {[0, 50, 100].map((v) => {
          const y = yForScore(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#1e293b" strokeWidth={0.8} />
              <text
                x={padL - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500 font-mono text-[8px]"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Optimal deployment window band */}
        <rect
          x={winX}
          y={padT}
          width={mainW}
          height={plotH}
          fill="rgba(6, 182, 212, 0.16)"
          stroke="rgba(6, 182, 212, 0.45)"
          strokeWidth={0.7}
        />
        {overflowW > 0 && (
          <rect
            x={padL}
            y={padT}
            width={overflowW}
            height={plotH}
            fill="rgba(6, 182, 212, 0.16)"
            stroke="rgba(6, 182, 212, 0.45)"
            strokeWidth={0.7}
          />
        )}

        {/* Fidelity curve */}
        <polyline
          fill="none"
          stroke="#22d3ee"
          strokeWidth={1.8}
          points={points}
        />

        {/* Month points & rain risk markers */}
        {monthlyScores.map((s, idx) => {
          const cx = xForMonth(idx);
          const cy = yForScore(s);
          const bin = monthlyBins[idx];
          const highRainRisk = (bin?.pPrecipGt5Mm ?? 0) > 0.12;
          return (
            <g key={idx}>
              <circle
                cx={cx}
                cy={cy}
                r={activeHover === idx ? 3.8 : 2.3}
                fill={highRainRisk ? '#f59e0b' : '#22d3ee'}
                stroke="#07090e"
                strokeWidth={0.9}
              />
              {highRainRisk && (
                <circle
                  cx={cx}
                  cy={padT + plotH + 4}
                  r={2}
                  fill="#ef4444"
                />
              )}
              <text
                x={cx}
                y={h - 4}
                textAnchor="middle"
                className="fill-slate-400 font-mono text-[8px]"
              >
                {MONTH_LABELS[idx]}
              </text>
              <rect
                x={cx - 8}
                y={padT}
                width={16}
                height={plotH + 14}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-0.5 px-1">
        {activeHover !== null ? (
          <span className="text-cyan-300 tabular-nums">
            {MONTH_NAMES[activeHover]}: {monthlyScores[activeHover].toFixed(1)}% ·{' '}
            {monthlyBins[activeHover]?.tMeanK.toFixed(0)} K · Wet{' '}
            {((monthlyBins[activeHover]?.pPrecipGt5Mm ?? 0) * 100).toFixed(0)}%
          </span>
        ) : (
          <span className="tabular-nums">
            Best window: DOY {bestStartDayOfYear} ({durationDays}d)
          </span>
        )}
        <span className="text-red-400/90">● Rain &gt;12%</span>
      </div>
    </div>
  );
}
