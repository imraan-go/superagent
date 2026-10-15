import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Nav } from '../components/nav';

export const metadata: Metadata = { title: 'Superagent', description: 'Personal agentic assistant' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav>{children}</Nav>
      </body>
    </html>
  );
}
