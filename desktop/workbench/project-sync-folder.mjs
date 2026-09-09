/** Append-only project revisions in a user-selected folder. No cloud service. */
import {mkdir,lstat,readdir,open,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const LIMIT=30*1024*1024;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validRevision=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const digest=text=>createHash('sha256').update(text).digest('hex');
async function directory(dir,create=false){
 if(create){try{await mkdir(dir,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}}
 const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Sync directories cannot be symbolic links');
}
async function projectDirectory(root,id,create=false){
 if(!path.isAbsolute(root)||!validId(id))throw new Error('Invalid sync folder or project identity');
 await directory(root);
 let dir=root;
 for(const name of ['VibeXStudioSync','v1','projects',id]){dir=path.join(dir,name);await directory(dir,create);}
 return dir;
}
async function readRevision(file,id){
 const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error('Revision files cannot be symbolic links');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>LIMIT)throw new Error('Invalid or oversized sync revision');
  const raw=await handle.readFile('utf8');if(Buffer.byteLength(raw)>LIMIT)throw new Error('Oversized sync revision');
  const envelope=JSON.parse(raw);
  if(envelope.format!=='vibex/project-sync'||envelope.version!==1||envelope.projectId!==id||!validRevision(envelope.revision)||path.basename(file)!==envelope.revision+'.json'
   ||!Array.isArray(envelope.parents)||envelope.parents.length>100||envelope.parents.some(p=>!validRevision(p)||p===envelope.revision)||new Set(envelope.parents).size!==envelope.parents.length
   ||typeof envelope.payload!=='string'||digest(envelope.payload)!==envelope.sha256)throw new Error('Damaged sync revision; existing copies were preserved');
  return envelope;
 }finally{await handle.close();}
}
export async function readProjectRevisions(root,id){
 let dir;try{dir=await projectDirectory(root,id);}catch(error){if(error.code==='ENOENT')return {heads:[],revisions:[]};throw error;}
 const names=(await readdir(dir)).filter(name=>name.endsWith('.json'));
 if(names.length>10000)throw new Error('This project has too many revisions; archive older history before continuing');
 const revisions=[];let total=0;
 for(const name of names){
  const file=path.join(dir,name);total+=(await lstat(file)).size;
  if(total>256*1024*1024)throw new Error('This project history exceeds the current folder-sync read limit');
  revisions.push(await readRevision(file,id));
 }
 const ids=new Set(revisions.map(r=>r.revision));
 // A syncing provider may deliver children before parents. Wait, never overwrite.
 if(revisions.some(r=>r.parents.some(parent=>!ids.has(parent))))throw new Error('Some project history has not arrived yet. Let your storage app finish syncing, then retry.');
 const remaining=new Map(revisions.map(r=>[r.revision,new Set(r.parents)]));
 let progressed=true;
 while(remaining.size&&progressed){
  progressed=false;
  for(const [revision,parents] of remaining){
   if([...parents].every(parent=>!remaining.has(parent))){remaining.delete(revision);progressed=true;}
  }
 }
 if(remaining.size)throw new Error('Invalid cyclic sync history');
 const referenced=new Set(revisions.flatMap(r=>r.parents));
 const heads=revisions.filter(r=>!referenced.has(r.revision)).map(r=>r.revision).sort();
 if(revisions.length&&!heads.length)throw new Error('Invalid cyclic sync history');
 return {heads,revisions};
}
export async function appendProjectRevision(root,id,payload,expectedHeads,{beforePublish}={}){
 if(typeof payload!=='string'||Buffer.byteLength(payload)>LIMIT-4096)throw new Error('Project exceeds the folder-sync size limit');
 if(!Array.isArray(expectedHeads)||expectedHeads.length>100||expectedHeads.some(p=>!validRevision(p))||new Set(expectedHeads).size!==expectedHeads.length)throw new Error('Invalid parent revision list');
 const dir=await projectDirectory(root,id,true);
 const current=await readProjectRevisions(root,id);
 if(JSON.stringify(current.heads)!==JSON.stringify([...expectedHeads].sort()))throw new Error('The folder changed. Read its latest copies before saving.');
 const revision=randomUUID();
 const envelope={format:'vibex/project-sync',version:1,projectId:id,revision,parents:[...expectedHeads].sort(),sha256:digest(payload),payload};
 const temporary=path.join(dir,'.'+revision+'.pending');const published=path.join(dir,revision+'.json');
 const handle=await open(temporary,'wx',0o600);
 try{
  try{await handle.writeFile(JSON.stringify(envelope));await handle.sync();}finally{await handle.close();}
  await beforePublish?.();
  // Publish a complete file without overwriting a concurrent writer's revision.
  // Providers that cannot hard-link fail here; prior history remains intact.
  await link(temporary,published);
 }finally{await unlink(temporary);}
 const saved=await readRevision(published,id);
 const after=await readProjectRevisions(root,id);
 return {revision:saved.revision,heads:after.heads,conflict:after.heads.length>1};
}

export async function listFolderProjects(root){
 if(!path.isAbsolute(root))throw new Error('Invalid sync folder');await directory(root);
 let dir=root;
 for(const name of ['VibeXStudioSync','v1','projects']){
  dir=path.join(dir,name);try{await directory(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 }
 const names=await readdir(dir);if(names.length>10000)throw new Error('Too many projects in the sync folder');
 const ids=[];
 for(const id of names){if(!validId(id))continue;await directory(path.join(dir,id));ids.push(id);}
 return ids.sort();
}
