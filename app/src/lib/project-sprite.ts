import {decodeSpriteExport} from '@/lib/sprite-export';
import type {ProjectFile} from '@/lib/types';

/** Recognize our portable atlas and resolve only a sibling project image. */
export function readProjectSprite(file: ProjectFile, files: ProjectFile[]) {
  if (file.encoding === 'base64' || !file.path.endsWith('.json') || file.content.length > 256 * 1024) return null;
  try {
    const metadata = JSON.parse(file.content);
    const name = metadata?.meta?.image;
    if (metadata?.meta?.app !== 'VibeXStudio' || typeof name !== 'string' ||
        !/^[\w.-]+\.png$/.test(name) || name === '..') return null;
    const path = file.path.slice(0,file.path.lastIndexOf('/')+1)+name;
    const image = files.find(candidate => candidate.path === path && candidate.encoding === 'base64');
    if (!image) return null;
    const decoded = decodeSpriteExport({version:1,pngBase64:image.content,metadata});
    return {image,metadata:decoded.metadata};
  } catch {return null;}
}
export type ProjectSprite = NonNullable<ReturnType<typeof readProjectSprite>>;
