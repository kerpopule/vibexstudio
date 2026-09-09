import {Directory,File,Paths} from 'expo-file-system';
const active=new Set<string>();
const stagePattern=/^\.asset-import-[a-z0-9]+-[a-z0-9]+$/;

/** Only app-owned staging files at project roots are eligible for cleanup. */
export function cleanupNativeAssetImports():void {
 const root=new Directory(Paths.document,'projects');
 if(!root.exists)return;
 for(const project of root.list()){
  if(!(project instanceof Directory)||!new File(project,'project.json').exists)continue;
  for(const file of project.list()){
   if(!(file instanceof File)||!stagePattern.test(file.name)||active.has(file.uri))continue;
   try{file.delete();}catch{/* Retry later if the OS temporarily denies cleanup. */}
  }
 }
}
export function beginNativeAssetImport(project:Directory){
 const name='.asset-import-'+Date.now().toString(36)+'-'+(Math.random().toString(36).slice(2)||'0');
 const file=new File(project,name),originalUri=file.uri;
 file.create();active.add(originalUri);
 return {file,dispose(){
  // File.move changes file.uri; cleanup must never follow it to the final asset.
  try{const pending=new File(originalUri);if(pending.exists)pending.delete();}
  finally{active.delete(originalUri);}
 }};
}
