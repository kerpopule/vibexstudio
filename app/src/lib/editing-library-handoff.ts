import {libraryOrigin,type RemoteLibraryAsset} from './library-core';
/** Resolve route hints only against the currently connected, authorized catalog. */
export function editingLibraryHandoff(origin:string,sourceOrigin:unknown,assetId:unknown,assets:RemoteLibraryAsset[]) {
 if(assetId===undefined)return null;
 if(typeof assetId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(assetId)||typeof sourceOrigin!=='string')throw new Error('Open this media from Library again.');
 if(libraryOrigin(origin)!==libraryOrigin(sourceOrigin))throw new Error('This media belongs to another server. Connect that Library before editing it.');
 const asset=assets.find(row=>row.id===assetId&&libraryOrigin(row.serverUrl)===libraryOrigin(origin));
 if(!asset||!['image','video','audio'].includes(asset.kind)||asset.bytes>256*1024**2)throw new Error('This media is unavailable for editing. Choose another Library item.');
 return {assetIds:[asset.id],title:(asset.title.trim()||'My video').slice(0,150)+' edit'};
}
