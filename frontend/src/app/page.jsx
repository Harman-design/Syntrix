'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { getFlows, getOverview, getIncidents, triggerFlow } from '../lib/api';
import { useSocket } from '../lib/socket';
import {
  Card, SectionLabel, StatusDot, StatusPill, TypeTag,
  Sparkline, Spinner, Empty, fmtDuration, fmtLatency,
  useToast, ToastArea,
} from '../components/ui';

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, barPct, barColor }) {
  return (
    <Card className="px-5 py-4 relative overflow-hidden">
      <div className="text-[9px] tracking-[2px] uppercase text-text3 mb-1.5">{label}</div>
      <div className={clsx('font-sans font-bold text-2xl leading-none', color)}>{value}</div>
      {sub && <div className="text-[10px] text-text2 mt-1.5">{sub}</div>}
      {barPct != null && (
        <div className="absolute bottom-0 left-0 h-[2px] transition-all duration-700"
          style={{ width: `${Math.min(100, barPct)}%`, background: barColor || '#00d4ff' }} />
      )}
    </Card>
  );
}

// ── Flow card ─────────────────────────────────────────────────────────────
function FlowCard({ flow, onTrigger, liveStatus }) {
  const status = liveStatus || flow.last_run_status || 'unknown';

  const borderColor = status === 'failed'   ? 'border-red/40   bg-red/[0.025]'
                    : status === 'degraded' ? 'border-yellow/30 bg-yellow/[0.02]'
                    : 'border-border';

  // Fake sparkline data based on pass rate
  const passRate = parseFloat(flow.pass_rate_24h || 90);
  const spark = Array.from({ length: 10 }, () =>
    Math.random() > (1 - passRate / 100) ? 200 + Math.random() * 300 : 1500 + Math.random() * 1000
  );
  const sparkColor = status === 'failed' ? '#ff3d54'
    : status === 'degraded' ? '#ffca28' : '#00d4ff';

  return (
    <Link href={`/flows/${flow.id}`}>
      <Card className={clsx(
        'p-4 cursor-pointer transition-all hover:translate-x-0.5 hover:border-border2 group',
        borderColor
      )}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0 pr-2">
            <div className="font-sans font-semibold text-[13px] text-white truncate group-hover:text-accent transition-colors">
              {flow.name}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <TypeTag type={flow.type} />
              <span className="text-[9px] text-text2">{flow.step_count} steps</span>
              <span className="text-[9px] text-text2">every {flow.interval_s}s</span>
            </div>
          </div>
          <StatusDot status={status} size="lg" />
        </div>

        <Sparkline data={spark} color={sparkColor} height={20} />

        <div className="flex items-center justify-between mt-2">
          <StatusPill status={status} />
          <div className="flex items-center gap-3 text-[9px] text-text2">
            {flow.pass_rate_24h != null && <span>{flow.pass_rate_24h}% pass 24h</span>}
            {flow.open_incidents > 0 && (
              <span className="text-red font-semibold">
                {flow.open_incidents} open incident{flow.open_incidents > 1 ? 's' : ''}
              </span>
            )}
            {flow.last_run_duration_ms && <span>{fmtDuration(flow.last_run_duration_ms)}</span>}
          </div>
        </div>

        <button
          onClick={e => { e.preventDefault(); onTrigger(flow); }}
          className="mt-3 w-full text-[9px] tracking-widest uppercase py-1.5 rounded border border-border text-text3 hover:border-accent hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
        >
          ▶ Run Now
        </button>
      </Card>
    </Link>
  );
}

