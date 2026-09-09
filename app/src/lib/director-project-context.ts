import {mimeFor} from '@/lib/media-mime';
import type {ProjectMeta, ProjectFile} from '@/lib/types';

type AssetKind = 'image' | 'video' | 'audio' | 'model';
export interface DirectorProjectContext {
  version: 1;
  projectId: string;
  title: string;
  assets: {path: string; kind: AssetKind}[];
}

/** Metadata only: never read or copy a file's content or the project's credentials. */
export function directorProjectContext(project: Pick<ProjectMeta, 'id' | 'name'>,
  files: Pick<ProjectFile, 'path'>[], selectedPaths?: readonly string[]): DirectorProjectContext {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(project.id) || !project.name || project.name.length > 160) {
    throw new Error('This project name or identity cannot be shared with the director.');
  }
  const available = directorAssets(files);
  const paths = selectedPaths ? [...selectedPaths] : [...available.keys()];
  if (paths.length > 32) throw new Error('Choose up to 32 assets to discuss with Sparky.');
  if (new Set(paths).size !== paths.length) throw new Error('Choose each asset only once.');
  const assets = paths.map(path => {
    const kind = available.get(path);
    if (!kind) throw new Error('A selected asset is no longer in this project. Refresh the file list.');
    if (!path || path.length > 512 || /[\\:\u0000-\u001f\u007f]/.test(path) ||
        path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('An asset does not have a safe relative project path.');
    }
    return {path, kind};
  });
  const context: DirectorProjectContext = {version:1, projectId:project.id, title:project.name, assets};
  // The Python endpoint serializes with ASCII escaping and default separators.
  const ascii = JSON.stringify(context).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
  if (ascii.length + 512 > 32768) throw new Error('Choose fewer assets to keep the director context small.');
  return context;
}

/** Enumerate media metadata for the director picker without reading file contents. */
export function directorAssets(files: Pick<ProjectFile, 'path'>[]): Map<string, AssetKind> {
  const available = new Map<string, AssetKind>();
  for (const file of files) {
    const mime = mimeFor(file.path);
    const kind = mime.split('/')[0];
    if (!['image', 'video', 'audio', 'model'].includes(kind)) continue;
    if (available.has(file.path)) throw new Error('The project contains duplicate asset paths.');
    available.set(file.path, kind as AssetKind);
  }
  return available;
}

/** Follow new imports only while the user has not chosen a specific subset. */
export function refreshDirectorSelection(paths: readonly string[], previous: readonly string[] | null,
  manuallySelected: boolean): string[] {
  if (!manuallySelected && paths.length <= 32) return [...paths];
  return (previous ?? []).filter(path => paths.includes(path));
}
