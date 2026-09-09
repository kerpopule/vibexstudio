import {File} from 'expo-file-system';
export async function readBundleFile(uri: string): Promise<string> {
  return new File(uri).text();
}
