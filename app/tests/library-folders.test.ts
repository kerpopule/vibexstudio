import {describe,it,expect} from 'vitest';
import {childLibraryFolders,inLibraryFolder} from '../src/lib/library-folders';
import {parseRemoteLibrary} from '../src/lib/library-core';
import type {LibraryEntry} from '../src/lib/library-entries';
const item = (folder:string):LibraryEntry => ({remote:{folder}} as LibraryEntry);
describe('library folders',()=>{
  it('shows one level at a time with counts and respects path boundaries',()=>{
    const items=[item('Videos/Clips'),item('Videos/Music Videos'),item('Videos/Clips'),item('Videos Extra')];
    expect(childLibraryFolders(items,'')).toEqual([{path:'Videos',label:'Videos',count:3},{path:'Videos Extra',label:'Videos Extra',count:1}]);
    expect(childLibraryFolders(items,'Videos').map(x=>x.label)).toEqual(['Clips','Music Videos']);
    expect(inLibraryFolder(items[3],'Videos')).toBe(false);
    expect(inLibraryFolder(items[0],'Videos')).toBe(true);
  });
  it('keeps legacy and device assets reachable',()=>{
    expect(childLibraryFolders([item(''),{} as LibraryEntry],'').map(x=>x.label)).toEqual(['Server library','This device']);
  });
  it('accepts portable Unicode filenames while refusing path-like names',()=>{
    const base={id:'one',kind:'image',fileName:'Café (portrait).png',bytes:1,mimeType:'image/png',folder:'Images/Generated'};
    const parse=(row:unknown)=>parseRemoteLibrary({version:1,assets:[row]},'https://studio.example');
    expect(parse(base)[0].folder).toBe('Images/Generated');
    expect(parse({...base,fileName:'../private.png'})).toEqual([]);
    expect(parse({...base,folder:'../private'})[0].folder).toBeUndefined();
  });
});
