import {exportFileName} from '@/lib/share/export-file';
/** Download verified bytes; no authenticated server URL is placed in the document. */
export async function shareAssetBytes(fileName:string,bytes:Uint8Array):Promise<void>{
 if(!bytes.length)throw new Error('The creation is empty. Refresh Library and try again.');
 const file=exportFileName(fileName),link=document.createElement('a');
 const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:file.mimeType}));
 try{link.href=url;link.download=file.name;link.style.display='none';document.body.appendChild(link);link.click();}
 finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);}
}
