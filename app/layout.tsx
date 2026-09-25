import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin', 'vietnamese'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'GEX levels',
  description: 'GEX, DEX, vanna, charm và IV trên dữ liệu option CBOE (trễ ~15 phút)',
};
export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#0b0f16' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
