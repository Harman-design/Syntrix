'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { getFlows, getOverview, getIncidents, triggerFlow } from '../lib/api';
import { useSocket } from '../lib/socket';
import api from '../lib/api';
import {
  Card, SectionLabel, StatusDot, StatusPill, TypeTag,
  Sparkline, Spinner, fmtDuration, fmtLatency,
  useToast, ToastArea,
} from '../components/ui';

// ── Run history dot strip ─────────────────────────────────────────────────
function RunDots({ runs = [] }) {
  if (!runs.length) return <div className="h-3" />;
  const recent = [...runs].slice(0, 20).reverse();
  return (
    <div className="flex items-center gap-[3px] h-3">
      {recent.map((r, i) => (
        <div
          key={i}
          title={`${r.status} · ${fmtDuration(r.duration_ms)} · ${new Date(r.started_at).toLocaleTimeString()}`}
          className={clsx(
            'rounded-sm flex-shrink-0 transition-all',
            i === recent.length - 1 ? 'w-2 h-3' : 'w-1.5 h-3',
            r.status === 'passed'   && 'bg-green opacity-80',
            r.status === 'failed'   && 'bg-red opacity-90',
            r.status === 'degraded' && 'bg-yellow opacity-80',
          )}
        />
      ))}
      <div className="flex-1 h-px bg-border ml-1" />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, barPct, barColor, pulse }) {
  return (
    <Card className="px-5 py-4 relative overflow-hidden">
      <div className="text-[9px] tracking-[2px] uppercase text-text3 mb-1.5">{label}</div>
      <div className={clsx('font-sans font-bold text-2xl leading-none tabular-nums', color, pulse && 'animate-pulse')}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-text2 mt-1.5">{sub}</div>}
      {barPct != null && (
        <div className="absolute bottom-0 left-0 h-[2px] transition-all duration-700 rounded"
          style={{ width: `${Math.min(100, Math.max(0, barPct))}%`, background: barColor || '#00d4ff' }} />
      )}
    </Card>
  );
}

// ── Flow card ─────────────────────────────────────────────────────────────
function FlowCard({ flow, onTrigger, liveStatus, recentRuns }) {
  const status = liveStatus || flow.last_run_status || 'unknown';
  const borderColor =
    status === 'failed'   ? 'border-red/40   bg-red/[0.03]'
    : status === 'degraded' ? 'border-yellow/30 bg-yellow/[0.02]'
    : status === 'passed'   ? 'border-green/20'
    : 'border-border';

  const sparkColor = status === 'failed' ? '#ff3d54'
    : status === 'degraded' ? '#ffca28' : '#00d4ff';

  // Build sparkline from real run durations
  const spark = recentRuns?.length
    ? recentRuns.slice(0, 12).reverse().map(r => r.duration_ms || 500)
    : Array.from({ length: 10 }, () => 300 + Math.random() * 400);

  return (
    <Link href={`/flows/${flow.id}`}>
      <Card className={clsx(
        'p-4 cursor-pointer transition-all hover:translate-x-0.5 hover:border-border2 group',
        borderColor
      )}>
        {/* Header */}
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

        {/* Run history dots */}
        <RunDots runs={recentRuns || []} />

        {/* Sparkline */}
        <div className="mt-1.5 mb-2">
          <Sparkline data={spark} color={sparkColor} height={22} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <StatusPill status={status} />
          <div className="flex items-center gap-3 text-[9px] text-text2">
            {flow.pass_rate_24h != null && (
              <span className={clsx(
                parseFloat(flow.pass_rate_24h) < 80 ? 'text-red'
                : parseFloat(flow.pass_rate_24h) < 95 ? 'text-yellow'
                : 'text-green'
              )}>
                {flow.pass_rate_24h}% 24h
              </span>
            )}
            {flow.open_incidents > 0 && (
              <span className="text-red font-semibold animate-pulse">
                {flow.open_incidents} incident{flow.open_incidents > 1 ? 's' : ''}
              </span>
            )}
            {flow.last_run_duration_ms && (
              <span>{fmtDuration(flow.last_run_duration_ms)}</span>
            )}
          </div>
        </div>

        {/* Run now button */}
        <button
          onClick={e => { e.preventDefault(); onTrigger(flow); }}
          className="mt-2.5 w-full text-[9px] tracking-widest uppercase py-1.5 rounded border border-border text-text3 hover:border-accent hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
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
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border hover:bg-white/[0.015] transition-colors">
        <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0',
          incident.status === 'open' ? 'bg-red animate-pulse' : 'bg-green')} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-[#e0eaf5] truncate">{incident.title}</div>
          <div className="text-[9px] text-text2 mt-0.5 truncate">
            Step {incident.step_position}: {incident.step_name}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={clsx('text-[9px] font-bold',
            incident.severity === 'critical' ? 'text-red' : 'text-yellow')}>
            {incident.severity?.toUpperCase()}
          </div>
          <div className="text-[9px] text-text3">{dur}</div>
        </div>
        <span className={clsx('text-[8px] px-1.5 py-0.5 rounded border font-bold uppercase flex-shrink-0',
          incident.status === 'open'
            ? 'bg-red/10 border-red/25 text-red'
            : 'bg-green/10 border-green/25 text-green')}>
          {incident.status}
        </span>
      </div>
    </Link>
  );
}

