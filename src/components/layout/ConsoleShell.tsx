import { useState } from 'react';
import { Download, Eye, SlidersHorizontal } from 'lucide-react';
import { useMissionStore } from '../../store/missionStore.js';
import { MissionConfigPanel } from '../config/MissionConfigPanel.js';
import { ExportModal } from '../dossiers/ExportModal.js';
import { TargetDossierTabs } from '../dossiers/TargetDossierTabs.js';
import { SpatialViewport } from '../viewport/SpatialViewport.js';

export function ConsoleShell() {
  const {
    viewComplexity,
    setViewComplexity,
    guidedStep,
    totalLocationsScreened,
    setExportModalOpen,
    config,
  } = useMissionStore();

  const [mobilePane, setMobilePane] = useState<'setup' | 'viewport' | 'results'>('setup');

  const isGuided = viewComplexity === 'guided';
  const showDossierColumn = !isGuided || (guidedStep === 'review' && config.targetIds.length > 0);
  const effectiveMobilePane =
    mobilePane === 'results' && !showDossierColumn ? 'setup' : mobilePane;

  return (
    <div className="h-screen flex flex-col bg-[#07090e] text-slate-100 overflow-hidden">
      {/* Top Flight Console Header */}
      <header className="px-4 py-2 border-b border-slate-800 bg-[#0d121c] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <h1 className="sr-only">WeywotEngine</h1>
          <img
            src="/assets/aistudio/Screenshot_2026-11-15_152238_6815e9e2.png"
            alt="WeywotEngine"
            className="h-6 sm:h-7 w-auto object-contain select-none mix-blend-lighten brightness-110 contrast-110 shrink-0"
          />
          <span className="hidden sm:inline-block h-4 w-px bg-slate-800 shrink-0" aria-hidden="true" />
          <p className="hidden sm:block text-[11px] text-slate-400 font-mono whitespace-nowrap truncate">
            Planetary Mission Qualification &amp; Analog Console
          </p>
        </div>

        {/* Center Status: Guided Breadcrumb vs Expert Global Stats */}
        {isGuided ? (
          <div className="hidden md:flex items-center gap-2 text-[11px] font-medium">
            <span className={guidedStep === 'goal' ? 'text-cyan-300 font-semibold' : 'text-slate-500'}>
              1. Goal
            </span>
            <span className="text-slate-600">→</span>
            <span className={guidedStep === 'target' ? 'text-cyan-300 font-semibold' : 'text-slate-500'}>
              2. Target
            </span>
            <span className="text-slate-600">→</span>
            <span className={guidedStep === 'review' ? 'text-emerald-300 font-semibold' : 'text-slate-500'}>
              3. Earth Sites
            </span>
          </div>
        ) : (
          <div className="hidden md:flex items-center text-[11px] font-mono tabular-nums text-slate-400">
            <span className="text-slate-200">{totalLocationsScreened.toLocaleString()}</span>
            <span className="ml-1">Earth grid cells · Spatial NMS + Live NASA/DEM</span>
          </div>
        )}

        {/* Right Controls: Guided / Expert Mode + Export */}
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Console Complexity Mode"
            className="inline-flex rounded border border-slate-700 bg-[#070a10] p-0.5"
          >
            <button
              type="button"
              onClick={() => setViewComplexity('guided')}
              title="Guided Mode: 3-step mission wizard, plain-English recommendations, and clean ranked leaderboard"
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                viewComplexity === 'guided'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Guided</span>
            </button>
            <button
              type="button"
              onClick={() => setViewComplexity('expert')}
              title="Expert Mode: Continuous sliders & numeric domain weights, permit/slope/Layer-C controls, radar/monthly charts, and physics tables"
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                viewComplexity === 'expert'
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              <span>Expert</span>
            </button>
          </div>

          {(!isGuided || guidedStep === 'review') && (
            <button
              type="button"
              disabled={config.targetIds.length === 0}
              onClick={() => setExportModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1 rounded border border-cyan-500/50 bg-cyan-500/15 hover:bg-cyan-500/25 text-[11px] font-medium text-cyan-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="w-3 h-3" />
              <span>Export Brief</span>
            </button>
          )}
        </div>
      </header>

      {/* Mobile / Tablet View Switcher (< lg) */}
      <nav
        aria-label="Mobile Console View Switcher"
        className="lg:hidden grid grid-cols-3 border-b border-slate-800 bg-[#090d16] shrink-0"
      >
        {(
          [
            { id: 'setup', label: 'Setup', enabled: true },
            { id: 'viewport', label: 'Map / Globe', enabled: true },
            { id: 'results', label: 'Results', enabled: showDossierColumn },
          ] as const
        ).map((tab) => {
          const active = effectiveMobilePane === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={!tab.enabled}
              onClick={() => setMobilePane(tab.id)}
              className={`py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                active
                  ? 'border-cyan-400 text-cyan-200 bg-[#0d121c]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Step-Gated Console Body: 2-Column in Guided Steps 1 & 2, 3-Column in Step 3 or Expert Mode */}
      <main
        className={`flex-1 min-h-0 grid grid-cols-1 ${
          isGuided
            ? showDossierColumn
              ? 'lg:grid-cols-[300px_minmax(0,1fr)_480px]'
              : 'lg:grid-cols-[410px_minmax(0,1fr)]'
            : 'lg:grid-cols-[360px_minmax(0,1fr)_460px]'
        }`}
      >
        <div
          className={`min-h-0 h-full overflow-hidden ${
            effectiveMobilePane === 'setup' ? 'block' : 'hidden lg:block'
          }`}
        >
          <MissionConfigPanel />
        </div>
        <div
          className={`min-h-0 h-full overflow-hidden ${
            effectiveMobilePane === 'viewport' ? 'block' : 'hidden lg:block'
          }`}
        >
          <SpatialViewport />
        </div>
        {showDossierColumn && (
          <div
            className={`min-h-0 h-full overflow-hidden ${
              effectiveMobilePane === 'results' ? 'block' : 'hidden lg:block'
            }`}
          >
            <TargetDossierTabs />
          </div>
        )}
      </main>

      <ExportModal />
    </div>
  );
}
