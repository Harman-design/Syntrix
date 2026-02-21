'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { getFlows, triggerFlow } from '../../lib/api';
import { useSocket } from '../../lib/socket';
import {
  Card, SectionLabel, StatusDot, StatusPill, TypeTag,
  Spinner, fmtDuration, useToast, ToastArea,
} from '../../components/ui';

export default function FlowsPage() {
  const [flows,   setFlows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveStatuses, setLiveStatuses] = useState({});
  const { toasts, add: toast } = useToast();

  useEffect(() => {
    getFlows().then(setFlows).finally(() => setLoading(false));
  }, []);

  useSocket({
    'run:completed': (ev) => {
      setLiveStatuses(s => ({ ...s, [ev.flowId]: ev.status }));
    },
  });

  async function handleTrigger(e, flow) {
    e.preventDefault();
    try {
      await triggerFlow(flow.id);
      toast(`▶ "${flow.name}" triggered`, 'info');
    } catch {
      toast('Runner not reachable', 'err');
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <ToastArea toasts={toasts} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-sans font-bold text-xl text-white mb-1">Flows</h1>
          <div className="text-[11px] text-text2">{flows.length} configured</div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <Card className="overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_80px_80px_80px_80px_100px_60px] px-5 py-3 bg-bg3 border-b border-border text-[9px] tracking-widest uppercase text-text3 font-semibold gap-3">
            <div>Flow</div>
            <div>Type</div>
            <div>Steps</div>
            <div>Interval</div>
            <div>Pass 24h</div>
            <div>Last Run</div>
            <div></div>
          </div>

          {flows.length === 0 ? (
            <div className="py-10 text-center text-text3 text-[11px]">No flows configured yet.</div>
          ) : (
            flows.map(flow => {
              const status = liveStatuses[flow.id] || flow.last_run_status || 'unknown';
              return (
                <Link key={flow.id} href={`/flows/${flow.id}`}>
                  <div className="grid grid-cols-[2fr_80px_80px_80px_80px_100px_60px] px-5 py-3.5 border-b border-border hover:bg-white/[0.015] transition-colors items-center gap-3 group">
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusDot status={status} />
                      <div className="min-w-0">
                        <div className="text-[12px] text-[#e0eaf5] font-medium truncate group-hover:text-accent transition-colors">
                          {flow.name}
                        </div>
                        <div className="text-[9px] text-text2 truncate mt-0.5">{flow.description}</div>
                      </div>
                    </div>
                    <div><TypeTag type={flow.type} /></div>
                    <div className="text-[11px] text-text">{flow.step_count}</div>
                    <div className="text-[11px] text-text2">{flow.interval_s}s</div>
                    <div className={clsx('text-[11px] font-semibold',
                      parseFloat(flow.pass_rate_24h) < 80 ? 'text-red'
                      : parseFloat(flow.pass_rate_24h) < 95 ? 'text-yellow'
                      : 'text-green')}>
                      {flow.pass_rate_24h != null ? `${flow.pass_rate_24h}%` : '—'}
                    </div>
                    <div className="text-[10px] text-text2">
                      {flow.last_run_at
                        ? new Date(flow.last_run_at).toLocaleTimeString()
                        : '—'}
                      {flow.last_run_duration_ms && (
                        <span className="ml-1 text-text3">({fmtDuration(flow.last_run_duration_ms)})</span>
                      )}
                    </div>
                    <div>
                      <button
                        onClick={e => handleTrigger(e, flow)}
                        className="text-[9px] px-2 py-1 rounded border border-border text-text3 hover:border-accent hover:text-accent transition-colors"
                      >
                        ▶ Run
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </Card>
      )}
    </div>
  );
}
