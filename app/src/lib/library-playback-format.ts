export const MAX_PLAYBACK_BYTES=128*1024*1024;
const formats:Record<string,string>={
 'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','video/x-matroska':'mkv',
 'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav',
 'audio/flac':'flac','audio/x-flac':'flac','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/ogg':'ogg',
};
export function playbackFormat(mime:string,bytes:number):string{
 if(!formats[mime])throw new Error('This file format cannot be opened in the Library player. Save the file to play it in another app.');
 if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX_PLAYBACK_BYTES)throw new Error('The Library player supports files up to 128 MB. Save this file to play it in another app.');
 return formats[mime];
}
