// src/components/Charts.jsx
'use client';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { format } from 'date-fns';

const STEP_COLORS = ['#00d4ff','#00e676','#ffca28','#ff8c00','#9d4edd','#ff3d54'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg3 border border-border2 rounded-lg p-3 shadow-xl text-[10px] font-mono min-w-[140px]">
      <div className="text-text3 mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-4" style={{ color: p.color }}>
          <span className="truncate max-w-[90px]">{p.name}</span>
          <span className="font-bold tabular-nums">{p.value != null ? `${p.value}ms` : '—'}</span>
        </div>
      ))}
    </div>
  );
};

// p95 per step over time
export function LatencyChart({ stepMetrics = [] }) {
  // Build unified time-series
  const hourSet = new Set();
  stepMetrics.forEach(({ hourly }) => hourly.forEach(h => hourSet.add(h.hour)));
  const hours = [...hourSet].sort();

  const data = hours.map(hour => {
    const pt = { hour: format(new Date(hour), 'HH:mm') };
    stepMetrics.forEach(({ step, hourly }) => {
      const h = hourly.find(x => x.hour === hour);
      pt[`S${step.position}`] = h?.p95_ms ?? null;
    });
    return pt;
  });

  if (!data.length) return (
    <div className="flex items-center justify-center h-32 text-text3 text-[10px]">
      No metric data yet — runs will populate this
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -15 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2c38" />
        <XAxis dataKey="hour" tick={{ fontSize: 8, fill: '#3a5060', fontFamily: 'IBM Plex Mono' }} />
        <YAxis tick={{ fontSize: 8, fill: '#3a5060', fontFamily: 'IBM Plex Mono' }} tickFormatter={v => `${v}ms`} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 8, fontFamily: 'IBM Plex Mono', color: '#6a8a9a' }}
          formatter={(v, e) => {
            const sm = stepMetrics.find(s => `S${s.step.position}` === v);
            return sm ? sm.step.name.split(' ').slice(0, 3).join(' ') : v;
          }}
        />
        {stepMetrics.map(({ step }, i) => (
          <Line key={step.id} type="monotone" dataKey={`S${step.position}`}
            stroke={STEP_COLORS[i % STEP_COLORS.length]} strokeWidth={1.5}
            dot={false} activeDot={{ r: 3 }} connectNulls name={`S${step.position}`}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Hourly error rate bar chart (SVG, no lib dependency)
export function ErrorRateChart({ flowHourly = [] }) {
  if (!flowHourly.length) return (
    <div className="flex items-center justify-center h-24 text-text3 text-[10px]">No run data yet</div>
  );

  const data = flowHourly.map(h => ({
    hour:      format(new Date(h.hour), 'HH:mm'),
    errorRate: Number(h.total) > 0 ? (Number(h.failed) / Number(h.total)) * 100 : 0,
    total:     Number(h.total),
  }));

  const maxRate = Math.max(...data.map(d => d.errorRate), 10);
  const W = 100, H = 50;
  const bw = W / data.length - 0.5;

  return (
    <svg viewBox={`0 0 ${W} ${H + 12}`} preserveAspectRatio="none" className="w-full" style={{ height: 72 }}>
      {data.map((d, i) => {
        const x  = (i / data.length) * W;
        const bh = Math.max(1, (d.errorRate / maxRate) * H);
        const y  = H - bh;
        const c  = d.errorRate > 50 ? '#ff3d54' : d.errorRate > 10 ? '#ffca28' : '#00d4ff';
        return <rect key={i} x={x} y={y} width={bw} height={bh} fill={c} opacity={0.85} rx={0.5} />;
      })}
      <text x={0}  y={H + 10} fontSize={5} fill="#3a5060" fontFamily="monospace">{data[0]?.hour}</text>
      <text x={W}  y={H + 10} fontSize={5} fill="#3a5060" fontFamily="monospace" textAnchor="end">{data[data.length-1]?.hour}</text>
      <text x={0}  y={7}      fontSize={5} fill="#3a5060" fontFamily="monospace">err%</text>
    </svg>
  );
}
