/**
 * Getting a Media Lab in the first place: which door onboarding offers, which
 * setup method a `?method=` link may open, and what to say when a server
 * answers the pairing probe but refuses the app's real request.
 *
 * Pure, so tests/media-lab-setup.test.ts can cover the copy and the rules.
 * Not to be confused with setup.ts, which answers "what is already connected";
 * this file is about the step before that.
 */

/** The onboarding door that MAKES a Media Lab, for someone who has none yet. */
export interface HostHereDoor {
  title: string;
  body: string;
  /** The local install flow, or the QR door for a computer that can run one. */
  route: string;
}

/**
 * `supported` is whether this build can install and run the local controller —
 * pass canUseLocalController(), the same check the connect screen gates its
 * "On this computer" method with.
 *
 * A phone, a browser tab and a Windows desktop get a card too, not a hidden
 * one: someone with no server still has to learn that hosting is a job for a
 * computer, and where to go once they have set one up. Neither card promises
 * media on day one — the installer brings the background remover and nothing
 * else, so images, video and music wait on engines, an AI, or fal.ai.
 */
export function hostHereDoor(supported: boolean): HostHereDoor {
  return supported
    ? {
        title: 'Set it up on this computer',
        body: 'Installs a Media Lab server here, so this computer runs it and has to stay on. Background removal works as soon as it is installed; images, video and music need engines added later, or a connected AI or fal.ai.',
        route: '/connect-media-lab?method=local',
      }
    : {
        title: 'Set it up on a computer',
        body: 'Installing needs the desktop app on a Mac or a Linux computer. Set it up there, then scan its pairing QR from here.',
        route: '/pair-scan',
      };
}

/** The connect screen's three setup panes. 'tailnet' is a Tailscale network. */
export type SetupMethod = 'local' | 'tailnet' | 'address';

/**
 * The pane a `?method=` link asks for, or null to leave the screen on its
 * usual door list. 'local' is refused where the desktop bridge is missing —
 * that pane's install and "Use this computer" actions are desktop-only, so the
 * link would otherwise land on an empty screen. Links say 'tailscale' because
 * that is the network's name; the pane is called 'tailnet' internally.
 */
export function requestedSetupMethod(param: unknown, localSupported: boolean): SetupMethod | null {
  const value = typeof param === 'string' ? param.trim().toLowerCase() : '';
  if (value === 'local') return localSupported ? 'local' : null;
  if (value === 'tailscale' || value === 'tailnet') return 'tailnet';
  if (value === 'address') return 'address';
  return null;
}

/**
 * True when a failure means the request never reached the server. Every
 * transport failure in the remote modules (remote-library, remote-generation,
 * remote-editing, pair-actions, medialab-cut) opens with this one sentence, so
 * a caller can tell it apart from a refusal the server itself sent back.
 */
export function isUnreachableFailure(message: string): boolean {
  return message.startsWith('Could not reach Media Lab.');
}

/**
 * The origin this app's requests carry, or null when they carry none — native
 * fetch is not origin-checked, so a refusal there is never CORS. Worth naming
 * rather than describing: in the desktop shell it is a Tauri origin that
 * differs per platform (tauri://localhost on macOS and Linux,
 * http://tauri.localhost on Windows), so a server allowed for one desktop
 * refuses the other, and on the web it is whatever site served the app.
 */
export function appBrowserOrigin(): string | null {
  const origin = (globalThis as {location?: {origin?: unknown}}).location?.origin;
  // "null" is the opaque origin a sandboxed or file:// document reports.
  return typeof origin === 'string' && origin && origin !== 'null' ? origin : null;
}

/**
 * What to say when pairing could not reach the server but /manifest.json still
 * answers. That host leaves the one endpoint CORS-open on purpose because it
 * IS the pairing probe, so a probe that succeeds while the real call never
 * left the device points at the server's allowed origins rather than at the
 * network. (A host that gates the probe too fails both calls, and there the
 * ordinary "nothing answered" message is the right one.) Still only the
 * likeliest cause — a request can fail to leave for other reasons — so the
 * wording sends the user to a check, not a verdict. Returns null when there
 * is no browser origin to blame or to name.
 */
export function originRefusalMessage(appOrigin: string | null): string | null {
  if (!appOrigin) return null;
  return `Media Lab answered, but the request was blocked before it left this device. `
    + `That usually means the server does not allow this app: start it with --origin ${appOrigin}, then try again.`;
}
