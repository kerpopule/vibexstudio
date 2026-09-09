import { File } from 'expo-file-system';

/** Native pickers return file/content URIs, which browser fetch cannot read. */
export async function readImportSource(uri: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (/^(file|content):/i.test(uri)) return new File(uri).bytes();
  const response = await fetch(uri, {signal});
  if (!response.ok) throw new Error(`Could not download asset (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
