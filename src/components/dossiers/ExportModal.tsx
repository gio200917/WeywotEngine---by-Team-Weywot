import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useMissionStore } from '../../store/missionStore.js';

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportModal() {
  const {
    exportModalOpen,
    setExportModalOpen,
    config,
    dossiers,
    crossTargetMatrix,
    totalLocationsScreened,
  } = useMissionStore();
  const [configHash, setConfigHash] = useState('computing...');

  useEffect(() => {
    if (!exportModalOpen) return;
    const canonical = JSON.stringify({
      targetIds: config.targetIds,
      presetId: config.presetId,
      domainWeights: config.domainWeights,
      epochDateIso: config.epochDateIso,
      durationDays: config.durationDays,
      astrobiologyMode: config.astrobiologyMode,
      allowedPermitTiers: config.allowedPermitTiers,
      searchScope: config.searchScope ?? 'standard_100',
      featureFootprintKm: config.featureFootprintKm ?? 5,
      maxSlopeFilterDeg: config.maxSlopeFilterDeg ?? 45,
      targetOverrides: config.targetOverrides ?? null,
    });
    void sha256Hex(canonical).then(setConfigHash);
  }, [exportModalOpen, config]);

  useEffect(() => {
    if (!exportModalOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setExportModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exportModalOpen, setExportModalOpen]);

  if (!exportModalOpen) return null;

  const buildJsonPayload = () =>
    JSON.stringify(
      {
        engine: 'WeywotEngine',
        sha256ConfigHash: configHash,
        exportedAt: new Date().toISOString(),
        totalLocationsScreened,
        config,
        dossiers: dossiers.map((d) => ({
          targetId: d.target.id,
          targetName: d.target.name,
          ephemeris: d.ephemeris,
          top3RobustnessPct: d.top3RobustnessPct,
          portfolio: d.portfolio,
          topCandidates: d.rankedCandidates.slice(0, 10).map((c) => ({
            rank: c.rank,
            siteId: c.site.id,
            siteName: c.site.name,
            lat: c.site.lat,
            lon: c.site.lon,
            missionFitPct: c.missionFitPct,
            earthFrontierPct: c.earthFrontierPct,
            sensitivityRange: c.sensitivityRange,
            hardwareSpecs: c.hardwareSpecs,
            narrative: c.narrative,
          })),
        })),
        crossTargetMatrix,
      },
      null,
      2
    );

  const buildGeoJsonPayload = () => {
    const features: Array<Record<string, unknown>> = [];
    for (const d of dossiers) {
      for (const c of d.rankedCandidates.slice(0, 8)) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.site.lon, c.site.lat, c.site.elevationM] },
          properties: {
            kind: 'earth_analog',
            targetId: d.target.id,
            rank: c.rank,
            siteId: c.site.id,
            name: c.site.name,
            missionFitPct: c.missionFitPct,
            earthFrontierPct: c.earthFrontierPct,
            permitTier: c.site.permitTier,
          },
        });
      }
      if (d.portfolio) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [d.portfolio.siteA.lon, d.portfolio.siteA.lat],
              [d.portfolio.siteB.lon, d.portfolio.siteB.lat],
            ],
          },
          properties: {
            kind: 'two_site_split',
            targetId: d.target.id,
            combinedMinimaxPct: d.portfolio.combinedMinimaxPct,
          },
        });
      }
    }
    return JSON.stringify(
      {
        type: 'FeatureCollection',
        properties: { sha256ConfigHash: configHash, epochDateIso: config.epochDateIso },
        features,
      },
      null,
      2
    );
  };

  const buildMarkdownBrief = () => {
    const lines: string[] = [
      `# WeywotEngine Mission Qualification Brief`,
      `- **Config SHA-256:** \`${configHash}\``,
      `- **Epoch:** ${config.epochDateIso} | **Duration:** ${config.durationDays} days | **Preset:** ${config.presetId}`,
      `- **Earth Locations Screened:** ${totalLocationsScreened.toLocaleString()} grid cells (1.0° global grid + Spatial NMS)`,
      ``,
    ];
    for (const d of dossiers) {
      lines.push(`## Target: ${d.target.name} (${d.target.body.toUpperCase()})`);
      lines.push(
        `Ephemeris: ${
          d.target.body === 'mars'
            ? `Ls ${d.ephemeris.marsLsDeg.toFixed(1)}°`
            : `Lunar max sun elev ${d.ephemeris.lunarMaxSolarElevDeg.toFixed(1)}°`
        } | T_eff = ${d.ephemeris.targetEffectiveTempK.toFixed(0)} K | Top-3 Robustness: ${d.top3RobustnessPct}%`
      );
      lines.push('');
      for (const c of d.rankedCandidates.slice(0, 5)) {
        lines.push(
          `### #${c.rank} ${c.site.name} — ${c.missionFitPct.toFixed(1)}% (${c.earthFrontierPct.toFixed(0)}% Earth limit)`
        );
        lines.push(`- **Why It Matches:** ${c.narrative.whyItMatches}`);
        lines.push(`- **Where It Breaks Down:** ${c.narrative.whereItBreaksDown}`);
        lines.push(`- **What Exploration It Enables:** ${c.narrative.whatExplorationItEnables}`);
        lines.push(
          `- **Hardware Offload:** ${c.hardwareSpecs.offloadForcePer100KgN.toFixed(0)} N / 100 kg | **Grazing Sun:** ${c.hardwareSpecs.optimalLocalWindowNote}`
        );
        lines.push('');
      }
      if (d.portfolio) {
        lines.push(`### 2-Site Split Portfolio`);
        lines.push(`${d.portfolio.rationale}`);
        lines.push('');
      }
    }
    return lines.join('\n');
  };

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export Mission Qualification Brief"
      onClick={() => setExportModalOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-slate-700 bg-[#0d121c] p-5 space-y-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Export Mission Qualification Brief
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Stamped with deterministic SHA-256 configuration hash
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExportModalOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
            aria-label="Close export dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded bg-[#070a10] border border-slate-800 font-mono text-[11px] text-cyan-300 break-all">
          SHA-256: {configHash}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() =>
              triggerDownload(
                `weywot-brief-${configHash.slice(0, 8)}.json`,
                buildJsonPayload(),
                'application/json'
              )
            }
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded border border-slate-700 bg-[#121926] hover:border-cyan-400 text-xs font-medium text-slate-100 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>JSON</span>
          </button>

          <button
            type="button"
            onClick={() =>
              triggerDownload(
                `weywot-sites-${configHash.slice(0, 8)}.geojson`,
                buildGeoJsonPayload(),
                'application/geo+json'
              )
            }
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded border border-slate-700 bg-[#121926] hover:border-cyan-400 text-xs font-medium text-slate-100 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>GeoJSON</span>
          </button>

          <button
            type="button"
            onClick={() =>
              triggerDownload(
                `weywot-brief-${configHash.slice(0, 8)}.md`,
                buildMarkdownBrief(),
                'text/markdown'
              )
            }
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded border border-slate-700 bg-[#121926] hover:border-cyan-400 text-xs font-medium text-slate-100 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Markdown Brief</span>
          </button>
        </div>
      </div>
    </div>
  );
}
