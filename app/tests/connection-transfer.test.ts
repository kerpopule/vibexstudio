import {it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
vi.mock('expo-crypto',()=>{
 class Key{
  constructor(public key:CryptoKey){}
  static async generate(){return new Key(await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']) as CryptoKey);}
  static async import(raw:string){return new Key(await webcrypto.subtle.importKey('raw',Buffer.from(raw,'hex'),{name:'AES-GCM'},true,['encrypt','decrypt']) as CryptoKey);}
  async encoded(){return Buffer.from(await webcrypto.subtle.exportKey('raw',this.key)).toString('hex');}
 }
 class Sealed{
  constructor(public bytes:Uint8Array){}
  static fromCombined(value:string){return new Sealed(Buffer.from(value,'base64'));}
  async combined(){return Buffer.from(this.bytes).toString('base64');}
 }
 return {AESEncryptionKey:Key,AESKeySize:{AES256:256},AESSealedData:Sealed,
  aesEncryptAsync:async(plain:Uint8Array,key:Key,options:any)=>{const iv=webcrypto.getRandomValues(new Uint8Array(12));const encrypted=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:options.additionalData,tagLength:128},key.key,plain);return new Sealed(Buffer.concat([iv,Buffer.from(encrypted)]));},
  aesDecryptAsync:async(sealed:Sealed,key:Key,options:any)=>new Uint8Array(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:sealed.bytes.slice(0,12),additionalData:options.additionalData,tagLength:128},key.key,sealed.bytes.slice(12))),
 };
});
import {collectConnections,validateTransfer,type ConnectionTransfer} from '../src/lib/connection-transfer/bundle';
import {sealConnections,openConnections} from '../src/lib/connection-transfer/encryption';
const input:ConnectionTransfer={format:'vibex/ai-connections',version:1,connections:[{kind:'fal',label:'My media AI',model:'',secret:'sample-private-key',mediaModels:{video:'sample/video'}}]};
it('encrypts actual bytes, excludes the unlock key, and round-trips only with the separate code',async()=>{
 const a=await sealConnections(input),b=await sealConnections(input);
 expect(a.file).not.toContain('sample-private-key');expect(a.file).not.toContain('My media AI');expect(a.file).not.toContain(a.unlockCode);
 expect(a.unlockCode).not.toBe(b.unlockCode);expect(a.file).not.toBe(b.file);
 expect(await openConnections(a.file,a.unlockCode)).toEqual(input);
 await expect(openConnections(a.file,b.unlockCode)).rejects.toThrow('Could not unlock');
 const damaged=JSON.parse(a.file);damaged.data=(damaged.data[0]==='A'?'B':'A')+damaged.data.slice(1);
 await expect(openConnections(JSON.stringify(damaged),a.unlockCode)).rejects.toThrow('Could not unlock');
});
it('rejects unsupported envelopes and bounds input before decrypting',async()=>{
 const sealed=await sealConnections(input);
 await expect(openConnections(sealed.file,'short')).rejects.toThrow('complete unlock code');
 await expect(openConnections(sealed.file.replace('AES-256-GCM','AES-128-GCM'),sealed.unlockCode)).rejects.toThrow('Unsupported');
 await expect(openConnections('x'.repeat(1_536_001),sealed.unlockCode)).rejects.toThrow('too large');
});
it('does not transfer subscription credentials or device-bound grants',async()=>{
 const connection:any={id:'local-id',kind:'fal',auth:'apiKey',label:'My media AI',defaultModel:'',capabilities:{chat:false,image:true,video:true},createdAt:1};
 const read=vi.fn(async()=> 'sample-private-key');
 for(const extra of [{auth:'oauth'},{subscription:'minimax-oauth'},{privateProvider:{grantId:'private'}}])await expect(collectConnections([{...connection,...extra}],read)).rejects.toThrow('fresh sign-in');
 expect(read).not.toHaveBeenCalled();
 expect((await collectConnections([connection],read)).connections[0]).not.toHaveProperty('id');
 await expect(collectConnections([connection],async()=>null)).rejects.toThrow('could not be read');
});
it('rejects credential-bearing URLs and unsupported providers; drops unrelated metadata',()=>{
 for(const baseUrl of ['javascript:alert(1)','https://user:pw@example.test','https://example.test?key=secret','https://example.test#token'])expect(()=>validateTransfer({...input,connections:[{...input.connections[0],baseUrl}]})).toThrow();
 expect(()=>validateTransfer({...input,connections:[{...input.connections[0],kind:'unknown'}]})).toThrow();
 expect(()=>validateTransfer({...input,connections:[{...input.connections[0],refreshToken:'no'}]})).toThrow();
 expect(validateTransfer({...input,connections:[{...input.connections[0],id:'source',capabilities:{chat:true},instructions:'execute'}]})).toEqual(input);
});

import {normalizeTransferFile,transferClipboardText} from '../src/lib/connection-transfer/envelope';
it('uses quote-free clipboard text and the same identity for re-formatted files',async()=>{
 const sealed=await sealConnections(input),clipboard=transferClipboardText(sealed.file);
 expect(clipboard).not.toContain('"');expect(clipboard).toMatch(/^vibex-ai-transfer-v1:/);
 expect(normalizeTransferFile(clipboard)).toBe(sealed.file);
 expect(normalizeTransferFile(JSON.stringify(JSON.parse(sealed.file),null,2))).toBe(sealed.file);
 expect(await openConnections(clipboard,sealed.unlockCode)).toEqual(input);
});
