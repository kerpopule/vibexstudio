import crypto from 'node:crypto';
import fs from 'node:fs/promises';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===64&&b.length===64&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=message=>Object.assign(new Error(message),{status:400});

/** User-owned device registry. Only token hashes persist; invitations expire on restart. */
export async function createDevicePairing(file,ownerToken,{now=Date.now}={}){
 const owner=hash(ownerToken),invites=new Map();let devices=[];
 try{
  const info=await fs.lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>128*1024)throw new Error('Invalid device registry');
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(value.version!==1||!Array.isArray(value.devices)||value.devices.length>100)throw new Error('Invalid device registry');
  if(value.owner===owner)devices=value.devices;
  if(devices.some(d=>!d||typeof d.id!=='string'||!/^[0-9a-f-]{36}$/.test(d.id)||typeof d.name!=='string'||d.name.length>80||!Number.isFinite(d.createdAt)||typeof d.hash!=='string'||!/^[0-9a-f]{64}$/.test(d.hash))||new Set(devices.map(d=>d.id)).size!==devices.length)throw new Error('Invalid device registry');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let queue=Promise.resolve();
 const serialize=action=>{const result=queue.then(action);queue=result.catch(()=>{});return result;};
 async function save(next){
  const temp=file+'.'+crypto.randomUUID()+'.tmp';let handle;
  try{
   handle=await fs.open(temp,'wx',0o600);await handle.writeFile(JSON.stringify({version:1,owner,devices:next}));await handle.sync();await handle.close();handle=null;
   await fs.rename(temp,file);devices=next;
  }finally{await handle?.close();await fs.rm(temp,{force:true});}
 }
 function prune(){for(const [code,invite] of invites)if(invite.expiresAt<=now())invites.delete(code);}
 return {
  issue(){
   prune();if(invites.size>=8)throw fail('Too many open invitations. Wait five minutes and try again.');
   if(devices.length>=100)throw fail('Remove an old device before pairing another.');
   const code=crypto.randomBytes(32).toString('base64url'),expiresAt=now()+5*60_000;
   invites.set(hash(code),{expiresAt});return {code,expiresAt};
  },
  claim(code,name){return serialize(async()=>{
   prune();const key=typeof code==='string'&&/^[A-Za-z0-9_-]{43}$/.test(code)?hash(code):'';
   if(!invites.has(key))throw Object.assign(fail('This invitation expired or was already used. Ask for a new QR code.'),{status:410});
   if(typeof name!=='string'||!name.trim()||name.length>80||/[\u0000-\u001f]/.test(name))throw fail('Enter a device name of up to 80 characters.');
   if(devices.length>=100)throw fail('Remove an old device before pairing another.');
   const token='vibex-device-v1.'+crypto.randomBytes(32).toString('base64url'),record={id:crypto.randomUUID(),name:name.trim(),createdAt:now(),hash:hash(token)};
   await save([...devices,record]);invites.delete(key);
   return {deviceId:record.id,token,scope:'build-and-project-sync'};
  });},
  authorized(token){return typeof token==='string'&&token.length<200&&devices.some(device=>equal(device.hash,hash(token)));},
  list(){return devices.map(({hash,...device})=>device);},
  revoke(id){return serialize(async()=>{
   if(typeof id!=='string'||!devices.some(device=>device.id===id))throw Object.assign(fail('Device not found.'),{status:404});
   await save(devices.filter(device=>device.id!==id));return {ok:true};
  });},
 };
}
