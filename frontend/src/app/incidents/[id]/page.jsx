'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { getIncident } from '../../../lib/api';
import AIDiagnosis from '../../../components/AIDiagnosis';
import { Card, SectionLabel, StatusPill, Spinner, LatencyValue, fmtDuration } from '../../../components/ui';

const STATUS_LEFT = {
  passed:  'border-l-green',
  failed:  'border-l-red',
  slow:    'border-l-yellow',
  skipped: 'border-l-text3',
};

export default function IncidentDetailPage() {
  const { id }   = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getIncident(id).then(setData).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!data)   return <div className="p-8 text-red text-sm">Incident not found.</div>;

  const { incident, stepResults } = data;
  const durationMs = incident.resolved_at
    ? new Date(incident.resolved_at) - new Date(incident.opened_at)
    : Date.now() - new Date(incident.opened_at);
  const isOpen = incident.status === 'open';

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[10px] text-text3 mb-5">
        <Link href="/" className="hover:text-accent">Dashboard</Link>
        <span>/</span>
        <Link href="/incidents" className="hover:text-accent">Incidents</Link>
        <span>/</span>
        <span className="text-text2 truncate max-w-xs">{incident.title}</span>
      </div>

      {/* Status banner */}
      <div className={clsx(
        'px-5 py-4 rounded-lg border mb-6 flex items-center justify-between',
        isOpen ? 'bg-red/5 border-red/30' : 'bg-green/5 border-green/20'
      )}>
        <div>
          <div className={clsx('text-[10px] font-bold tracking-widest uppercase mb-1',
            isOpen ? 'text-red' : 'text-green')}>
            {isOpen ? '⚠ Active Incident' : '✓ Resolved Incident'}
          </div>
          <div className="font-sans font-bold text-lg text-white">{incident.title}</div>
        </div>
        <div className="text-right">
          <div className={clsx('text-[9px] tracking-widest uppercase font-bold mb-1',
            incident.severity === 'critical' ? 'text-red' : 'text-yellow')}>
            {incident.severity}
          </div>
          <div className="text-[11px] text-text2">{fmtDuration(durationMs)}</div>
        </div>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          ['Flow',       incident.flow_name],
          ['Failed Step', incident.step_position ? `${incident.step_position}. ${incident.step_name}` : '—'],
          ['Opened',     new Date(incident.opened_at).toLocaleString()],
          ['Resolved',   incident.resolved_at ? new Date(incident.resolved_at).toLocaleString() : 'Still open'],
          ['Duration',   fmtDuration(durationMs)],
          ['Severity',   <StatusPill key="s" status={incident.severity} />],
          ['Status',     <StatusPill key="st" status={incident.status} />],
          ['Alerted via', incident.alert_channels?.join(', ') || 'None'],
        ].map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <div className="text-[9px] tracking-widest uppercase text-text3 mb-1.5">{label}</div>
            <div className="text-[12px] text-[#e0eaf5] font-medium">{value}</div>
          </Card>
        ))}
      </div>

      {/* Error detail */}
      {incident.description && (
        <div className="mb-6">
          <SectionLabel className="mb-3">Error Detail</SectionLabel>
          <div className="bg-[#05090d] border border-red/20 border-l-2 border-l-red rounded-lg px-4 py-3">
            <pre className="text-[11px] text-red font-mono whitespace-pre-wrap break-words">
              {incident.description}
            </pre>
          </div>
        </div>
      )}

      {/* Step timeline */}
      {stepResults.length > 0 && (
        <div className="mb-6">
          <SectionLabel className="mb-3">Step Timeline (Failing Run)</SectionLabel>
          <div className="space-y-1.5">
            {stepResults.map(sr => (
              <div key={sr.id} className={clsx(
                'flex items-center gap-3 px-4 py-3 bg-bg2 border border-border rounded-lg border-l-2',
                STATUS_LEFT[sr.status] || 'border-l-border',
                sr.status === 'failed' && 'bg-red/[0.03]'
              )}>
                <div className={clsx(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border font-sans flex-shrink-0',
                  sr.status === 'failed'  ? 'bg-red/10 text-red border-red/30'
                  : sr.status === 'slow'  ? 'bg-yellow/10 text-yellow border-yellow/30'
                  : sr.status === 'skipped' ? 'bg-text3/10 text-text3 border-text3/20'
                  : 'bg-green/10 text-green border-green/30'
                )}>
                  {sr.position}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-[#e0eaf5] font-medium">{sr.step_name}</div>
                  {sr.error && <div className="text-[10px] text-red font-mono mt-0.5 truncate">⚠ {sr.error}</div>}
                  {sr.http_status && <div className="text-[9px] text-text2 mt-0.5">HTTP {sr.http_status}</div>}
                </div>
                <div className="text-right">
                  <LatencyValue ms={sr.latency_ms} thresholdMs={sr.threshold_p95_ms} />
                  <div className="text-[9px] text-text3 mt-0.5">&lt; {sr.threshold_p95_ms}ms p95</div>
                </div>
                <StatusPill status={sr.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Diagnosis */}
      <div className="mb-6">
        <SectionLabel className="mb-3">AI Diagnosis</SectionLabel>
        <AIDiagnosis incidentId={id} />
      </div>

      {/* Links */}
      <div className="flex items-center gap-5">
        <Link href={`/flows/${incident.flow_id}`} className="text-[11px] text-accent hover:underline">
          → View Flow Dashboard
        </Link>
        {incident.run_id && (
          <Link href={`/runs/${incident.run_id}`} className="text-[11px] text-text2 hover:text-accent">
            → View Full Run
          </Link>
        )}
      </div>
    </div>
  );
}
