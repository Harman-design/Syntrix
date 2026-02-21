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
        <Link href="/" className="flex items-center gap-2.5 group">
          <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
            <path d="M14 2L26 8V20L14 26L2 20V8L14 2Z" stroke="#00d4ff" strokeWidth="1.5" fill="rgba(0,212,255,0.07)"/>
            <path d="M14 7L20 10.5V17.5L14 21L8 17.5V10.5L14 7Z" fill="rgba(0,212,255,0.15)" stroke="#00d4ff" strokeWidth="0.8"/>
            <circle cx="14" cy="14" r="2.5" fill="#00d4ff"/>
          </svg>
          <span className="font-sans font-extrabold text-[16px] text-white tracking-tight leading-none">
            Syn<span className="text-accent">trix</span>
          </span>
        </Link>

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
