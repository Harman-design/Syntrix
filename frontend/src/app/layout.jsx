// src/app/layout.jsx
import '../styles/globals.css';
import Header from '../components/Header';

export const metadata = {
  title: 'Syntrix — Synthetic Transaction Monitor',
  description: 'Catch failures before your customers do',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Header />
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}
