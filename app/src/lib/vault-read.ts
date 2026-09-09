type Invoke = (command:string,args:Record<string,unknown>)=>Promise<unknown>;
const pending=new Map<string,Promise<unknown>>();
const WAIT_MS=10_000;
/** A successful write/delete changes what subsequent reads should observe. */
export function invalidateVaultRead(key:string):void {pending.delete(key);}
/** Bound UI waiting without pretending to cancel a native keychain request. */
export async function readVaultSecret(invoke:Invoke,key:string):Promise<string|null> {
 let request=pending.get(key);
 if(!request){
  request=Promise.resolve().then(()=>invoke('secret_get',{key}));
  pending.set(key,request);
  const owned=request;
  void request.then(()=>{if(pending.get(key)===owned)pending.delete(key);},()=>{if(pending.get(key)===owned)pending.delete(key);});
 }
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const value=await Promise.race([request,new Promise<never>((_,reject)=>{
   timer=setTimeout(()=>reject(new Error('The credential vault is taking too long. Check for a system authorization prompt, then try again.')),WAIT_MS);
  })]);
  return typeof value==='string'?value:null;
 } finally {if(timer!==undefined)clearTimeout(timer);}
}
