import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/secrets',()=>({getLibraryToken:vi.fn(),setLibraryToken:vi.fn()}));
import { appBrowserOrigin, hostHereDoor, isUnreachableFailure, originRefusalMessage, requestedSetupMethod } from '../src/lib/media-lab-setup';
import { connectRemoteLibrary } from '@/lib/remote-library';

afterEach(()=>vi.unstubAllGlobals());

describe('the onboarding door that creates a Media Lab', () => {
  it('sends a computer that can host one into the local setup flow', () => {
    const door = hostHereDoor(true);
    expect(door.route).toBe('/connect-media-lab?method=local');
    expect(door.body).toContain('Background removal');
  });

  it('still helps a phone or browser instead of offering a door to nowhere', () => {
    const door = hostHereDoor(false);
    // /pair-scan is the QR door: set the server up on a computer, then scan it.
    expect(door.route).toBe('/pair-scan');
    expect(door.body).toMatch(/Mac or a Linux computer/);
  });

  it('promises no media on day one, whichever card is shown', () => {
    for (const door of [hostHereDoor(true), hostHereDoor(false)]) {
      expect(door.body).not.toMatch(/make (images|video|music)/i);
      expect(door.title).toBeTruthy();
    }
    expect(hostHereDoor(true).body).toMatch(/engines added later, or a connected AI or fal\.ai/);
  });
});

describe('the ?method= link the door opens', () => {
  it('lands on the local pane only where the desktop can run a controller', () => {
    expect(requestedSetupMethod('local', true)).toBe('local');
    expect(requestedSetupMethod('local', false)).toBeNull();
  });

  it('accepts the other two panes, under either spelling of the network one', () => {
    expect(requestedSetupMethod('tailscale', false)).toBe('tailnet');
    expect(requestedSetupMethod('tailnet', false)).toBe('tailnet');
    expect(requestedSetupMethod(' ADDRESS ', false)).toBe('address');
  });

  it('falls back to the door list for anything else', () => {
    for (const value of [undefined, '', 'cloud', '/pair-scan', ['local'], 42]) {
      expect(requestedSetupMethod(value, true), String(value)).toBeNull();
    }
  });
});

describe('telling an origin refusal apart from a dead server', () => {
  it('recognises the sentence every transport failure opens with', async () => {
    // The browser drops a cross-origin request the server has not allowed
    // before it leaves the device: fetch rejects, with no status to read.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const failure = await connectRemoteLibrary('https://spark.example', 'test-access-code').then(() => null, (error: Error) => error);
    expect(isUnreachableFailure(failure?.message ?? '')).toBe(true);
  });

  it('leaves refusals the server actually sent alone', () => {
    for (const message of ['No Media Lab answered there. Check the address and server connection.',
      'Enter your Media Lab access code to connect its library.',
      'Media Lab took too long to respond. Refresh the library to try again.',
      'Media Lab could not complete the request (500).']) {
      expect(isUnreachableFailure(message), message).toBe(false);
    }
  });

  it('names the origin the server has to allow, and the flag that allows it', () => {
    const message = originRefusalMessage('http://tauri.localhost');
    expect(message).toContain('--origin http://tauri.localhost');
    // Hedged: a request can fail to leave for reasons other than CORS.
    expect(message).toMatch(/usually/);
  });

  it('says nothing where there is no browser origin to blame', () => {
    // Native fetch is not origin-checked, so CORS is never the cause there.
    expect(originRefusalMessage(null)).toBeNull();
    expect(appBrowserOrigin()).toBeNull();
    vi.stubGlobal('location', {origin: 'null'});
    expect(appBrowserOrigin()).toBeNull();
  });

  it('reads the site or desktop origin when there is one', () => {
    vi.stubGlobal('location', {origin: 'https://studio.example'});
    expect(appBrowserOrigin()).toBe('https://studio.example');
    vi.stubGlobal('location', {origin: 'tauri://localhost'});
    expect(appBrowserOrigin()).toBe('tauri://localhost');
  });
});
