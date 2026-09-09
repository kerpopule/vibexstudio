import {encodeBundle,decodeBundle} from '../src/lib/share/bundle';
import {isPrivateProjectFile} from '../src/lib/private-project-files';
import {expect,it,vi} from 'vitest';
import {decodeDirectorHistory,encodeDirectorHistory,checkpointDirectorProject,readDirectorProjectHistory,DIRECTOR_HISTORY_PATH} from '../src/lib/director-project-history';
import {directorSessionKey,useDirectorSession} from '../src/lib/director-session';
import {prepareProjectBackup,restoreProjectBackup} from '../src/lib/share/project-backup';
vi.mock('@/lib/storage/projects',()=>import('../src/lib/storage/projects.web'));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getAllKeys:async()=>[],getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}}}));
const plan={draft:'Use my character and song',messages:[{role:'assistant' as const,content:'Play the music video when the player wins.'}]};
it('preserves prior plans, deduplicates snapshots, and excludes extra connection fields',()=>{
 const first=encodeDirectorHistory(null,[{...plan,token:'private'} as typeof plan])!;
 expect(first).not.toContain('private');
 expect(encodeDirectorHistory(first,[plan])).toBe(first);
 const second=encodeDirectorHistory(first,[{...plan,draft:'Another plan'}])!;
 expect(decodeDirectorHistory(second)).toEqual([plan,{...plan,draft:'Another plan'}]);
 expect(()=>encodeDirectorHistory('user-authored file',[plan])).toThrow('Keep the original');
 expect(()=>decodeDirectorHistory(JSON.stringify({format:'vibex/sparky-history',version:1,conversations:[{draft:'',messages:[{role:'system',content:'bad'}]}]}))).toThrow();
});
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
it.skipIf(!modulePath)('carries project planning through JSON and directory restore without AI connection identities',async()=>{
 const database=await import(/* @vite-ignore */ modulePath!);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);
 vi.stubGlobal('navigator',{locks:{request:async(_name:string,options:any,callback?:any)=>(callback??options)({name:_name})}});
 const storage=await import('../src/lib/storage/projects.web');
 const {writeProjectDirectoryArchive}=await import('../src/lib/share/project-directory-archive');
 try{
  const project=await storage.createProject('A game','🎮');await storage.writeFile(project.id,'game.js','playVictoryVideo()');
  const key=directorSessionKey('provider:private-id:https://private-server',project.id);
  useDirectorSession.setState({conversations:{[key]:plan},storageError:false});
  const backup=await prepareProjectBackup(project.id);
  expect(backup).not.toContain('private-server');expect(backup).not.toContain('private-id');
  const restored=await restoreProjectBackup(backup);
  expect(await readDirectorProjectHistory(restored)).toEqual([plan]);
  expect(await storage.readFile(restored,'game.js')).toBe('playVictoryVideo()');
  const before=await storage.readFile(project.id,DIRECTOR_HISTORY_PATH);
  await checkpointDirectorProject(project.id);expect(await storage.readFile(project.id,DIRECTOR_HISTORY_PATH)).toBe(before);
  const staged=await storage.stageProjectDirectoryArchive(project.id),chunks:Uint8Array[]=[];
  try{await writeProjectDirectoryArchive(staged.entries,{write:async b=>{chunks.push(b.slice());},finish:async()=>{},abort:async()=>{}});}finally{await staged.dispose();}
  const archive=new Blob(chunks.map(chunk=>new Uint8Array(chunk).buffer));
  const archiveId=await storage.restoreProjectDirectoryArchive(archive);
  expect(await readDirectorProjectHistory(archiveId)).toEqual([plan]);
  expect(await storage.readFile(archiveId,'game.js')).toBe('playVictoryVideo()');
  expect(await storage.readFile(project.id,DIRECTOR_HISTORY_PATH)).toBe(before);
 }finally{vi.unstubAllGlobals();}
});

it('keeps portable plans out of code-only shares, including case variants',()=>{
 const bundle=encodeBundle({name:'Game',description:'',emoji:'',files:[{path:'game.js',content:'play()'},{path:'Notes/Sparky.json',content:'private plan'},{path:'notes/SPARKY.JSON',content:'another private plan'}]},1);
 expect(bundle).not.toContain('private plan');expect(decodeBundle(bundle).files).toEqual([{path:'game.js',content:'play()',encoding:'utf-8'}]);
 expect(isPrivateProjectFile('Notes/Sparky.json')).toBe(true);
});
