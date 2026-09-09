const lockName=(prefix:string)=>'vibex-project-'+prefix;
function manager(){
 if(typeof navigator==='undefined'||!navigator.locks?.request)throw new Error('This browser cannot safely coordinate large backups. Use a browser with Web Locks support.');
 return navigator.locks;
}
/** Web Locks are released by the browser if the owning page/process disappears. */
export async function holdArchiveLock(prefix:string):Promise<()=>Promise<void>>{
 let release!:()=>void,ready!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const acquired=new Promise<void>(resolve=>{ready=resolve;});
 const task=manager().request(lockName(prefix),async()=>{ready();await held;});
 await Promise.race([acquired,task]);
 return async()=>{release();await task;};
}
export async function ifArchiveAbandoned(prefix:string,cleanup:()=>Promise<void>):Promise<boolean>{
 return manager().request(lockName(prefix),{ifAvailable:true},async lock=>{
  if(!lock)return false;await cleanup();return true;
 });
}
