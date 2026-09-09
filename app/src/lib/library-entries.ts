import {listRemoteLibrary} from '@/lib/remote-library';
import {listGallery} from '@/lib/storage/media-gallery';
import type {RemoteLibraryAsset} from '@/lib/library-core';
import type {GalleryItem} from '@/lib/types';

export type LibraryEntry = Omit<GalleryItem, 'kind'> & {
  kind: RemoteLibraryAsset['kind']; remote?: RemoteLibraryAsset;
};

/** Each storage source can fail without hiding creations from the other. */
export async function loadEntries(serverUrl?: string) {
  const [device, server] = await Promise.allSettled([
    listGallery(), serverUrl ? listRemoteLibrary(serverUrl) : Promise.resolve([]),
  ]);
  const local: LibraryEntry[] = device.status === 'fulfilled'
    ? device.value.map(item => ({...item, id:`device-${item.id}`})) : [];
  const remote: LibraryEntry[] = server.status === 'fulfilled'
    ? server.value.map(asset => ({...asset, id:`server-${asset.id}`, uri:'', prompt:asset.title, remote:asset})) : [];
  return {
    items: [...local, ...remote].sort((a,b) => b.createdAt-a.createdAt),
    deviceError: device.status === 'rejected' ? 'Creations on this device could not be loaded. Refresh Library to try again.' : null,
    remoteError: server.status === 'rejected'
      ? server.reason instanceof Error ? server.reason.message : 'The server library is unavailable.' : null,
  };
}

/** Search display titles and original descriptions without reading media bytes. */
export function matchesLibrarySearch(item: LibraryEntry, terms: string[]): boolean {
  const text = [item.prompt, item.remote?.prompt, item.providerLabel, item.remote?.fileName]
    .filter(Boolean).join(' ').toLocaleLowerCase();
  return terms.every(term => text.includes(term));
}
