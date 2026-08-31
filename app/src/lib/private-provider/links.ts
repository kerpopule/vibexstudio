const INVITE_TOKEN = /^[A-Za-z0-9_-]{22,256}$/;

/** Parses only the exact universal-link and visible custom-scheme fallback. */
export function parsePrivateInviteLink(value: string): string | null {
  try {
    const url = new URL(value);
    let token: string | null = null;
    if (url.protocol === 'https:' && url.hostname === 'vibexstudio.com' && url.port === '') {
      const match = url.pathname.match(/^\/connect\/([A-Za-z0-9_-]{22,256})\/?$/);
      token = match?.[1] ?? null;
      if (url.search || url.hash) return null;
    } else if (url.protocol === 'vibex:' && url.hostname === 'connect' && url.pathname === '') {
      token = url.searchParams.get('token');
      if ([...url.searchParams.keys()].some((key) => key !== 'token') || url.hash) return null;
    }
    return token && INVITE_TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}
