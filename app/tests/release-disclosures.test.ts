import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_STORE_URL, GET_APP_URL } from '@/lib/github/sharePage';

const repoRoot = resolve(import.meta.dirname, '..');
const easConfig = JSON.parse(readFileSync(resolve(repoRoot, 'eas.json'), 'utf8')) as {
  cli: { appVersionSource: string };
  build: { production: { autoIncrement?: boolean } };
};
const appConfig = JSON.parse(readFileSync(resolve(repoRoot, 'app.json'), 'utf8')) as {
  expo: {
    version: string;
    ios: {
      buildNumber: string;
      associatedDomains: string[];
      usesIcloudStorage?: boolean;
      entitlements?: Record<string, string[]>;
      infoPlist: Record<string, unknown>;
      privacyManifests: Record<string, unknown>;
    };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};


function pluginOptions(name: string): Record<string, unknown> {
  const entry = appConfig.expo.plugins.find(
    (plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === name
  );
  if (!entry) throw new Error(`Missing ${name} plugin configuration.`);
  return entry[1];
}

describe('iOS release disclosure contract', () => {
  it('pins the release Expo version to 1.2.0 (27)', () => {
    expect(appConfig.expo.version).toBe('1.2.0');
    expect(appConfig.expo.ios.buildNumber).toBe('27');
    expect(easConfig.cli.appVersionSource).toBe('local');
    expect(easConfig.build.production.autoIncrement).toBe(false);
  });

  it('ships only the universal-link entitlement provisioned for the first release', () => {
    const projectsStorage = readFileSync(resolve(repoRoot, 'src/lib/storage/projects.ts'), 'utf8');
    const shippingTypes = readFileSync(resolve(repoRoot, 'src/lib/types.ts'), 'utf8');

    expect(appConfig.expo.ios.associatedDomains).toEqual(['applinks:vibexstudio.com']);
    expect(appConfig.expo.ios.usesIcloudStorage).not.toBe(true);
    expect(appConfig.expo.ios.entitlements).toBeUndefined();
    expect(projectsStorage).not.toMatch(/icloud|cloudSyncActive|migrateLocalProjectsToCloud/i);
    expect(`${projectsStorage}\n${shippingTypes}`).not.toMatch(/refero|DesignReference|designReference/);
    expect(existsSync(resolve(repoRoot, 'modules/vibex-icloud'))).toBe(false);
    expect(appConfig.expo.plugins.some((plugin) =>
      plugin === 'expo-notifications' || (Array.isArray(plugin) && plugin[0] === 'expo-notifications')
    )).toBe(false);
    expect(appConfig.expo.plugins).toContain('./plugins/with-local-notifications-only');
    expect(pluginOptions('expo-secure-store').faceIDPermission).toBe(false);
    expect(appConfig.expo.ios.infoPlist.UIApplicationSupportsIndirectInputEvents).toBe(true);
  });

  it('declares optional broker collection without tracking in the app privacy manifest', () => {
    const privacyManifest = JSON.stringify(appConfig.expo.ios.privacyManifests);
    expect(privacyManifest).toContain('NSPrivacyCollectedDataTypeDeviceID');
    expect(privacyManifest).toContain('NSPrivacyCollectedDataTypeProductInteraction');
    expect(privacyManifest).toContain('NSPrivacyCollectedDataTypeOtherUserContent');
    expect(privacyManifest).toContain('NSPrivacyCollectedDataTypePurposeAppFunctionality');
    expect(appConfig.expo.ios.privacyManifests.NSPrivacyTracking).toBe(false);
  });

  it('keeps first-release Apple sync claims out of shipping configuration and copy', () => {
    const releaseSurfaces = [
      JSON.stringify(appConfig),
      readFileSync(resolve(repoRoot, 'README.md'), 'utf8'),
      readFileSync(resolve(repoRoot, 'PRIVACY.md'), 'utf8'),
      readFileSync(resolve(repoRoot, 'docs/store-listing.md'), 'utf8'),
      readFileSync(resolve(repoRoot, 'src/app/onboarding.tsx'), 'utf8'),
      readFileSync(resolve(repoRoot, 'src/app/(tabs)/settings.tsx'), 'utf8'),
      readFileSync(resolve(repoRoot, 'src/app/new-project.tsx'), 'utf8'),
    ].join('\n');

    expect(releaseSurfaces).not.toMatch(/icloud|CloudDocuments|ubiquity/i);
  });

  it('uses a build number newer than the rejected TestFlight build 25', () => {
    expect(Number(appConfig.expo.ios.buildNumber)).toBeGreaterThan(25);
  });

  it('does not promise speech recognition is on-device when runtime does not enforce it', () => {
    const plistCopy = String(appConfig.expo.ios.infoPlist.NSSpeechRecognitionUsageDescription);
    const pluginCopy = String(pluginOptions('expo-speech-recognition').speechRecognitionPermission);

    expect(plistCopy).toBe('VibeXStudio uses speech recognition to turn your voice into prompts.');
    expect(pluginCopy).toBe(plistCopy);
    expect(plistCopy).not.toMatch(/on[- ]device/i);
  });

  it('keeps source-held App Store URLs and optional broker disclosure explicit', () => {
    const listing = readFileSync(resolve(repoRoot, 'docs/store-listing.md'), 'utf8');

    expect(listing).toContain('Privacy Policy URL: https://github.com/kerpopule/vibexstudio/blob/main/PRIVACY.md');
    expect(listing).toContain('Support URL: https://github.com/kerpopule/vibexstudio');
    expect(listing).toContain('Marketing URL: https://vibexstudio.com');
    expect(APP_STORE_URL).toBe('https://apps.apple.com/app/vibexstudio/id6779501769');
    expect(GET_APP_URL).toBe('https://vibexstudio.com/');
    expect(listing).toContain('Private VibeX invite');
    expect(listing).toContain('routes prompts and generated output through the disclosed private broker');
    expect(listing).not.toContain('No servers, no analytics, no telemetry — the app has no backend.');
  });

  it('ships a privacy policy that describes every release-critical data route', () => {
    const privacy = readFileSync(resolve(repoRoot, 'PRIVACY.md'), 'utf8');
    const normalized = privacy.toLowerCase();

    for (const disclosure of [
      'automated ai solutions llc',
      'ai providers',
      'private vibex',
      'github',
      'microphone',
      'speech recognition',
      'local network',
    ]) {
      expect(normalized).toContain(disclosure);
    }
  });

  it('keeps live Refero content outside the first-release router and source graph', () => {
    const tabLayout = readFileSync(resolve(repoRoot, 'src/app/(tabs)/_layout.tsx'), 'utf8');
    const newProject = readFileSync(resolve(repoRoot, 'src/app/new-project.tsx'), 'utf8');
    const chatView = readFileSync(resolve(repoRoot, 'src/components/project/chat-view.tsx'), 'utf8');
    const onboarding = readFileSync(resolve(repoRoot, 'src/app/onboarding.tsx'), 'utf8');

    expect(existsSync(resolve(repoRoot, 'src/app/(tabs)/templates.tsx'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'dormant/refero/templates.tsx'))).toBe(true);
    expect(tabLayout).not.toContain('name="templates"');
    expect(newProject).not.toMatch(/Refero|\/(?:\(tabs\)\/)?templates/i);
    expect(chatView).not.toMatch(/Refero|\/(?:\(tabs\)\/)?templates/i);
    expect(onboarding).not.toMatch(/Refero|Templates/i);
    expect(existsSync(resolve(repoRoot, 'src/lib/design/refero-catalog.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'src/lib/design/refero-capture.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'src/lib/design/refero-media-policy.ts'))).toBe(false);
  });

  it('keeps shared iPhone and iPad copy device-neutral', () => {
    const projectsScreen = readFileSync(resolve(repoRoot, 'src/app/(tabs)/index.tsx'), 'utf8');
    const deviceCopy = readFileSync(resolve(repoRoot, 'src/lib/device.ts'), 'utf8');
    const sharedScreens = [
      'src/app/agent-connect.tsx',
      'src/app/connect-github.tsx',
      'src/app/connect-provider.tsx',
      'src/app/fal-setup.tsx',
      'src/app/onboarding.tsx',
      'src/app/(tabs)/settings.tsx',
    ].map((path) => readFileSync(resolve(repoRoot, path), 'utf8')).join('\n');

    expect(projectsScreen).toContain('Build, remix, preview, and publish real web apps from your device.');
    expect(projectsScreen).toContain('come to life — right on your device. Everything stays on your');
    expect(projectsScreen).not.toContain('from {yourDevice}');
    expect(projectsScreen).not.toContain('on {yourDevice}');
    expect(deviceCopy).toContain("ios: 'your device'");
    expect(deviceCopy).toContain("ios: 'this device'");
    expect(deviceCopy).toContain("ios: 'device'");
    expect(sharedScreens).not.toMatch(/this phone|your phone|for the phone|on the phone/i);
    expect(appConfig.expo.ios.infoPlist.NSLocalNetworkUsageDescription).toContain('this device');
  });

  it('keeps source guidance aligned with the optional disclosed broker and resolved store URL', () => {
    const guidance = readFileSync(resolve(repoRoot, 'HANDOFF.md'), 'utf8');

    expect(guidance).not.toContain('APP_STORE_URL still a dummy id');
    expect(guidance).not.toContain('No backend, ever');
    expect(guidance).not.toContain('Hard product principle: no backend, ever');
    expect(guidance).toContain('optional Private VibeX');
  });

  it('keeps generated user-facing guidance device-neutral', () => {
    const prompt = readFileSync(resolve(repoRoot, 'src/lib/ai/prompts.ts'), 'utf8');
    const githubSync = readFileSync(resolve(repoRoot, 'src/lib/github/sync.ts'), 'utf8');
    const agentInvite = readFileSync(resolve(repoRoot, 'src/lib/agent-connect/invite.ts'), 'utf8');
    const generatedGuidance = [prompt, githubSync, agentInvite].join('\n');

    expect(generatedGuidance).not.toMatch(/from their phone|work on a phone|user's phone|the phone and|put the phone|on a phone/i);
  });

  it('never requests notification authorization from launch or foreground effects', () => {
    const rootLayout = readFileSync(resolve(repoRoot, 'src/app/_layout.tsx'), 'utf8');
    const notifications = readFileSync(resolve(repoRoot, 'src/lib/notifications.ts'), 'utf8');
    const chatEngine = readFileSync(resolve(repoRoot, 'src/lib/chat-engine.ts'), 'utf8');
    const mediaStudio = readFileSync(resolve(repoRoot, 'src/lib/media-studio.ts'), 'utf8');

    expect(rootLayout).not.toContain('nudgeForPermission');
    expect(rootLayout).not.toContain('requestPermissionsAsync');
    expect(notifications.match(/requestPermissionsAsync/g)).toHaveLength(1);
    expect(chatEngine).toContain('primeNotifications().catch(() => {});');
    expect(mediaStudio).toContain('primeNotifications().catch(() => {});');
  });
});