// ── Live feed ─────────────────────────────────────────────────────────────
function LiveFeed({ events }) {
  if (!events.length) return (
    <div className="px-4 py-6 text-center text-text3 text-[10px]">Waiting for runs…</div>
  );
  return (
    <div className="divide-y divide-border max-h-48 overflow-y-auto">
      {events.map((ev, i) => (
        <div key={i} className={clsx(
          'flex items-center gap-3 px-4 py-2 transition-all',
          i === 0 && 'bg-white/[0.02]'
        )}>
          <span className={clsx('text-[9px] font-bold w-12 flex-shrink-0 tabular-nums',
            ev.status === 'passed' ? 'text-green' : ev.status === 'failed' ? 'text-red' : 'text-yellow')}>
            {ev.status === 'passed' ? '✅' : ev.status === 'failed' ? '❌' : '⚠️'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#e0eaf5] truncate">{ev.flowName}</div>
          </div>
          <div className="text-[9px] text-text2 flex-shrink-0 tabular-nums">{fmtDuration(ev.durationMs)}</div>
          <div className="text-[9px] text-text3 flex-shrink-0 tabular-nums">{ev.time}</div>
        </div>
      ))}
    </div>
  );
}

// ── Demo scenario panel ───────────────────────────────────────────────────
function DemoPanel({ flows, onDone }) {
  const [selected, setSelected] = useState('');
  const [running,  setRunning]  = useState(false);
  const [phase,    setPhase]    = useState(null);  // null | 'fail' | 'recover' | 'done'
  const [log,      setLog]      = useState([]);

  useEffect(() => {
    if (flows.length) setSelected(flows[0].id);
  }, [flows]);

  const addLog = (msg) => setLog(l => [msg, ...l]);

  async function runScenario() {
    if (!selected) return;
    setRunning(true);
    setLog([]);
    setPhase('running');

    try {
      addLog('🎬 Starting demo scenario...');
      const { data } = await api.post('/api/demo/scenario', { flowId: selected });
      addLog(`▶ ${data.message}`);
      addLog('');

      // Mirror the timeline the backend sent
      data.timeline?.forEach(line => addLog(line));

      addLog('');
      addLog('⏳ Watch the dashboard update live...');

      // Update phase labels as time passes
      setTimeout(() => { setPhase('fail');    addLog(''); addLog('❌ Failure injected!'); }, 3500);
      setTimeout(() => { addLog('🚨 Incident opened — check the incidents panel'); }, 5000);
      setTimeout(() => { setPhase('recover'); addLog(''); addLog('♻️  Recovery in progress...'); }, 20000);
      setTimeout(() => { setPhase('done');    addLog(''); addLog('✅ Incident resolved!'); addLog('🎉 Scenario complete.'); setRunning(false); onDone?.(); }, 38000);

    } catch (err) {
      addLog(`❌ Error: ${err.message}`);
      setRunning(false);
      setPhase(null);
    }
  }

  const phaseColor = phase === 'fail' ? 'text-red' : phase === 'recover' ? 'text-yellow' : phase === 'done' ? 'text-green' : 'text-accent';
  const phaseLabel = { running: 'Running...', fail: 'Flow Failing', recover: 'Recovering', done: 'Complete ✓' };

  return (
    <Card className="p-4 border-accent/20 bg-accent/[0.02]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent text-[10px] font-bold tracking-widest uppercase">⬡ Demo Mode</span>
        {phase && <span className={clsx('text-[9px] font-bold', phaseColor)}>{phaseLabel[phase]}</span>}
      </div>

      <div className="text-[10px] text-text2 mb-3 leading-relaxed">
        Triggers a scripted failure → incident → recovery cycle live on the dashboard.
        Perfect for a 3-minute judge demo.
      </div>

      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        disabled={running}
        className="w-full mb-3 bg-bg3 border border-border rounded px-3 py-2 text-[11px] text-text focus:border-accent outline-none disabled:opacity-50"
      >
        {flows.map(f => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>

      <button
        onClick={runScenario}
        disabled={running || !selected}
        className={clsx(
          'w-full py-2.5 rounded font-bold text-[11px] tracking-widest uppercase transition-all',
          running
            ? 'bg-border text-text3 cursor-not-allowed'
            : 'bg-accent text-black hover:bg-[#00eeff]'
        )}
      >
        {running ? '⏳ Running scenario...' : '▶ Start Demo Scenario'}
      </button>

      {log.length > 0 && (
        <div className="mt-3 bg-bg border border-border rounded p-3 font-mono text-[9px] leading-loose max-h-36 overflow-y-auto">
          {log.map((l, i) => (
            <div key={i} className={clsx(
              !l && 'h-1',
              l.startsWith('❌') && 'text-red',
              l.startsWith('✅') && 'text-green',
              l.startsWith('♻') && 'text-yellow',
              l.startsWith('🚨') && 'text-red',
              l.startsWith('▶') && 'text-accent',
              l.startsWith('⏳') && 'text-text2',
              !l.match(/[❌✅♻🚨▶⏳🎬🎉]/) && 'text-text3',
            )}>{l}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [flows,      setFlows]      = useState([]);
  const [overview,   setOverview]   = useState(null);
  const [incidents,  setIncidents]  = useState([]);
  const [recentRuns, setRecentRuns] = useState({});  // flowId → run[]
  const [demoFlows,  setDemoFlows]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [liveStatuses, setLiveStatuses] = useState({});
  const [liveFeed,   setLiveFeed]   = useState([]);
  const [showDemo,   setShowDemo]   = useState(false);
  const { toasts, add: toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [f, o, i, df] = await Promise.all([
        getFlows(),
        getOverview(),
        getIncidents({ limit: 8 }),
        api.get('/api/demo/flows').then(r => r.data.flows).catch(() => []),
      ]);
      setFlows(f);
      setOverview(o);
      setIncidents(i);
      setDemoFlows(df);

      // Fetch recent runs per flow for history dots
      const runsMap = {};
      await Promise.all(f.map(async flow => {
        const { data } = await api.get('/api/runs', { params: { flowId: flow.id, limit: 20 } });
        runsMap[flow.id] = data.runs;
      }));
      setRecentRuns(runsMap);

    } catch (err) {
      console.error('Load error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  useSocket({
    'run:completed': (ev) => {
      setLiveStatuses(s => ({ ...s, [ev.flowId]: ev.status }));
      const time = new Date().toISOString().split('T')[1].slice(0, 8);
      setLiveFeed(f => [{ ...ev, time }, ...f].slice(0, 30));
      setTimeout(load, 1500);
    },
    'incident:opened':   (ev) => { toast(`🚨 ${ev.title}`, 'err');  setTimeout(load, 1000); },
    'incident:resolved': (ev) => { toast(`✅ Resolved: ${ev.flowName}`, 'ok'); setTimeout(load, 1000); },
  });

  async function handleTrigger(flow) {
    try {
      await triggerFlow(flow.id);
      toast(`▶ "${flow.name}" triggered`, 'info');
    } catch {
      toast('Runner not reachable', 'err');
    }
  }

  const openInc = parseInt(overview?.incidents?.open || 0);
  const passing = parseInt(overview?.flows?.passing  || 0);
  const total   = parseInt(overview?.flows?.total    || 0);
  const failing = parseInt(overview?.flows?.failing  || 0);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      <ToastArea toasts={toasts} />

      {loading ? (
        <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* ── Stat cards ──────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <StatCard
              label="Flows Passing"
              value={`${passing}/${total}`}
              sub={failing > 0 ? `${failing} failing` : '✓ All healthy'}
              color={failing > 0 ? 'text-red' : 'text-green'}
              barPct={total ? (passing / total) * 100 : 100}
              barColor={failing > 0 ? '#ff3d54' : '#00e676'}
            />
            <StatCard
              label="Open Incidents"
              value={openInc}
              sub={openInc > 0 ? 'Needs attention' : '✓ All clear'}
              color={openInc > 0 ? 'text-red' : 'text-green'}
              barPct={Math.min(100, openInc * 10)}
              barColor="#ff3d54"
              pulse={openInc > 0}
            />
            <StatCard
              label="Runs (24h)"
              value={overview?.runs24h?.total || 0}
              sub={`${overview?.runs24h?.failed || 0} failed · ${overview?.runs24h?.passed || 0} passed`}
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
              color={
                parseFloat(overview?.uptime7d || 100) < 95 ? 'text-yellow'
                : parseFloat(overview?.uptime7d || 100) < 80 ? 'text-red'
                : 'text-green'
              }
              barPct={parseFloat(overview?.uptime7d || 100)}
              barColor="#00e676"
            />
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* ── Left: flows ─────────────────────────────── */}
            <div className="col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <SectionLabel className="flex-1">Business Flows ({flows.length})</SectionLabel>
                <button
                  onClick={() => setShowDemo(d => !d)}
                  className={clsx(
                    'ml-4 px-3 py-1.5 rounded text-[9px] font-bold tracking-widest uppercase border transition-all',
                    showDemo
                      ? 'bg-accent/10 border-accent/40 text-accent'
                      : 'border-border text-text3 hover:border-accent/40 hover:text-accent'
                  )}
                >
                  ⬡ Demo Mode
                </button>
              </div>

              {showDemo && (
                <DemoPanel flows={demoFlows} onDone={() => setTimeout(load, 2000)} />
              )}

              <div className="grid grid-cols-2 gap-3">
                {flows.map(flow => (
                  <FlowCard
                    key={flow.id}
                    flow={flow}
                    onTrigger={handleTrigger}
                    liveStatus={liveStatuses[flow.id]}
                    recentRuns={recentRuns[flow.id] || []}
                  />
                ))}
              </div>
            </div>

            {/* ── Right: incidents + live feed ──────────── */}
            <div className="space-y-4">
              <div>
                <SectionLabel className="mb-3">
                  Incidents
                  {openInc > 0 && (
                    <span className="bg-red text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full ml-1 animate-pulse">
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
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block mr-1" />
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
