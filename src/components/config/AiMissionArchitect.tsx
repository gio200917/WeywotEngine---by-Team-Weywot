import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Layers,
  Loader2,
  MapPin,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useMissionStore } from '../../store/missionStore.js';
import type { DomainKey } from '../../types/planetary.js';

const DOMAIN_SHORT: Array<{ key: DomainKey; label: string }> = [
  { key: 'geochemistry', label: 'Geo' },
  { key: 'morphology', label: 'Morph' },
  { key: 'thermal', label: 'Therm' },
  { key: 'atmospheric', label: 'Atm' },
  { key: 'operations', label: 'Ops' },
];

const EXAMPLE_PROMPTS = [
  {
    label: 'South Pole Ice + Power + Lava Tube',
    text: 'Artemis lunar south pole campaign combining cryogenic water-ice drilling in Shackleton PSR, a sunlit solar power and DTE communications relay ridge on Malapert Massif, and Mare Tranquillitatis lava tube radiation shelter reconnaissance.',
  },
  {
    label: 'Mars Biosignatures + Scarp Rover',
    text: 'Dual-phase Mars campaign: Jezero Crater paleolake clay biosignature sampling with high geochemistry priority, plus steep volcanic scarp rover traction testing on Olympus Mons.',
  },
];

interface AiMissionArchitectProps {
  onPlanReady?: () => void;
  defaultExpanded?: boolean;
}

