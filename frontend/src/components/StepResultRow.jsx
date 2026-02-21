// src/components/StepResultRow.jsx
'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { LatencyValue, ProgressBar, StatusPill, STATUS_LEFT } from './ui';

const NUM_STYLE = {
  passed:  'bg-green/10  text-green  border-green/30',
  failed:  'bg-red/10    text-red    border-red/30',
  slow:    'bg-yellow/10 text-yellow border-yellow/30',
  skipped: 'bg-text3/10  text-text3  border-text3/20',
  running: 'bg-accent/10 text-accent border-accent/30 animate-pulse',
};

export default function StepResultRow({ step, result, position }) {
  const [open,       setOpen]       = useState(false);
  const [showScreen, setShowScreen] = useState(false);

  const status    = result?.status || 'skipped';
  const latencyMs = result?.latency_ms;
  const threshold = step?.threshold_p95_ms || 1000;

  const barPct   = latencyMs ? Math.min(100, (latencyMs / (threshold * 1.5)) * 100) : 0;
  const barColor = status === 'failed' ? '#ff3d54'
    : status === 'slow'   ? '#ffca28'
    : status === 'passed' ? '#00e676'
    : '#3a5060';

  return (
    <>
      {/* Main row */}
      <div
        onClick={() => result?.logs?.length && setOpen(o => !o)}
        className={clsx(
          'flex items-center gap-3 px-4 py-3 bg-bg2 border border-border rounded-lg',
          'border-l-2 transition-all',
          STATUS_LEFT[status] || 'border-l-border',
          status === 'failed'  && 'bg-red/[0.03]',
          result?.logs?.length && 'cursor-pointer hover:border-border2',
        )}
      >
        {/* Step number badge */}
        <div className={clsx(
          'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border font-sans flex-shrink-0',
          NUM_STYLE[status] || NUM_STYLE.skipped
        )}>
          {position}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-[#e0eaf5] font-medium truncate">{step?.name}</div>
          <div className="text-[10px] text-text2 truncate mt-0.5">{step?.description}</div>
          {result?.error && (
            <div className="text-[10px] text-red font-mono mt-1 truncate">⚠ {result.error}</div>
          )}
        </div>

        {/* Latency bar */}
        <div className="w-20 flex-shrink-0">
          <ProgressBar pct={barPct} color={barColor} className="mb-1" />
          <div className="text-[9px] text-text3 text-right">vs p95</div>
        </div>

        {/* Latency number */}
        <div className="w-20 text-right flex-shrink-0">
          <LatencyValue ms={latencyMs} thresholdMs={threshold} />
          <div className="text-[9px] text-text3 mt-0.5">
            &lt; {threshold >= 1000 ? `${(threshold/1000).toFixed(1)}s` : `${threshold}ms`}
          </div>
        </div>

        {/* Screenshot button */}
        {result?.screenshot ? (
          <button
            onClick={e => { e.stopPropagation(); setShowScreen(true); }}
            className="w-7 h-5 flex-shrink-0 bg-border rounded text-[9px] text-text3 hover:border hover:border-accent hover:text-accent transition-all flex items-center justify-center"
            title="View screenshot"
          >
            📷
          </button>
        ) : (
          <div className="w-7 h-5 flex-shrink-0 opacity-20 text-[9px] text-text3 flex items-center justify-center">—</div>
        )}

        {/* Expand arrow */}
        {result?.logs?.length > 0 && (
          <div className={clsx('text-text3 text-[10px] flex-shrink-0 transition-transform', open && 'rotate-180')}>▼</div>
        )}
      </div>

      {/* Expanded log panel */}
      {open && result?.logs?.length > 0 && (
        <div className="bg-[#05090d] border border-border border-t-0 rounded-b-lg px-4 py-3 -mt-1.5 mb-1 animate-slideIn">
          <div className="text-[9px] text-text3 tracking-widest uppercase mb-2">Execution Log</div>
          <div className="font-mono text-[10px] leading-loose max-h-44 overflow-y-auto space-y-px">
            {result.logs.map((line, i) => {
              const color = /ERROR|✗|FAILED/i.test(line) ? 'text-red'
                : /WARN|⚠|exceeded/i.test(line) ? 'text-yellow'
                : /✓|passed|OK|200/i.test(line)  ? 'text-green'
                : /→|←|GET|POST|PUT/i.test(line)  ? 'text-accent'
                : 'text-text2';
              return <div key={i} className={color}>{line}</div>;
            })}
          </div>
        </div>
      )}

      {/* Screenshot modal */}
      {showScreen && result?.screenshot && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8"
          onClick={() => setShowScreen(false)}
        >
          <div
            className="max-w-3xl w-full bg-bg2 border border-border2 rounded-xl overflow-hidden shadow-2xl animate-slideIn"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 bg-bg3 border-b border-border">
              <div className="font-sans font-bold text-[13px] text-white">
                Step {position}: {step?.name}
              </div>
              <button onClick={() => setShowScreen(false)} className="text-text2 hover:text-white text-lg leading-none">✕</button>
            </div>
            {/* Browser chrome */}
            <div className="bg-[#0a1520] px-3 py-2 flex items-center gap-2 border-b border-border">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex-1 bg-border/40 rounded px-3 py-1 text-[10px] text-text2 truncate">
                Syntrix Synthetic Agent — {step?.description}
              </div>
            </div>
            {/* Screenshot */}
            <img
              src={`data:image/png;base64,${result.screenshot}`}
              alt={`Screenshot: ${step?.name}`}
              className="w-full max-h-[60vh] object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
