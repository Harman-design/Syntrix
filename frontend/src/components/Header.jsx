// src/components/Header.jsx
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useSocket } from '../lib/socket';

export default function Header({ openIncidents = 0 }) {
  const [time,      setTime]      = useState('');
  const [connected, setConnected] = useState(false);
  const pathname = usePathname();

  // Track WS connection state
  useSocket({
    connect:    () => setConnected(true),
    disconnect: () => setConnected(false),
  });

  useEffect(() => {
    // Check initial socket state
    import('../lib/socket').then(({ useSocket: _ }) => setConnected(true)).catch(() => {});
    const t = setInterval(() => {
      const now = new Date();
      setTime(now.toISOString().split('T')[1].slice(0, 8) + ' UTC');
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const nav = [
    { href: '/',          label: 'Dashboard' },
    { href: '/flows',     label: 'Flows'     },
    { href: '/incidents', label: 'Incidents' },
  ];

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-bg2/90 backdrop-blur sticky top-0 z-50">

      {/* Logo + nav */}
      <div className="flex items-center gap-8">
       <div className="flex items-center gap-8">
  <Link href="/" className="flex items-center gap-3 group">
    
    {/* Diamond Logo */}
    <div className="relative w-9 h-9">
      <div className="absolute inset-0 rotate-45 bg-amber-500/20 border border-amber-500/40"></div>
      <div className="absolute inset-1 rotate-45 bg-amber-500/30"></div>

      {/* Waveform SVG */}
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 m-auto w-5 h-5 text-amber-400 z-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="2,12 6,12 8,6 11,18 14,10 16,12 22,12" />
      </svg>
    </div>

    {/* Text Logo */}
    <div className="flex flex-col leading-none">
      <span className="font-sans font-bold text-[17px] tracking-widest">
        <span className="text-gray-200">SYN</span>
        <span className="text-amber-400">TRIX</span>
      </span>

      <span className="text-[9px] tracking-[0.3em] uppercase text-gray-500">
        Business Flow Monitor
      </span>
    </div>

  </Link>
</div>

        <nav className="flex items-center gap-0.5">
          {nav.map(({ href, label }) => {
            const active = href === '/'
              ? pathname === '/'
              : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={clsx(
                'relative px-3 py-1.5 rounded text-[11px] font-medium tracking-wide transition-colors',
                active ? 'text-white bg-border2' : 'text-text2 hover:text-text'
              )}>
                {label}
                {label === 'Incidents' && openIncidents > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red text-white text-[7px] font-bold rounded-full w-3 h-3 flex items-center justify-center">
                    {openIncidents > 9 ? '9+' : openIncidents}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: WS status + clock */}
      <div className="flex items-center gap-5">
        <div className={clsx(
          'flex items-center gap-1.5 text-[9px] font-semibold tracking-[2px] uppercase',
          connected ? 'text-green' : 'text-text3'
        )}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green animate-pulse' : 'bg-text3')} />
          {connected ? 'Live' : 'Offline'}
        </div>
        <span className="text-[11px] text-text2 font-mono tabular-nums">{time}</span>
      </div>
    </header>
  );
}
