import {it,expect} from 'vitest';
import {editingLibraryHandoff} from '../src/lib/editing-library-handoff';
import type {RemoteLibraryAsset} from '../src/lib/library-core';
const origin='https://media.example';
const asset={id:'old-video',serverUrl:origin,kind:'video',title:'Preserved film',bytes:1024} as RemoteLibraryAsset;
it('prefills an editable copy from the connected Library without changing the asset',()=>{
 expect(editingLibraryHandoff(origin,origin,asset.id,[asset])).toEqual({assetIds:['old-video'],title:'Preserved film edit'});
 expect(asset.title).toBe('Preserved film');
 expect(editingLibraryHandoff(origin,undefined,undefined,[asset])).toBeNull();
});
it('rejects another host even when its asset ID collides',()=>{
 expect(()=>editingLibraryHandoff(origin,'https://other.example',asset.id,[asset])).toThrow('another server');
 expect(()=>editingLibraryHandoff(origin,origin,asset.id,[{...asset,serverUrl:'https://other.example'}])).toThrow('unavailable');
});
it('does not select missing, oversized, unsupported or malformed media',()=>{
 for(const assets of [[],[{...asset,bytes:256*1024**2+1}],[{...asset,kind:'model'}] as RemoteLibraryAsset[]])expect(()=>editingLibraryHandoff(origin,origin,asset.id,assets)).toThrow('unavailable');
 expect(()=>editingLibraryHandoff(origin,origin,'../file',[asset])).toThrow('again');
});
