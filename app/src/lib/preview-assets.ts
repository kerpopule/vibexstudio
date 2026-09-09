/** Resolve static media references in HTML, script strings, and CSS url().
 * JS string paths are document-relative; CSS paths are stylesheet-relative.
 * This intentionally does not attempt to bundle JavaScript module imports.
 */
export function rewritePreviewAssets(content: string, ownerPath: string, assets: ReadonlyMap<string, string>): string {
  const resolve = (reference: string): string => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return reference;
    const match = reference.match(/^([^?#]+)([?#].*)?$/);
    if (!match) return reference;
    const [, path, suffix = ''] = match;
    const base = /\.(css|json|gltf)$/.test(ownerPath) ? ownerPath.split('/').slice(0, -1) : [];
    const segments = path.startsWith('/') ? [] : [...base];
    for (const encodedPart of path.split('/')) {
      let part: string;
      try { part = decodeURIComponent(encodedPart); } catch { return reference; }
      if (part.includes('/') || part.includes('\\') || part.includes('\0')) return reference;
      if (!part || part === '.') continue;
      if (part === '..') { if (!segments.length) return reference; segments.pop(); }
      else segments.push(part);
    }
    const url = assets.get(segments.join('/'));
    // Queries have no meaning for an immutable preview blob; retain media fragments.
    return url ? url + (suffix.includes('#') ? suffix.slice(suffix.indexOf('#')) : '') : reference;
  };
  let result = content.replace(/(["'`])([^"'`\n]+)\1/g, (whole, quote: string, ref: string) => {
    const mapped = resolve(ref);
    return mapped === ref ? whole : `${quote}${mapped}${quote}`;
  });
  if (ownerPath.endsWith('.css') || ownerPath.endsWith('.html')) {
    result = result.replace(/url\(\s*([^\s'"()]+)\s*\)/g, (whole, ref: string) => {
      const mapped = resolve(ref);
      return mapped === ref ? whole : `url("${mapped}")`;
    });
  }
  return result;
}
