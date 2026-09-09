import {normalizeTransferFile,transferClipboardText} from './envelope';
export const TRANSFER_QR_LIMIT=1100;
const prefix='vibex-ai-setup-v1:';
/** A local, user-revealed QR carries both parts. Never use it in a URL or send it to a server. */
export function makeTransferQR(file:string,unlockCode:string):string|null{
 if(!/^[a-f0-9]{64}$/i.test(unlockCode))throw new Error('Invalid transfer unlock code.');
 const data=transferClipboardText(file).slice('vibex-ai-transfer-v1:'.length);
 const payload=prefix+unlockCode.toLowerCase()+':'+data;
 return payload.length<=TRANSFER_QR_LIMIT?payload:null;
}
export function readTransferQR(payload:string):{file:string;unlockCode:string}{
 if(typeof payload!=='string'||payload.length>TRANSFER_QR_LIMIT||!payload.startsWith(prefix))throw new Error('Scan the AI transfer QR shown by your other device.');
 const rest=payload.slice(prefix.length),unlockCode=rest.slice(0,64);
 if(!/^[a-f0-9]{64}$/.test(unlockCode)||rest[64]!==':')throw new Error('This AI transfer QR is incomplete. Show a new code on your other device.');
 return {file:normalizeTransferFile('vibex-ai-transfer-v1:'+rest.slice(65)),unlockCode};
}
