import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(import.meta.dirname, '..');
const distRoot = resolve(appRoot, '../desktop/dist');
const appConfig = JSON.parse(readFileSync(resolve(appRoot, 'app.json'), 'utf8')) as {
  expo: { version: string };
};

const requiredFonts = [
  'assets/node_modules/@expo-google-fonts/barlow/400Regular/Barlow_400Regular.9373fb661b5c2954ab84d1b7f42774fe.ttf',
  'assets/node_modules/@expo-google-fonts/barlow/500Medium/Barlow_500Medium.bdffb48240a3383080812d6830ff6f54.ttf',
  'assets/node_modules/@expo-google-fonts/barlow/600SemiBold/Barlow_600SemiBold.29527ab52af2334e2bcb6290c8692f70.ttf',
  'assets/node_modules/@expo-google-fonts/barlow/700Bold/Barlow_700Bold.72871854aabdd7a79c4fc5038cb4faaf.ttf',
  'assets/node_modules/@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.518133df6fcaf4237f97187e2ea1019e.ttf',
  'assets/node_modules/@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.b7bae4f584fc5d817de4178708946eb0.ttf',
  'assets/node_modules/@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.52e5e29a7805a81bac01a170e45d103d.ttf',
  'assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.b4eb097d35f44ed943676fd56f6bdc51.ttf',
];

describe('web release export contract', () => {
  it('ships every font referenced by the generated web payload', () => {
    for (const font of requiredFonts) expect(existsSync(resolve(distRoot, font)), font).toBe(true);
  });

  it('embeds the app release version in the generated web payload', () => {
    const bundleRoot = resolve(distRoot, '_expo/static/js/web');
    const entryName = readdirSync(bundleRoot).find((name) => /^entry-[a-f0-9]+\.js$/.test(name));
    expect(entryName).toBeDefined();
    const entry = readFileSync(resolve(bundleRoot, entryName!), 'utf8');
    expect(entry.includes(appConfig.expo.version)).toBe(true);
  });
});
