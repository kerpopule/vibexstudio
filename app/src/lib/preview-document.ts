import { mimeFor } from '@/lib/media-mime';

type PreviewFile = {path: string; content: string; encoding?: string};

// This code runs inside the opaque-origin iframe. Creating resources here keeps
// fetch(JSON/GLB) and canvas image reads in the game's own security context.
// Keep static-path semantics in sync with preview-assets.ts (tested together).
export const PREVIEW_BOOTSTRAP = String.raw`
(function(files) {
  var urls = new Map();
  function rewrite(content, owner) {
    function resolve(reference) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return reference;
      var match = reference.match(/^([^?#]+)([?#].*)?$/);
      if (!match) return reference;
      var path = match[1], suffix = match[2] || '';
      var parts = /\.(?:css|json|gltf)$/.test(owner) ? owner.split('/').slice(0,-1) : [];
      if (path.startsWith('/')) parts = [];
      for (var encodedPart of path.split('/')) {
        var part;
        try { part = decodeURIComponent(encodedPart); } catch (_) { return reference; }
        if (part.includes('/') || part.includes('\\') || part.includes('\0')) return reference;
        if (!part || part === '.') continue;
        if (part === '..') { if (!parts.length) return reference; parts.pop(); }
        else parts.push(part);
      }
      var url = urls.get(parts.join('/'));
      return url ? url + (suffix.includes('#') ? suffix.slice(suffix.indexOf('#')) : '') : reference;
    }
    var output = content.replace(/(["'\x60])([^"'\x60\n]+)\1/g, function(all, quote, ref) {
      var mapped = resolve(ref);
      return mapped === ref ? all : quote + mapped + quote;
    });
    if (/\.(?:css|html)$/.test(owner)) output = output.replace(/url\(\s*([^\s'"()]+)\s*\)/g, function(all, ref) {
      var mapped = resolve(ref);
      return mapped === ref ? all : 'url("' + mapped + '")';
    });
    return output;
  }
  function create(file, content) {
    if (file.binary) {
      var raw = atob(content), bytes = new Uint8Array(raw.length);
      for (var i=0; i<raw.length; i++) bytes[i] = raw.charCodeAt(i);
      content = bytes;
    }
    urls.set(file.path, URL.createObjectURL(new Blob([content], {type:file.mime})));
  }
  var index = files.find(function(file) {return file.path === 'index.html';});
  var others = files.filter(function(file) {return file !== index;});
  others.filter(function(file) {return file.binary;}).forEach(function(file) {create(file,file.content);});
  // JSON must resolve its image references before scripts resolve their JSON
  // requests. This order is independent of storage insertion/file-name order.
  var text = others.filter(function(file) {return !file.binary;});
  function rank(file) {return /\.(?:json|gltf)$/.test(file.path) ? 0 : /\.css$/.test(file.path) ? 1 : 2;}
  text.sort(function(a,b) {return rank(a)-rank(b);});
  text.forEach(function(file) {create(file,rewrite(file.content,file.path));});
  var html = rewrite(index.content,'index.html');
  document.open();
  document.write(html);
  document.close();
})`;

export function buildPreviewDocument(files: PreviewFile[], isBinary: (path: string) => boolean): string | null {
  if (!files.some((file) => file.path === 'index.html')) return null;
  const payload = files.map((file) => ({...file, mime:mimeFor(file.path),
    binary:file.encoding === 'base64' || (!file.encoding && isBinary(file.path))}));
  // Project HTML cannot close the bootstrap script and execute in a different
  // order. It is parsed only by document.write inside the existing sandbox.
  const encoded = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' + PREVIEW_BOOTSTRAP + '(' + encoded + ');</script></body></html>';
}
