import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(appRoot, path), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('static web export hydrates without a mismatch (React #418)', () => {
  it('reads the window size through the hydration-safe hook', () => {
    const offenders = sources(resolve(appRoot, 'src'))
      .filter((file) => !file.includes(`${join('src', 'hooks', 'use-window-dimensions')}`))
      .filter((file) => /import\s*\{[^}]*\buseWindowDimensions\b[^}]*\}\s*from\s*'react-native'/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(appRoot, file));
    expect(offenders).toEqual([]);
    expect(read('src/hooks/use-window-dimensions.web.ts')).toContain('useHasHydrated()');
  });

  it('registers the icon font in the root so the static render draws icons too', () => {
    expect(read('src/app/_layout.tsx')).toMatch(/\.\.\.Ionicons\.font/);
  });

  it('shows the visitor path on the 404 only after hydration', () => {
    expect(read('src/app/+not-found.tsx')).toContain('hasHydrated ?');
  });
});

describe('device copy', () => {
  it('says "this device" on the web build, which also runs on phones', () => {
    expect(read('src/lib/device.ts')).toMatch(/thisDevice = Platform\.select\(\{[^}]*web: 'this device'/);
  });
});
