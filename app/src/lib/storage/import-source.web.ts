/** Browser File pickers use blob URLs; gallery assets may use data URLs. */
export async function readImportSource(uri: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(uri, {signal});
  if (!response.ok) throw new Error(`Could not download asset (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