export function AiMissionArchitect({
  onPlanReady,
  defaultExpanded = true,
}: AiMissionArchitectProps = {}) {
  const {
    aiMissionDesign,
    aiDesignLoading,
    aiDesignError,
    designMissionWithAi,
    focusAiComponent,
    clearAiDesign,
    setActiveTargetTabId,
    setBodyFocus,
    activeTargetTabId,
    viewComplexity,
  } = useMissionStore();

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [promptInput, setPromptInput] = useState('');
  const [answersByQId, setAnswersByQId] = useState<Record<string, string>>({});

  const handleRunArchitect = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    setAnswersByQId({});
    await designMissionWithAi(promptInput, undefined, { resetHistory: true });
  };

  const handleSubmitClarifications = async () => {
    if (!aiMissionDesign) return;
    const answers = aiMissionDesign.followUpQuestions
      .map((q) => ({
        question: q.question,
        answer: (answersByQId[q.id] ?? '').trim(),
      }))
      .filter((a) => a.answer.length > 0);

    if (answers.length === 0) return;
    setAnswersByQId({});
    await designMissionWithAi(promptInput, answers, { resetHistory: false });
  };

  const allClarificationsAnswered =
    aiMissionDesign?.status === 'needs_clarification' &&
    aiMissionDesign.followUpQuestions.every(
      (q) => (answersByQId[q.id] ?? '').trim().length > 0
    );

  return (
    <section className="space-y-2 pb-2 border-b border-slate-800/80">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-300 hover:text-cyan-200 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>AI Mission Architect</span>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>

        {aiMissionDesign && (
          <button
            type="button"
            onClick={() => {
              clearAiDesign();
              setAnswersByQId({});
            }}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2">
          <form onSubmit={(e) => void handleRunArchitect(e)} className="space-y-2">
            <textarea
              rows={3}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder="Describe your mission goals, hardware, or multi-phase campaign. Complex missions are split across locations automatically."
              className="w-full p-2 rounded border border-slate-700 bg-[#0d121c] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 leading-relaxed"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-500">Examples:</span>
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setPromptInput(ex.text)}
                  className="text-[10px] text-cyan-300/90 hover:text-cyan-200 underline underline-offset-2 cursor-pointer text-left"
                >
                  {ex.label}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={aiDesignLoading || promptInput.trim().length === 0}
              className="w-full py-1.5 px-3 rounded border border-cyan-500/60 bg-cyan-500/15 hover:bg-cyan-500/25 text-xs font-medium text-cyan-200 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              {aiDesignLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                {aiDesignLoading
                  ? 'Designing Preset & Mission Components...'
                  : 'Generate Preset & Mission Plan'}
              </span>
            </button>
          </form>

          {aiDesignError && (
            <div className="p-2.5 rounded border border-red-500/50 bg-red-950/30 text-[11px] text-red-200 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <span>{aiDesignError}</span>
            </div>
          )}

          {/* Ambiguity Follow-Up Questions (shown ONLY when clarification is needed) */}
          {aiMissionDesign?.status === 'needs_clarification' &&
            aiMissionDesign.followUpQuestions.length > 0 && (
              <div className="p-2.5 rounded border border-amber-500/50 bg-amber-950/20 space-y-2.5 text-[11px]">
                <div className="flex items-start gap-1.5 text-amber-200 font-medium">
                  <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>Clarification needed before finalizing preset &amp; sites:</span>
                </div>

                <div className="space-y-2.5">
                  {aiMissionDesign.followUpQuestions.map((q) => {
                    const selectedVal = answersByQId[q.id] ?? '';
                    return (
                      <div
                        key={q.id}
                        className="p-2 rounded border border-amber-500/30 bg-[#0d121c] space-y-1.5"
                      >
                        <div className="font-medium text-slate-100">{q.question}</div>
                        {q.reason && (
                          <div className="text-[10px] text-slate-400">{q.reason}</div>
                        )}
                        {q.options.length > 0 && (
                          <div className="space-y-1 pt-0.5">
                            {q.options.map((opt, idx) => {
                              const active = selectedVal === opt.answerValue;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() =>
                                    setAnswersByQId((prev) => ({
                                      ...prev,
                                      [q.id]: opt.answerValue,
                                    }))
                                  }
                                  className={`w-full text-left px-2 py-1 rounded border text-[11px] transition-colors cursor-pointer ${
                                    active
                                      ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                                      : 'border-slate-700 bg-[#070a10] hover:border-amber-500/60 text-slate-300'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <input
                          type="text"
                          value={selectedVal}
                          onChange={(e) =>
                            setAnswersByQId((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          placeholder="Or enter a custom answer..."
                          className="w-full px-2 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={aiDesignLoading || !allClarificationsAnswered}
                  onClick={() => void handleSubmitClarifications()}
                  className="w-full py-1.5 px-3 rounded border border-amber-500/60 bg-amber-500/20 hover:bg-amber-500/30 text-[11px] font-medium text-amber-200 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {aiDesignLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Apply Clarifications &amp; Build Plan</span>
                </button>
              </div>
            )}

          {/* Ready State: Created Custom Preset + Split Components */}
          {aiMissionDesign?.status === 'ready' && (
            <div className="p-2.5 rounded border border-slate-700 bg-[#0d121c] space-y-2 text-[11px]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5 min-w-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100 truncate">
                      {aiMissionDesign.preset.name}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                      {aiMissionDesign.missionSummary}
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[10px] text-slate-500 shrink-0">
                  {aiMissionDesign.source === 'gemini' ? 'Gemini' : 'Local'}
                </span>
              </div>

              <div className="font-mono tabular-nums text-[10px] text-cyan-300 border-t border-slate-800 pt-1.5">
                {DOMAIN_SHORT.map(({ key, label }) => {
                  const pct = Math.round(aiMissionDesign.preset.domainWeights[key] * 100);
                  return `${label} ${pct}%`;
                }).join(' · ')}
              </div>

              {aiMissionDesign.warnings && aiMissionDesign.warnings.length > 0 && (
                <div className="p-2 rounded border border-amber-500/40 bg-amber-950/20 text-[10px] text-amber-200 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    {aiMissionDesign.warnings.map((w, idx) => (
                      <div key={idx}>{w}</div>
                    ))}
                  </div>
                </div>
              )}

              {aiMissionDesign.isMultiComponent &&
                aiMissionDesign.components.length >= 2 && (
                  <div className="space-y-1.5 border-t border-slate-800 pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        <Layers className="w-3 h-3" />
                        <span>
                          Split Into {aiMissionDesign.components.length} Components
                        </span>
                      </span>
                      {viewComplexity === 'expert' && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTargetTabId('portfolio');
                            setBodyFocus('earth');
                          }}
                          className="text-[10px] text-emerald-300 hover:text-emerald-200 underline cursor-pointer whitespace-nowrap shrink-0"
                        >
                          View Earth Split
                        </button>
                      )}
                    </div>

                    {aiMissionDesign.splitRationale && (
                      <p className="text-[10px] text-slate-400 leading-snug">
                        {aiMissionDesign.splitRationale}
                      </p>
                    )}

                    <div className="space-y-1">
                      {aiMissionDesign.components.map((comp, idx) => {
                        const isFocused =
                          Boolean(comp.targetId) && activeTargetTabId === comp.targetId;
                        return (
                          <button
                            key={comp.id}
                            type="button"
                            onClick={() => focusAiComponent(comp)}
                            className={`w-full text-left p-2 rounded border transition-colors cursor-pointer ${
                              isFocused
                                ? 'border-amber-400/70 bg-amber-500/10'
                                : 'border-slate-800 bg-[#070a10] hover:border-slate-600'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-medium text-slate-100 truncate">
                                {idx + 1}. {comp.title}
                              </span>
                              <span className="font-mono tabular-nums text-[10px] text-amber-300 shrink-0 flex items-center gap-1">
                                <MapPin className="w-2.5 h-2.5" />
                                {comp.body.toUpperCase()} {comp.lat.toFixed(1)}°,{' '}
                                {comp.lon.toFixed(1)}°
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">
                              {comp.locationName} · {comp.role}
                            </div>
                            <div className="font-mono tabular-nums text-[10px] text-slate-500 mt-0.5">
                              {DOMAIN_SHORT.map(
                                ({ key, label }) =>
                                  `${label} ${Math.round(comp.domainWeights[key] * 100)}%`
                              ).join(' · ')}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              {onPlanReady && (
                <button
                  type="button"
                  onClick={onPlanReady}
                  className="w-full py-1.5 px-2.5 rounded border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-[11px] font-semibold text-emerald-200 cursor-pointer transition-colors"
                >
                  Open Matching Earth Sites →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
