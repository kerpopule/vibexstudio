import {AESEncryptionKey,AESKeySize,AESSealedData,aesEncryptAsync,aesDecryptAsync} from 'expo-crypto';
import {validateTransfer,type ConnectionTransfer} from './bundle';
import {normalizeTransferFile,TRANSFER_FORMAT as format} from './envelope';
const aad=()=>new TextEncoder().encode(format+':1');
/** Fresh random 256-bit key, shared separately from the encrypted file. No password-derived keys. */
export async function sealConnections(input:ConnectionTransfer):Promise<{file:string;unlockCode:string}>{
 const plain=new TextEncoder().encode(JSON.stringify(validateTransfer(input)));
 try{
  const key=await AESEncryptionKey.generate(AESKeySize.AES256);
  const sealed=await aesEncryptAsync(plain,key,{nonce:{length:12},tagLength:16,additionalData:aad()});
  return {file:JSON.stringify({format,version:1,cipher:'AES-256-GCM',data:await sealed.combined('base64')}),unlockCode:await key.encoded('hex')};
 }finally{plain.fill(0);}
}
export async function openConnections(file:string,unlockCode:string):Promise<ConnectionTransfer>{
 const normalized=normalizeTransferFile(file);
 const code=unlockCode.replace(/[\s-]/g,'');
 if(!/^[0-9a-fA-F]{64}$/.test(code))throw new Error('Enter the complete unlock code from your other device.');
 const value=JSON.parse(normalized);
 let plain:Uint8Array;
 try{
  const key=await AESEncryptionKey.import(code,'hex');
  plain=await aesDecryptAsync(AESSealedData.fromCombined(value.data,{ivLength:12,tagLength:16}),key,{additionalData:aad()});
 }catch{throw new Error('Could not unlock this file. Check the code and use an unchanged copy from your other device.');}
 try{
  let decoded;try{decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}
  catch{throw new Error('The unlocked file does not contain readable AI settings.');}
  return validateTransfer(decoded);
 }
 finally{plain.fill(0);}
}
