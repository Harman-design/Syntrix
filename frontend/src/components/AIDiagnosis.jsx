// frontend/src/components/AIDiagnosis.jsx
// Drop this into the incident detail page — shows Claude's analysis of the incident.
'use client';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import api from '../lib/api';

const SEV_COLOR = { P1: 'text-red', P2: 'text-yellow', P3: 'text-green' };
const SEV_BG    = { P1: 'bg-red/10 border-red/30', P2: 'bg-yellow/10 border-yellow/30', P3: 'bg-green/10 border-green/30' };

function Section({ title, color = 'text-text3', children }) {
  return (
    <div>
      <div className={clsx('text-[9px] tracking-[2px] uppercase font-bold mb-2', color)}>{title}</div>
      {children}
    </div>
  );
}

export default function AIDiagnosis({ incidentId }) {
  const [diagnosis, setDiagnosis] = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [cached,    setCached]    = useState(false);

  // Check for cached diagnosis on mount
  useEffect(() => {
    api.get(`/api/ai/diagnose/${incidentId}`)
      .then(({ data }) => {
        if (data.diagnosis) {
          setDiagnosis(data.diagnosis);
          setCached(true);
        }
      })
      .catch(() => {});
  }, [incidentId]);

  async function diagnose() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/api/ai/diagnose/${incidentId}`);
      setDiagnosis(data.diagnosis);
      setCached(false);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-bg2 border border-border rounded-lg overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-bg3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
            <path d="M14 2L26 8V20L14 26L2 20V8L14 2Z" stroke="#9d4edd" strokeWidth="1.5" fill="rgba(157,78,221,0.1)"/>
            <circle cx="14" cy="14" r="3" fill="#9d4edd"/>
          </svg>
          <span className="text-[10px] text-purple font-bold tracking-[2px] uppercase">Claude AI Diagnosis</span>
          {cached && <span className="text-[8px] text-text3 border border-border px-1.5 py-0.5 rounded">cached</span>}
        </div>

        <button
          onClick={diagnose}
          disabled={loading}
          className={clsx(
            'flex items-center gap-2 px-4 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase transition-all',
            loading
              ? 'bg-border text-text3 cursor-not-allowed'
              : diagnosis
              ? 'border border-purple/40 text-purple hover:bg-purple/10'
              : 'bg-purple text-white hover:bg-[#b060ff]'
          )}
        >
          {loading ? (
            <>
              <span className="w-3 h-3 border border-text3 border-t-purple rounded-full animate-spin" />
              Analyzing…
            </>
          ) : diagnosis ? '↺ Re-diagnose' : '⬡ Diagnose with AI'}
        </button>
      </div>

      {/* Body */}
      <div className="p-5">

        {/* Empty state */}
        {!diagnosis && !loading && !error && (
          <div className="text-center py-8">
            <div className="text-3xl mb-3 opacity-20">⬡</div>
            <div className="text-[11px] text-text2 mb-1">Claude will analyze this incident and tell you:</div>
            <div className="text-[10px] text-text3 leading-relaxed">
              Root cause · Likely culprits · Exact fix steps · Who to page · Blast radius
            </div>
            <button
              onClick={diagnose}
              className="mt-5 px-6 py-2.5 bg-purple text-white rounded font-bold text-[11px] tracking-widest uppercase hover:bg-[#b060ff] transition-colors"
            >
              ⬡ Run AI Diagnosis
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-6 space-y-3">
            {['Reading step results and error logs…', 'Identifying root cause pattern…', 'Generating fix recommendations…'].map((msg, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-purple animate-pulse flex-shrink-0"
                  style={{ animationDelay: `${i * 0.25}s` }} />
                <span className="text-[10px] text-text2">{msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="py-4 px-4 bg-red/5 border border-red/20 rounded-lg text-[11px] text-red">
            {error.includes('ANTHROPIC_API_KEY')
              ? <>Add <code className="bg-red/10 px-1 rounded">ANTHROPIC_API_KEY=sk-ant-...</code> to <code className="bg-red/10 px-1 rounded">backend/.env</code> then restart the backend.</>
              : error}
          </div>
        )}

        {/* Diagnosis result */}
        {diagnosis && !loading && (
          <div className="space-y-5">

            {/* Root cause */}
            <div className="px-4 py-3.5 bg-red/[0.04] border border-red/20 border-l-2 border-l-red rounded-lg">
              <div className="text-[9px] text-red font-bold tracking-[2px] uppercase mb-2">Root Cause</div>
              <div className="text-[13px] text-white font-semibold leading-relaxed mb-2">{diagnosis.rootCause}</div>
              <div className="text-[11px] text-text leading-relaxed">{diagnosis.explanation}</div>
            </div>

            {/* Meta grid */}
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Severity',   diagnosis.severity,              SEV_COLOR[diagnosis.severity] || 'text-text'],
                ['Fix Time',   diagnosis.estimatedFixTime,      'text-accent'],
                ['Confidence', diagnosis.confidence?.toUpperCase(), 'text-text2'],
              ].map(([label, val, color]) => (
                <div key={label} className="bg-bg3 border border-border rounded-lg px-4 py-3">
                  <div className="text-[9px] text-text3 tracking-widest uppercase mb-1.5">{label}</div>
                  <div className={clsx('font-sans font-bold text-base', color)}>{val || '—'}</div>
                </div>
              ))}
            </div>

            {/* Blast radius */}
            <div className="px-4 py-3 bg-yellow/[0.03] border border-yellow/20 rounded-lg">
              <div className="text-[9px] text-yellow font-bold tracking-[2px] uppercase mb-1.5">Blast Radius</div>
              <div className="text-[11px] text-text">{diagnosis.blastRadius}</div>
              {diagnosis.shouldPage && (
                <div className="mt-2 text-[10px] text-red font-semibold">
                  ⚠ Page on-call: {diagnosis.pageWho}
                </div>
              )}
            </div>

            {/* Culprits */}
            <Section title="Likely Culprits" color="text-red">
              <div className="space-y-1.5">
                {diagnosis.likelyCulprits?.map((c, i) => (
                  <div key={i} className="flex gap-2.5 text-[11px] text-text">
                    <span className="text-red flex-shrink-0 mt-0.5">→</span>{c}
                  </div>
                ))}
              </div>
            </Section>

            {/* Immediate actions */}
            <Section title="Immediate Actions" color="text-green">
              <div className="space-y-2">
                {diagnosis.immediateActions?.map((a, i) => (
                  <div key={i} className="flex gap-3 bg-bg3 border border-border rounded-lg px-3.5 py-2.5">
                    <span className="font-sans font-bold text-green text-[13px] flex-shrink-0 leading-none mt-0.5">{i+1}</span>
                    <span className="text-[11px] text-text leading-relaxed">{a}</span>
                  </div>
                ))}
              </div>
            </Section>

            {/* Prevention */}
            <Section title="Prevention" color="text-accent">
              <div className="space-y-1.5">
                {diagnosis.preventionSteps?.map((p, i) => (
                  <div key={i} className="flex gap-2.5 text-[11px] text-text2">
                    <span className="text-accent flex-shrink-0">◆</span>{p}
                  </div>
                ))}
              </div>
            </Section>

          </div>
        )}
      </div>
    </div>
  );
}
