import {playbackFormat} from './library-playback-format';
export async function libraryPlaybackFile(bytes:Uint8Array,mime:string):Promise<{uri:string;dispose:()=>void}>{
 playbackFormat(mime,bytes.length);
 const uri=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime}));
 return {uri,dispose:()=>URL.revokeObjectURL(uri)};
}
