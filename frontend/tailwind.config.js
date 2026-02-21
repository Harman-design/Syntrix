/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#080c10',
        bg2:     '#0d1318',
        bg3:     '#111820',
        border:  '#1e2c38',
        border2: '#243340',
        accent:  '#00d4ff',
        green:   '#00e676',
        yellow:  '#ffca28',
        red:     '#ff3d54',
        orange:  '#ff8c00',
        purple:  '#9d4edd',
        text:    '#c8d8e8',
        text2:   '#6a8a9a',
        text3:   '#3a5060',
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'monospace'],
        sans: ['Syne', 'sans-serif'],
      },
      keyframes: {
        blink:   { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.2 } },
        slideIn: { from: { opacity: 0, transform: 'translateY(-8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        scanline:{ from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(2000%)' } },
      },
      animation: {
        blink:    'blink 0.9s ease-in-out infinite',
        slideIn:  'slideIn 0.25s ease',
        scanline: 'scanline 2s linear infinite',
      },
    },
  },
  plugins: [],
};
