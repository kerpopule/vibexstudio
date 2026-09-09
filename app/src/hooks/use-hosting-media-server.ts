import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { probeMediaHost } from '@/lib/media-host-probe';
import { normalizeServerUrl } from '@/lib/media-pairing';

/** Suggest the host only after it advertises the integrated Studio contract. */
export function useHostingMediaServer(): string | null {
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = normalizeServerUrl(window.location.origin);
    if (!url) return;
    let active = true;
    void probeMediaHost(url).then((host) => {
      if (active && host?.integratedStudio && host.editingDrafts) setServer(url);
    });
    return () => { active = false; };
  }, []);
  return server;
}
