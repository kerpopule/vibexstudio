import type {RemoteLibraryAsset} from './library-core';
/** A music-video draft uses one soundtrack and up to seven ordered visual scenes. */
export function musicVideoSelection(ids:string[],assets:RemoteLibraryAsset[]){
 const rows=ids.map(id=>assets.find(asset=>asset.id===id));
 if(rows.some(row=>!row)||new Set(ids).size!==ids.length)throw new Error('Some selected media is no longer available. Choose it again from Library.');
 const songs=rows.filter(row=>row!.kind==='audio');
 const scenes=rows.filter(row=>row!.kind==='image'||row!.kind==='video');
 if(songs.length!==1)throw new Error('Choose one song for your soundtrack.');
 if(!scenes.length||scenes.length>7||songs.length+scenes.length!==rows.length)throw new Error('Choose one to seven pictures or video clips for your scenes.');
 return {song:songs[0]!,scenes:scenes as RemoteLibraryAsset[],assetIds:[songs[0]!.id,...scenes.map(row=>row!.id)]};
}
