import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { fontVariables } from './fonts';
import { ThemeScript } from '@/components/theme/theme-script';
import { getAppearanceTheme } from '@/server/api';
import './globals.css';

export const metadata: Metadata = {
  title: 'Superagent',
  description: 'Personal agentic assistant',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0d10' },
    { media: '(prefers-color-scheme: light)', color: '#f6f8fa' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request: the saved theme is authoritative (no build-time DB read).
  await connection();
  const serverTheme = await getAppearanceTheme();
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <ThemeScript serverTheme={serverTheme} />
      </head>
      <body className={fontVariables}>{children}</body>
    </html>
  );
}
