/**
 * Generates the static share page that gets pushed to the user's repo at
 * `s/index.html` and served from their GitHub Pages site.
 *
 * Opening the page tries the vibex:// deep link so the receiver's
 * VibeXStudio app imports the repo; if the app isn't installed, after a short
 * delay it falls back to the appropriate app store. The page is fully static
 * and runs on the user's own Pages site — VibeXStudio itself hosts nothing.
 */

export const APP_STORE_URL = 'https://apps.apple.com/app/vibexstudio/id6779501769';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=studio.vibex.app';

/**
 * Public "get the app / how to open a .vibex" landing page, sent alongside
 * shared bundles for recipients who don't have VibeXStudio yet.
 */
export const GET_APP_URL = 'https://vibexstudio.com/';

export function buildImportDeepLink(owner: string, repo: string, branch: string): string {
  const params = new URLSearchParams({ repo: `${owner}/${repo}`, ref: branch });
  return `vibex://import?${params.toString()}`;
}

export function renderSharePage(opts: {
  owner: string;
  repo: string;
  branch: string;
  appName: string;
  appEmoji: string;
}): string {
  const deepLink = buildImportDeepLink(opts.owner, opts.repo, opts.branch);
  const webUrl = `https://${opts.owner}.github.io/${opts.repo}/`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.appName)} — VibeXStudio</title>
<meta property="og:title" content="${escapeHtml(opts.appName)}">
<meta property="og:description" content="Open this app in VibeXStudio">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0b0014;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
  .card{padding:32px;max-width:420px}
  .emoji{font-size:64px}
  h1{font-size:28px;margin:12px 0 4px}
  p{color:#b0b4ba;line-height:1.5}
  a.btn{display:block;margin:10px auto;padding:14px 24px;border-radius:14px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;max-width:280px}
  a.alt{background:#212225}
</style>
</head>
<body>
<div class="card">
  <div class="emoji">${escapeHtml(opts.appEmoji)}</div>
  <h1>${escapeHtml(opts.appName)}</h1>
  <p>This app was made with VibeXStudio. Opening it in the app…</p>
  <a class="btn" id="open" href="${deepLink}">Open in VibeXStudio</a>
  <a class="btn alt" id="store" href="#" style="display:none">Get VibeXStudio</a>
  <a class="btn alt" href="${webUrl}">View on the web</a>
</div>
<script>
  var ua = navigator.userAgent || '';
  var storeUrl = /android/i.test(ua) ? ${JSON.stringify(PLAY_STORE_URL)} : ${JSON.stringify(APP_STORE_URL)};
  var storeBtn = document.getElementById('store');
  storeBtn.href = storeUrl;
  function tryOpen() {
    var t = Date.now();
    window.location.href = ${JSON.stringify(deepLink)};
    setTimeout(function () {
      // If the page is still visible after the timeout, the app likely isn't installed.
      if (!document.hidden && Date.now() - t < 2500) {
        storeBtn.style.display = 'block';
        window.location.href = storeUrl;
      }
    }, 1800);
  }
  if (/android|iphone|ipad|ipod/i.test(ua)) tryOpen();
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
