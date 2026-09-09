/** Browser document pickers return data or blob URLs, not native file paths. */
export async function readBundleFile(uri: string): Promise<string> {
  if (!/^(blob:|data:)/i.test(uri)) throw new Error('Choose a local .vibex file using the file picker.');
  const response = await fetch(uri);
  if (!response.ok) throw new Error('The selected file could not be read. Choose it again.');
  return response.text();
}
