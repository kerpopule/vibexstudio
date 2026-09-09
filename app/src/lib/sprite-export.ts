/** Validate the portable atlas response before writing it into a project. */
export function decodeSpriteExport(value: unknown) {
  const fail = (): never => { throw new Error('The server returned an invalid sprite atlas.'); };
  if (!value || typeof value !== 'object') return fail();
  const data = value as Record<string, any>;
  if (data.version !== 1 || typeof data.pngBase64 !== 'string' || data.pngBase64.length > 32 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data.pngBase64)) return fail();
  let binary: string;
  try { binary = atob(data.pngBase64); } catch { return fail(); }
  const png = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (png.length < 24 || [137,80,78,71,13,10,26,10].some((byte, index) => png[index] !== byte)) return fail();
  const meta = data.metadata?.meta;
  const order: unknown = meta?.frameOrder;
  const integer = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 8192;
  if (!integer(meta?.size?.w) || !integer(meta?.size?.h) || !meta.size.w || !meta.size.h ||
      !Array.isArray(order) || !order.length || order.length > 64 || new Set(order).size !== order.length) return fail();
  const view = new DataView(png.buffer);
  if (view.getUint32(16) !== meta.size.w || view.getUint32(20) !== meta.size.h) return fail();
  const frames: Record<string, unknown> = {};
  for (const name of order) {
    if (typeof name !== 'string' || !/^frame-\d{3}\.png$/.test(name)) return fail();
    const row = data.metadata?.frames?.[name];
    if (!row || row.rotated !== false || typeof row.trimmed !== 'boolean' || typeof row.empty !== 'boolean') return fail();
    for (const box of [row.frame, row.spriteSourceSize]) {
      if (!box || !['x','y','w','h'].every((key) => integer(box[key])) || !box.w || !box.h) return fail();
    }
    if (!integer(row.sourceSize?.w) || !integer(row.sourceSize?.h) || !row.sourceSize.w || !row.sourceSize.h ||
        row.frame.x + row.frame.w > meta.size.w || row.frame.y + row.frame.h > meta.size.h ||
        row.spriteSourceSize.x + row.spriteSourceSize.w > row.sourceSize.w ||
        row.spriteSourceSize.y + row.spriteSourceSize.h > row.sourceSize.h ||
        row.frame.w !== row.spriteSourceSize.w || row.frame.h !== row.spriteSourceSize.h ||
        !['x','y'].every((key) => typeof row.pivot?.[key] === 'number' && Number.isFinite(row.pivot[key]) && row.pivot[key] >= 0 && row.pivot[key] <= 1)) return fail();
    // Copy only the atlas contract, never arbitrary server text or URLs.
    const box = (b: Record<string, number>) => ({x:b.x,y:b.y,w:b.w,h:b.h});
    frames[name] = {frame:box(row.frame),spriteSourceSize:box(row.spriteSourceSize),
      sourceSize:{w:row.sourceSize.w,h:row.sourceSize.h},pivot:{x:row.pivot.x,y:row.pivot.y},
      rotated:false,trimmed:row.trimmed,empty:row.empty};
  }
  return {png, metadata:{frames, meta:{app:'VibeXStudio',version:'1',image:'atlas.png',format:'RGBA8888',
    size:{w:meta.size.w,h:meta.size.h},scale:'1',frameOrder:order as string[]}}};
}
