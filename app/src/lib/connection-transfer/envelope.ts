import {TRANSFER_LIMIT} from './bundle';
export const TRANSFER_FORMAT='vibex/encrypted-ai-connections';
const prefix='vibex-ai-transfer-v1:';
/** Canonical identity for file and clipboard transports of the same authenticated ciphertext. */
export function normalizeTransferFile(file:string):string{
 if(typeof file!=='string'||file.length>TRANSFER_LIMIT*6)throw new Error('This AI transfer file is too large.');
 let value;
 const raw=file.trim();
 if(raw.startsWith(prefix))value={format:TRANSFER_FORMAT,version:1,cipher:'AES-256-GCM',data:raw.slice(prefix.length).replace(/\s/g,'')};
 else try{value=JSON.parse(raw);}catch{throw new Error('This is not a readable AI transfer file.');}
 if(value?.format!==TRANSFER_FORMAT||value.version!==1||value.cipher!=='AES-256-GCM'||typeof value.data!=='string'||value.data.length<40||value.data.length%4!==0||! /^[A-Za-z0-9+/]+={0,2}$/.test(value.data))throw new Error('Unsupported AI transfer file.');
 return JSON.stringify({format:TRANSFER_FORMAT,version:1,cipher:'AES-256-GCM',data:value.data});
}
export function transferClipboardText(file:string):string{return prefix+JSON.parse(normalizeTransferFile(file)).data;}
