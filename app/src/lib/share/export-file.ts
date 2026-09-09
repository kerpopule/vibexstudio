import {mimeFor} from '@/lib/media-mime';
/** Keep a descriptive basename, but never let server metadata become a path. */
export function exportFileName(input:string):{name:string;mimeType:string}{
 const extension=input.split('.').pop()?.toLowerCase();
 if(!extension||!['png','jpg','jpeg','gif','webp','avif','mp4','webm','mov','mkv','mp3','wav','flac','m4a','ogg','glb'].includes(extension))throw new Error('This file type cannot be exported from Library.');
 const stem=input.slice(0,-extension.length-1).replace(/[^A-Za-z0-9._ -]/g,'-').replace(/^[. -]+/,'').slice(0,120)||'creation';
 const name=`${stem}.${extension}`;
 return {name,mimeType:extension==='mkv'?'video/x-matroska':mimeFor(name)};
}
