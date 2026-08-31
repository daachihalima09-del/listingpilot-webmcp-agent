import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ListingPilot Agent — WebMCP Commerce Copilot',
  description: 'Search, inspect verified Product Truth, and prepare safe listing improvements with a human approval boundary.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
