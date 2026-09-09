import type {LibraryEntry} from '@/lib/library-entries';

export function entryFolder(item: LibraryEntry): string {
  return item.remote ? item.remote.folder || 'Server library' : 'This device';
}
export function inLibraryFolder(item: LibraryEntry, folder: string): boolean {
  const path = entryFolder(item);
  return !folder || path === folder || path.startsWith(folder + '/');
}
export function childLibraryFolders(items: LibraryEntry[], parent: string): {path:string;label:string;count:number}[] {
  const children = new Map<string, number>();
  for (const item of items) {
    const path = entryFolder(item);
    if (parent && !path.startsWith(parent + '/')) continue;
    const part = path.slice(parent ? parent.length + 1 : 0).split('/')[0];
    if (!part) continue;
    const child = parent ? parent + '/' + part : part;
    children.set(child, (children.get(child) || 0) + 1);
  }
  return [...children].map(([path,count])=>({path,label:path.split('/').pop()!,count}))
    .sort((a,b)=>a.label.localeCompare(b.label));
}
