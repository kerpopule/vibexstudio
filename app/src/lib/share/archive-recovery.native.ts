import {Directory,File,Paths} from 'expo-file-system';

const active=new Set<string>();
const tokenPattern=/^[a-z0-9]+-[a-z0-9]+$/;
const markerName='.vibex-archive-pending.json';
const stagingRoot=()=>new Directory(Paths.cache,'project-archive-operations');

/** Recover only our marked incomplete restores and private staging directories.
 * Native mobile storage has one JS owner; active operations are never reclaimed.
 */
export function cleanupNativeArchives(){
 const projects=new Directory(Paths.document,'projects');
 if(projects.exists)for(const target of projects.list()){
  if(!(target instanceof Directory))continue;
  const marker=new File(target,markerName);
  if(!marker.exists)continue;
  try{
   if(marker.size>1024)continue;
   const record=JSON.parse(marker.textSync());
   if(record.version!==1||record.projectId!==target.name||typeof record.token!=='string'||!tokenPattern.test(record.token)||active.has(record.token))continue;
   if(new File(target,'project.json').exists)marker.delete();
   else target.delete();
  }catch{/* An unreadable/ambiguous marker never authorizes project deletion. */}
 }
 const root=stagingRoot();
 if(root.exists)for(const entry of root.list()){
  if(entry instanceof Directory&&tokenPattern.test(entry.name)&&!active.has(entry.name)){
   try{entry.delete();}catch{/* Retry on the next archive operation or launch. */}
  }
 }
}

export function beginNativeArchive(){
 cleanupNativeArchives();
 const root=stagingRoot();if(!root.exists)root.create({intermediates:true});
 const token=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)||'0'}`;
 const directory=new Directory(root,token);directory.create();active.add(token);
 return {directory,token,markRestore(target:Directory){
  new File(target,markerName).write(JSON.stringify({version:1,projectId:target.name,token}));
 },clearRestore(target:Directory){const marker=new File(target,markerName);if(marker.exists)marker.delete();},dispose(){
  try{if(directory.exists)directory.delete();}finally{active.delete(token);}
 }};
}