// ── Incident row ──────────────────────────────────────────────────────────
function IncidentRow({ incident }) {
  const end = incident.resolved_at ? new Date(incident.resolved_at) : new Date();
  const s   = Math.round((end - new Date(incident.opened_at)) / 1000);
  const dur = s > 3600 ? `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
            : s > 60   ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;

  return (
    <Link href={`/incidents/${incident.id}`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border hover:bg-white/[0.015] transition-colors">
        <span className={clsx(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          incident.status === 'open' ? 'bg-red animate-pulse' : 'bg-green'
        )} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-[#e0eaf5] truncate">{incident.title}</div>
          <div className="text-[9px] text-text2 mt-0.5 truncate">
            {incident.flow_name} · Step {incident.step_position}: {incident.step_name}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={clsx('text-[9px] font-bold tracking-wider',
            incident.severity === 'critical' ? 'text-red' : 'text-yellow')}>
            {incident.severity.toUpperCase()}
          </div>
          <div className="text-[9px] text-text3 mt-0.5">{dur}</div>
        </div>
        <span className={clsx(
          'text-[8px] px-2 py-0.5 rounded border font-bold tracking-wider uppercase flex-shrink-0',
          incident.status === 'open'
            ? 'bg-red/10 border-red/25 text-red'
            : 'bg-green/10 border-green/25 text-green'
        )}>
          {incident.status}
        </span>
      </div>
    </Link>
  );
}

// ── Live feed ticker ──────────────────────────────────────────────────────
function LiveFeed({ events }) {
  if (!events.length) return (
    <div className="px-4 py-6 text-center text-text3 text-[10px]">Waiting for runs…</div>
  );
  return (
    <div className="divide-y divide-border max-h-56 overflow-y-auto">
      {events.map((ev, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <span className={clsx('text-[10px] font-bold w-14 flex-shrink-0',
            ev.status === 'passed'   ? 'text-green'
            : ev.status === 'failed' ? 'text-red'
            : 'text-yellow')}>
            {ev.status === 'passed' ? '✅ PASS' : ev.status === 'failed' ? '❌ FAIL' : '⚠ SLOW'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-[#e0eaf5] truncate">{ev.flowName}</div>
          </div>
          <div className="text-[9px] text-text2 flex-shrink-0">{fmtDuration(ev.durationMs)}</div>
          <div className="text-[9px] text-text3 flex-shrink-0 tabular-nums">{ev.time}</div>
        </div>
      ))}
    </div>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [flows,     setFlows]     = useState([]);
  const [overview,  setOverview]  = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [liveStatuses, setLiveStatuses] = useState({});   // flowId → status
  const [liveFeed,  setLiveFeed]  = useState([]);
  const { toasts, add: toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [f, o, i] = await Promise.all([
        getFlows(), getOverview(), getIncidents({ limit: 8 }),
      ]);
      setFlows(f);
      setOverview(o);
      setIncidents(i);
    } catch (err) {
      console.error('Load error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + poll every 20s
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  // Real-time WebSocket events
  useSocket({
    'run:completed': (ev) => {
      setLiveStatuses(s => ({ ...s, [ev.flowId]: ev.status }));
      const time = new Date().toISOString().split('T')[1].slice(0, 8);
      setLiveFeed(f => [{ ...ev, time }, ...f].slice(0, 20));
      // Refresh data after a run completes
      setTimeout(load, 1000);
    },
    'incident:opened': (ev) => {
      toast(`⚠ New incident: ${ev.title}`, 'err');
      setTimeout(load, 1000);
    },
    'incident:resolved': (ev) => {
      toast(`✓ Resolved: ${ev.flowName}`, 'ok');
      setTimeout(load, 1000);
    },
  });

  async function handleTrigger(flow) {
    try {
      await triggerFlow(flow.id);
      toast(`▶ "${flow.name}" triggered`, 'info');
      setTimeout(load, 4000);
    } catch {
      toast('Runner not reachable', 'err');
    }
  }

  const openInc  = parseInt(overview?.incidents?.open || 0);
  const passing  = parseInt(overview?.flows?.passing  || 0);
  const total    = parseInt(overview?.flows?.total    || 0);
  const failing  = parseInt(overview?.flows?.failing  || 0);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      <ToastArea toasts={toasts} />

      {loading ? (
        <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* ── Stat cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <StatCard
              label="Flows Passing"
              value={`${passing}/${total}`}
              sub={failing > 0 ? `${failing} failing` : 'All healthy'}
              color={failing > 0 ? 'text-red' : 'text-green'}
              barPct={total ? (passing / total) * 100 : 100}
              barColor={failing > 0 ? '#ff3d54' : '#00e676'}
            />
            <StatCard
              label="Open Incidents"
              value={openInc}
              sub={openInc > 0 ? 'Needs attention' : 'All clear'}
              color={openInc > 0 ? 'text-red' : 'text-green'}
              barPct={Math.min(100, openInc * 25)}
              barColor="#ff3d54"
            />
            <StatCard
              label="Runs (24h)"
              value={overview?.runs24h?.total || 0}
              sub={`${overview?.runs24h?.failed || 0} failed`}
              color="text-accent"
              barPct={75}
              barColor="#00d4ff"
            />
            <StatCard
              label="Avg Latency p95"
              value={overview?.p95_ms ? fmtLatency(Math.round(overview.p95_ms)) : '—'}
              sub="across all steps"
              color="text-yellow"
              barPct={50}
              barColor="#ffca28"
            />
            <StatCard
              label="7-Day Uptime"
              value={overview?.uptime7d ? `${overview.uptime7d}%` : '—'}
              sub="real flow uptime"
              color="text-green"
              barPct={parseFloat(overview?.uptime7d || 100)}
              barColor="#00e676"
            />
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* ── Left: flows grid ───────────────────────────── */}
            <div className="col-span-2 space-y-4">
              <SectionLabel>Business Flows ({flows.length})</SectionLabel>
              {flows.length === 0 ? (
                <Card className="p-8 text-center text-text3 text-xs">No flows yet.</Card>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {flows.map(flow => (
                    <FlowCard
                      key={flow.id}
                      flow={flow}
                      onTrigger={handleTrigger}
                      liveStatus={liveStatuses[flow.id]}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Right: incidents + live feed ───────────────── */}
            <div className="space-y-4">
              <div>
                <SectionLabel className="mb-3">
                  Incidents
                  {openInc > 0 && (
                    <span className="bg-red text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full">
                      {openInc} open
                    </span>
                  )}
                </SectionLabel>
                <Card className="overflow-hidden">
                  {incidents.length === 0
                    ? <div className="py-8 text-center text-text3 text-[10px]">No incidents 🎉</div>
                    : incidents.map(inc => <IncidentRow key={inc.id} incident={inc} />)
                  }
                  <div className="px-4 py-2 border-t border-border">
                    <Link href="/incidents" className="text-[10px] text-accent hover:underline">
                      View all →
                    </Link>
                  </div>
                </Card>
              </div>

              <div>
                <SectionLabel className="mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block" />
                  Live Feed
                </SectionLabel>
                <Card className="overflow-hidden">
                  <LiveFeed events={liveFeed} />
                </Card>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
