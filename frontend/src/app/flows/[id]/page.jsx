'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { getFlow, getFlowMetrics, triggerFlow } from '../../../lib/api';
import { useSocket } from '../../../lib/socket';
import {
  Card, SectionLabel, StatusPill, TypeTag,
  Spinner, Empty, fmtDuration, fmtLatency,
  useToast, ToastArea,
} from '../../../components/ui';
import StepResultRow from '../../../components/StepResultRow';
import { LatencyChart, ErrorRateChart } from '../../../components/Charts';

export default function FlowDetailPage() {
  const { id }   = useParams();
  const [data,    setData]    = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Live step updates overlay — overrides DB results while a run is in progress
  const [liveSteps, setLiveSteps] = useState({});  // position → stepResult
  const [liveRunning, setLiveRunning] = useState(false);

  const { toasts, add: toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        getFlow(id),
        getFlowMetrics(id, 24),
      ]);
      setData(d);
      setMetrics(m);
    } catch (err) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // Subscribe to this flow's room for granular updates
  const { subscribeToFlow, unsubscribeFromFlow } = useSocket({
    'run:started': (ev) => {
      if (ev.flowId !== id) return;
      setLiveRunning(true);
      setLiveSteps({});
    },
    'step:completed': (ev) => {
      if (ev.flowId !== id) return;
      setLiveSteps(s => ({ ...s, [ev.position]: ev }));
    },
    'run:completed': (ev) => {
      if (ev.flowId !== id) return;
      setLiveRunning(false);
      setTimeout(() => { load(); setLiveSteps({}); }, 1500);
    },
  });

  useEffect(() => {
    subscribeToFlow(id);
    return () => unsubscribeFromFlow(id);
  }, [id]);

  async function handleTrigger() {
    setRunning(true);
    try {
      await triggerFlow(id);
      toast('▶ Run triggered', 'info');
    } catch {
      toast('Runner not reachable', 'err');
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!data)   return <div className="p-8 text-red text-sm">Flow not found.</div>;

  const { flow, steps, runs, latestStepResults, incidents } = data;
  const status = flow.last_run_status || runs[0]?.status || 'unknown';

  const statusColor = status === 'passed'   ? 'text-green'
                    : status === 'failed'   ? 'text-red'
                    : status === 'degraded' ? 'text-yellow'
                    : 'text-text2';

  const openIncidents = incidents.filter(i => i.status === 'open');

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <ToastArea toasts={toasts} />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[10px] text-text3 mb-5">
        <Link href="/" className="hover:text-accent">Dashboard</Link>
        <span>/</span>
        <Link href="/flows" className="hover:text-accent">Flows</Link>
        <span>/</span>
        <span className="text-text2 truncate max-w-xs">{flow.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-sans font-bold text-xl text-white">{flow.name}</h1>
            <TypeTag type={flow.type} />
            {liveRunning && (
              <span className="flex items-center gap-1.5 text-[9px] text-accent font-bold tracking-widest uppercase animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                Running
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[10px] text-text2 flex-wrap">
            {flow.config?.baseUrl && <span>{flow.config.baseUrl}</span>}
            <span className="text-text3">·</span>
            <span>Every {flow.interval_s}s</span>
            <span className="text-text3">·</span>
            <span>{steps.length} steps</span>
            {runs[0] && (
              <>
                <span className="text-text3">·</span>
                <span>Last: {fmtDuration(runs[0].duration_ms)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={clsx('font-sans font-bold text-sm', statusColor)}>
            {status === 'passed'   ? '● PASSING'
            : status === 'failed'  ? '● FAILING'
            : status === 'degraded'? '◐ DEGRADED'
            : '○ UNKNOWN'}
          </div>
          <button
            onClick={handleTrigger}
            disabled={running || liveRunning}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-black text-[11px] font-bold tracking-widest uppercase rounded hover:bg-[#00eeff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? <Spinner size="sm" /> : '▶'}
            Run Now
          </button>
        </div>
      </div>

      {/* Open incident banner */}
      {openIncidents.map(inc => (
        <div key={inc.id} className="mb-5 px-4 py-3 bg-red/5 border border-red/30 rounded-lg flex items-center justify-between">
          <div>
            <div className="text-red text-[10px] font-bold mb-0.5">⚠ Active Incident</div>
            <div className="text-[11px] text-text2">{inc.title}</div>
          </div>
          <Link href={`/incidents/${inc.id}`} className="text-[10px] text-red hover:underline flex-shrink-0 ml-4">
            View →
          </Link>
        </div>
      ))}

      {/* Step results */}
      <div className="mb-6">
        <SectionLabel className="mb-3">
          Step Execution
          <span className="text-text3 text-[9px] font-normal normal-case tracking-normal">
            · click to expand logs · 📷 for screenshot
          </span>
        </SectionLabel>
        <div className="space-y-1.5">
          {steps.map(step => {
            // Live step overrides DB result during a run
            const liveResult = liveSteps[step.position];
            const dbResult   = latestStepResults.find(r => r.position === step.position);
            const result     = liveResult
              ? { ...dbResult, status: liveResult.status, latency_ms: liveResult.latencyMs, error: liveResult.error }
              : dbResult;
            return (
              <StepResultRow
                key={step.id}
                step={step}
                result={result}
                position={step.position}
              />
            );
          })}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card className="p-4">
          <div className="text-[9px] tracking-[1.5px] uppercase text-text3 mb-3">Step Latency p95 — 24h</div>
          <LatencyChart stepMetrics={metrics?.stepMetrics || []} />
        </Card>

        <Card className="p-4">
          <div className="text-[9px] tracking-[1.5px] uppercase text-text3 mb-3">Hourly Error Rate — 24h</div>
          <ErrorRateChart flowHourly={metrics?.flowHourly || []} />

          {/* Per-step p95/p99 table */}
          {steps.length > 0 && (
            <div className="mt-4 border-t border-border pt-3 space-y-1.5">
              {steps.map(step => (
                <div key={step.id} className="flex items-center justify-between text-[10px]">
                  <span className="text-text2 truncate max-w-[55%]">
                    {step.position}. {step.name.split(' ').slice(0,3).join(' ')}
                  </span>
                  <div className="flex gap-3 tabular-nums">
                    <span className={step.percentiles?.p95 > step.threshold_p95_ms ? 'text-yellow' : 'text-green'}>
                      p95 {step.percentiles?.p95 ? fmtLatency(step.percentiles.p95) : '—'}
                    </span>
                    <span className={step.percentiles?.p99 > step.threshold_p99_ms ? 'text-red' : 'text-text2'}>
                      p99 {step.percentiles?.p99 ? fmtLatency(step.percentiles.p99) : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Run history */}
      <div>
        <SectionLabel className="mb-3">Recent Runs</SectionLabel>
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[140px_100px_80px_1fr_60px] px-4 py-2.5 bg-bg3 border-b border-border text-[9px] tracking-widest uppercase text-text3 font-semibold gap-3">
            <div>Started</div><div>Status</div><div>Duration</div><div>Failed Step</div><div></div>
          </div>
          {runs.length === 0 ? <Empty message="No runs yet" /> : (
            runs.map(run => (
              <div key={run.id} className="grid grid-cols-[140px_100px_80px_1fr_60px] px-4 py-2.5 border-b border-border items-center gap-3 text-[11px]">
                <div className="text-text2 font-mono tabular-nums">
                  {new Date(run.started_at).toLocaleTimeString()}
                </div>
                <div><StatusPill status={run.status} /></div>
                <div className="text-text tabular-nums">{fmtDuration(run.duration_ms)}</div>
                <div className="text-text2 truncate">
                  {run.failed_step_id
                    ? steps.find(s => s.id === run.failed_step_id)?.name || '—'
                    : '—'}
                </div>
                <div className="text-[10px] text-accent">
                  <Link href={`/runs/${run.id}`} className="hover:underline">View</Link>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
