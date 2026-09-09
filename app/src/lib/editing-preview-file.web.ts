export async function editingPreviewFile(bytes:Uint8Array):Promise<{uri:string;dispose:()=>void}>{
 const uri=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'video/mp4'}));
 return {uri,dispose:()=>URL.revokeObjectURL(uri)};
}
