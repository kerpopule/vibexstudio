import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Web-only HTML shell for the static export (never runs on native). Same as
 * expo-router's default, plus a description and `color-scheme` so browser
 * chrome (scrollbars, form controls) follows the visitor's light/dark
 * setting. Per-route <title>s come from the root layout's <Head>.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta
          name="description"
          content="VibeX Studio — build web apps and make media with the AI you already use. Your files stay yours."
        />
        <meta name="color-scheme" content="dark light" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
