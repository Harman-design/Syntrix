// src/components/ui.jsx
'use client';
import clsx from 'clsx';

// ── Status maps ───────────────────────────────────────────────────────────
export const STATUS_PILL = {
  passed:   'bg-green/10  border-green/25  text-green',
  failed:   'bg-red/10    border-red/25    text-red',
  degraded: 'bg-yellow/10 border-yellow/25 text-yellow',
  slow:     'bg-yellow/10 border-yellow/25 text-yellow',
  running:  'bg-accent/10 border-accent/25 text-accent',
  skipped:  'bg-text3/10  border-text3/20  text-text3',
  open:     'bg-red/10    border-red/25    text-red',
  resolved: 'bg-green/10  border-green/25  text-green',
  critical: 'bg-red/10    border-red/25    text-red',
  warning:  'bg-yellow/10 border-yellow/25 text-yellow',
};

export const STATUS_DOT = {
  passed:   'bg-green  shadow-[0_0_6px_#00e676]',
  failed:   'bg-red    shadow-[0_0_6px_#ff3d54] animate-blink',
  degraded: 'bg-yellow shadow-[0_0_6px_#ffca28]',
  slow:     'bg-yellow shadow-[0_0_6px_#ffca28]',
  running:  'bg-accent shadow-[0_0_6px_#00d4ff] animate-pulse',
  skipped:  'bg-text3',
  unknown:  'bg-text3',
};

export const STATUS_LEFT = {
  passed:  'border-l-green',
  failed:  'border-l-red',
  slow:    'border-l-yellow',
  skipped: 'border-l-text3',
  running: 'border-l-accent',
};

const PILL_LABELS = {
  passed: 'PASSING', failed: 'FAILING', degraded: 'DEGRADED',
  slow: 'SLOW', running: 'RUNNING', skipped: 'SKIPPED',
  open: 'OPEN', resolved: 'RESOLVED', critical: 'CRITICAL', warning: 'WARNING',
};

// ── Components ────────────────────────────────────────────────────────────

export function StatusPill({ status, className }) {
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-[1.5px] uppercase',
      STATUS_PILL[status] || 'bg-text3/10 border-text3/20 text-text3',
      className
    )}>
      {PILL_LABELS[status] || status?.toUpperCase()}
    </span>
  );
}

export function StatusDot({ status, size = 'md' }) {
  const sizes = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2', lg: 'w-2.5 h-2.5' };
  return (
    <span className={clsx(
      'rounded-full inline-block flex-shrink-0',
      sizes[size],
      STATUS_DOT[status] || 'bg-text3',
    )} />
  );
}

export function TypeTag({ type }) {
  const styles = {
    browser: 'bg-purple/15 text-purple border-purple/30',
    api:     'bg-accent/10 text-accent border-accent/20',
    db:      'bg-orange/15 text-orange border-orange/25',
  };
  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wider uppercase',
      styles[type] || styles.api
    )}>
      {type}
    </span>
  );
}

export function LatencyValue({ ms, thresholdMs, className }) {
  if (ms == null) return <span className={clsx('text-text3 font-sans font-bold text-base', className)}>—</span>;
  const display = ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
  const color   = ms > thresholdMs ? 'text-red' : ms > thresholdMs * 0.8 ? 'text-yellow' : 'text-green';
  return <span className={clsx('font-sans font-bold text-base tabular-nums', color, className)}>{display}</span>;
}

export function Card({ children, className, ...props }) {
  return <div className={clsx('bg-bg2 border border-border rounded-lg', className)} {...props}>{children}</div>;
}

export function SectionLabel({ children, className }) {
  return (
    <div className={clsx('text-[9px] tracking-[2px] uppercase text-text3 font-semibold flex items-center gap-2', className)}>
      {children}
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

export function Spinner({ size = 'md', className }) {
  const s = { sm: 'w-3.5 h-3.5 border', md: 'w-5 h-5 border-2', lg: 'w-8 h-8 border-2' };
  return <div className={clsx('border-border border-t-accent rounded-full animate-spin', s[size], className)} />;
}

export function Empty({ message = 'No data yet', icon = '◌' }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-text3">
      <div className="text-2xl mb-2 opacity-30">{icon}</div>
      <div className="text-[10px] tracking-wider">{message}</div>
    </div>
  );
}

export function ProgressBar({ pct, color = '#00d4ff', className }) {
  return (
    <div className={clsx('w-full h-1 bg-border rounded-full overflow-hidden', className)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

export function Sparkline({ data = [], color = '#00d4ff', height = 24 }) {
  if (data.length < 2) return <div style={{ height }} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const rng = max - min || 1;
  const W = 100, H = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / rng) * (H - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`sg${color.replace(/[^a-z0-9]/gi,'')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      <polygon  points={`${pts} ${W},${H} 0,${H}`} fill={`url(#sg${color.replace(/[^a-z0-9]/gi,'')})`} />
    </svg>
  );
}

// Duration formatter: ms → "1m 32s" / "320ms"
export function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Latency formatter
export function fmtLatency(ms) {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

// Toast notification hook
import { useState, useCallback } from 'react';
export function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = 'ok') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  return { toasts, add };
}

export function ToastArea({ toasts }) {
  return (
    <div className="fixed top-16 right-4 z-[100] flex flex-col gap-2 w-72">
      {toasts.map(t => (
        <div key={t.id} className={clsx(
          'px-4 py-3 rounded-lg border text-xs font-medium shadow-2xl animate-slideIn',
          t.type === 'ok'  && 'bg-bg2 border-green/30 text-green',
          t.type === 'err' && 'bg-bg2 border-red/30   text-red',
          t.type === 'info'&& 'bg-bg2 border-accent/30 text-accent',
        )}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
