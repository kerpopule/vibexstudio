import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/instrument-sans';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kerpopule.github.io/vibex';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'VibeXStudio — Enter the X',
  description:
    'A local-first iPhone studio for vibe-coding static web apps. Talk to your own AI provider, preview on the device, publish through your own GitHub Pages. No backend. No telemetry.',
  icons: {
    icon: [{ url: './favicon.png', type: 'image/png' }],
    apple: [{ url: './icon.png', type: 'image/png' }],
  },
  openGraph: {
    title: 'VibeXStudio — Enter the X',
    description:
      'Not a chat window. A working studio. Local-first vibe-coding for the web, from the phone already in your hand.',
    type: 'website',
    images: [{ url: './icon.png', width: 1024, height: 1024 }],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#090A0A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
