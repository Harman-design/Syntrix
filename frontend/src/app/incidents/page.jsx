'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { getIncidents } from '../../lib/api';
import { useSocket } from '../../lib/socket';
import { Card, Spinner, Empty, fmtDuration, useToast, ToastArea } from '../../components/ui';

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [filter,    setFilter]    = useState('all');
  const [loading,   setLoading]   = useState(true);
  const { toasts, add: toast } = useToast();

  const load = async (f = filter) => {
    setLoading(true);
    const params = f !== 'all' ? { status: f } : {};
    getIncidents({ ...params, limit: 100 }).then(setIncidents).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  useSocket({
    'incident:opened':   () => { load(); toast('New incident opened', 'err'); },
    'incident:resolved': () => { load(); toast('Incident resolved', 'ok');  },
  });

  function duration(inc) {
    const end = inc.resolved_at ? new Date(inc.resolved_at) : new Date();
    return fmtDuration(end - new Date(inc.opened_at));
  }

  const open     = incidents.filter(i => i.status === 'open').length;
  const resolved = incidents.filter(i => i.status === 'resolved').length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <ToastArea toasts={toasts} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-sans font-bold text-xl text-white mb-1">Incidents</h1>
          <div className="text-[11px] text-text2">{open} open · {resolved} resolved</div>
        </div>
        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-bg2 border border-border rounded-lg p-1">
          {['all', 'open', 'resolved'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx(
                'px-3 py-1.5 rounded text-[10px] font-medium tracking-wide uppercase transition-colors',
                filter === f ? 'bg-border2 text-white' : 'text-text2 hover:text-text'
              )}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : incidents.length === 0 ? (
        <Card className="p-12">
          <Empty message={filter === 'open' ? 'No open incidents 🎉' : 'No incidents found'} icon="✓" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_120px_80px_70px_80px] px-5 py-3 bg-bg3 border-b border-border text-[9px] tracking-widest uppercase text-text3 font-semibold gap-3">
            <div>Flow / Step</div>
            <div>Started</div>
            <div>Duration</div>
            <div>Severity</div>
            <div>Status</div>
          </div>
          {incidents.map(inc => (
            <Link key={inc.id} href={`/incidents/${inc.id}`}>
              <div className="grid grid-cols-[1fr_120px_80px_70px_80px] px-5 py-3.5 border-b border-border hover:bg-white/[0.015] transition-colors items-center gap-3 cursor-pointer">
                <div>
                  <div className="text-[12px] text-[#e0eaf5] font-medium truncate">{inc.title}</div>
                  <div className="text-[9px] text-text2 mt-0.5 truncate">
                    {inc.flow_name} · Step {inc.step_position}: {inc.step_name}
                  </div>
                </div>
                <div className="text-[10px] text-text2 font-mono tabular-nums">
                  {new Date(inc.opened_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                </div>
                <div className="text-[11px] text-text tabular-nums">{duration(inc)}</div>
                <div className={clsx('text-[9px] font-bold tracking-wider uppercase',
                  inc.severity === 'critical' ? 'text-red' : 'text-yellow')}>
                  {inc.severity}
                </div>
                <div>
                  <span className={clsx(
                    'text-[8px] px-2 py-0.5 rounded border font-bold tracking-wider uppercase',
                    inc.status === 'open'
                      ? 'bg-red/10 border-red/25 text-red'
                      : 'bg-green/10 border-green/25 text-green'
                  )}>
                    {inc.status === 'open' ? '● OPEN' : '✓ RESOLVED'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
