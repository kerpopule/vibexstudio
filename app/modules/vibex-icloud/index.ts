/**
 * iCloud Documents container access (Apple platforms only).
 *
 * `icloudDocumentsUrl()` returns the container's Documents/ URL when the
 * device has iCloud Drive on for this app, else null — callers fall back to
 * local storage. Android/web always return null; sync there rides Android
 * Auto Backup today (see docs/SYNC.md).
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule<{
  icloudDocumentsUrl: string | null;
  downloadItem(url: string): Promise<void>;
}>('VibexIcloud');

export function icloudDocumentsUrl(): string | null {
  return native?.icloudDocumentsUrl ?? null;
}

export async function downloadItem(url: string): Promise<void> {
  await native?.downloadItem(url);
}
