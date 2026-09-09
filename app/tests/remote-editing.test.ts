import {createHash} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {saveExportToLibrary,uploadLibraryFile,renderEditingExport,connectEditing,hasEditingMediaPermission,disconnectEditing,listEditingDrafts,createEditingDraft,pendingEditingDraft,applyTimelineEdit,pendingTimelineEdit,renderEditingPreview,readEditingPreview} from '@/lib/remote-editing';
const pending=vi.hoisted(()=>new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(key:string)=>pending.get(key)??null,setItem:async(key:string,value:string)=>{pending.set(key,value);},removeItem:async(key:string)=>{pending.delete(key);}}}));
const state=vi.hoisted(()=>new Map<string,string>());
vi.mock('@/lib/storage/secrets',()=>({getLibraryToken:async(origin:string)=>state.get(origin+':library')??'mlab-library-v1.fixture',setLibraryToken:async(origin:string,value:string)=>{state.set(origin+':library',value);},getEditingConnection:async(origin:string)=>state.get(origin)??null,setEditingConnection:async(origin:string,value:string)=>{state.set(origin,value);}}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA-256'},digest:async(_:string,bytes:Uint8Array)=>{if(!(bytes instanceof Uint8Array))throw new Error('Native digest requires a typed array');return new Uint8Array(createHash('sha256').update(bytes).digest()).buffer;},digestStringAsync:async(_:string,value:string)=>createHash('sha256').update(value).digest('hex'),getRandomBytes:(n:number)=>new Uint8Array(n).fill(1)}));
const origin='https://lab.example',device='01'.repeat(16),token=`mlab-edit-v1.1800000000.${device}.${'a'.repeat(64)}`;
const json=(value:unknown)=>new Response(JSON.stringify(value));
beforeEach(()=>{state.clear();pending.clear();});afterEach(()=>vi.restoreAllMocks());
it('retains identity after lost pairing, requests only editing, and reuses identity after disconnect',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('offline'));
 await expect(connectEditing(origin,'code')).rejects.toThrow('Could not reach Media Lab');
 expect(JSON.parse(state.get(origin)!)).toEqual({deviceId:device,token:null});
 fetcher.mockImplementation(async()=>json({editScope:'editing:own',editToken:token}));
 await connectEditing(origin,'code');await disconnectEditing(origin);await connectEditing(origin,'code');
 expect(JSON.parse(state.get(origin)!)).toEqual({deviceId:device,token});
 for(const [,init] of fetcher.mock.calls){expect(JSON.parse(init!.body as string)).toEqual({code:'code',studio_edit:true,studio_device:device});expect(init).toMatchObject({credentials:'omit',redirect:'error'});}
});
it('refuses mismatched tokens without overwriting existing permission',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 vi.spyOn(globalThis,'fetch').mockResolvedValue(json({editScope:'editing:own',editToken:token.replace(device,'02'.repeat(16))}));
 await expect(connectEditing(origin,'code')).rejects.toThrow('invalid editing');
 expect(JSON.parse(state.get(origin)!).token).toBe(token);
});
it('requires own server permission and discards malformed summaries',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch');
 await expect(listEditingDrafts(origin)).rejects.toThrow('Connect');expect(fetcher).not.toHaveBeenCalled();
 state.set(origin,JSON.stringify({deviceId:device,token}));
 fetcher.mockResolvedValue(json({projects:[{project_id:'cut-'+'a'.repeat(32),title:'My cut',revision:1,duration_seconds:2,clip_count:1},{project_id:'../escape',title:'Bad'}]}));
 expect(await listEditingDrafts(origin)).toEqual([{id:'cut-'+'a'.repeat(32),title:'My cut',revision:1,seconds:2,clips:1}]);
 await expect(listEditingDrafts('https://other.example')).rejects.toThrow('Connect');
 expect(fetcher).toHaveBeenCalledTimes(1);
});

it('posts the same durable request with separate Library permission after a lost response',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('lost'));
 await expect(createEditingDraft(origin,{title:'My cut',assetIds:['scene']})).rejects.toThrow('Could not reach Media Lab');
 const saved=await pendingEditingDraft(origin);expect(saved?.assetIds).toEqual(['scene']);
 const projectId='cut-'+createHash('sha256').update(saved!.requestId).digest('hex').slice(0,32);
 fetcher.mockImplementation(async()=>json({project:{project_id:projectId}}));
 expect(await createEditingDraft(origin)).toBe(projectId);
 expect(await pendingEditingDraft(origin)).toBeNull();
 expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
 expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({Authorization:`Bearer ${token}`,'X-Library-Authorization':'Bearer mlab-library-v1.fixture'});
 expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).not.toHaveProperty('deviceId');
});

it('resumes the same timeline transaction after a lost response',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const id='cut-'+'a'.repeat(32);
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('lost'));
 await expect(applyTimelineEdit(origin,id,{revision:0,commands:[{id:'undo',type:'undo',payload:{}}]})).rejects.toThrow('Could not reach');
 const saved=await pendingTimelineEdit(origin,id);expect(saved?.revision).toBe(0);
 await expect(applyTimelineEdit(origin,id,{revision:0,commands:[]})).rejects.toThrow('Resume or discard');
 fetcher.mockImplementation(async()=>json({project:{project_id:id,title:'Draft',revision:1,settings:{fps:24},timeline:{tracks:[]}}}));
 expect((await applyTimelineEdit(origin,id)).revision).toBe(1);
 expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
 expect(await pendingTimelineEdit(origin,id)).toBeNull();
});

it('downloads only the verified preview with credentials outside the URL',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const bytes=new Uint8Array([1,2,3]),sha256=createHash('sha256').update(bytes).digest('hex');
 const receipt={projectId:'cut-'+'a'.repeat(32),revision:2,bytes:3,sha256,seconds:4,mimeType:'video/mp4' as const,candidate:true as const};
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json(receipt));
 expect(await renderEditingPreview(origin,receipt.projectId,2)).toEqual(receipt);
 fetcher.mockResolvedValueOnce(new Response(bytes,{headers:{'Content-Type':'video/mp4','X-Content-SHA256':sha256,'Content-Length':'3'}}));
 expect(await readEditingPreview(origin,receipt)).toEqual(bytes);
 expect(fetcher.mock.calls[1][0]).toBe(origin+'/api/studio/editing/projects/'+receipt.projectId+'/previews/2/content');
 expect(fetcher.mock.calls[1][1]).toMatchObject({credentials:'omit',redirect:'error',headers:{Authorization:`Bearer ${token}`}});
 fetcher.mockResolvedValueOnce(new Response(new Uint8Array([3,2,1]),{headers:{'Content-Type':'video/mp4','X-Content-SHA256':sha256}}));
 await expect(readEditingPreview(origin,receipt)).rejects.toThrow('did not match');
 fetcher.mockResolvedValueOnce(new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':'video/mp4','X-Content-SHA256':sha256}}));
 await expect(readEditingPreview(origin,receipt)).rejects.toThrow('exceeded');
});

it.each(['caption.add','caption.edit','caption.remove','audio.mix'] as const)('resumes a lost %s response with its original transaction',async(type)=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const id='cut-'+'a'.repeat(32),commands=[{id:'change',type,payload:{caption_id:'caption',clip_id:'clip',target:'clip',text:'Victory',start_frame:0,end_frame:24,gain_db:-6,muted:true}}];
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('lost'));
 await expect(applyTimelineEdit(origin,id,{revision:0,commands})).rejects.toThrow('Could not reach');
 expect((await pendingTimelineEdit(origin,id))?.commands).toEqual(commands);
 fetcher.mockImplementation(async()=>json({project:{project_id:id,title:'Draft',revision:1,settings:{fps:24},timeline:{tracks:[]}}}));
 await applyTimelineEdit(origin,id);
 expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
 expect(await pendingTimelineEdit(origin,id)).toBeNull();
});


it('requests the exact export revision and validates high-quality receipt dimensions',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const id='cut-'+'a'.repeat(32),receipt={projectId:id,revision:3,quality:'high',mimeType:'video/mp4',candidate:true,bytes:100,sha256:'a'.repeat(64),seconds:4,width:1440,height:810,fps:24};
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>json(receipt));
 expect(await renderEditingExport(origin,id,3)).toEqual(receipt);
 expect(fetcher.mock.calls[0][0]).toBe(origin+'/api/studio/editing/projects/'+id+'/export');
 expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({revision:3});
 fetcher.mockImplementation(async()=>json({...receipt,width:4000}));
 await expect(renderEditingExport(origin,id,3)).rejects.toThrow('unreadable export');
});

it('adds Library permission only for source insertion and preserves it on retry',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const id='cut-'+'a'.repeat(32),commands=[{id:'add',type:'clip.add' as const,payload:{job_id:'source'}}];
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('lost'));
 await expect(applyTimelineEdit(origin,id,{revision:0,commands})).rejects.toThrow('Could not reach');
 expect((await pendingTimelineEdit(origin,id))?.commands).toEqual(commands);
 fetcher.mockImplementation(async()=>json({project:{project_id:id,title:'Draft',revision:1,settings:{fps:24},timeline:{tracks:[]}}}));
 await applyTimelineEdit(origin,id);
 for(const [,init] of fetcher.mock.calls)expect(init?.headers).toMatchObject({'X-Library-Authorization':'Bearer mlab-library-v1.fixture'});
 expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
 await applyTimelineEdit(origin,id,{revision:0,commands:[{id:'undo',type:'undo',payload:{}}]});
 expect(fetcher.mock.calls[2][1]?.headers).not.toHaveProperty('X-Library-Authorization');
});


it('uploads only with editing and Library grants and checks the upload receipt',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({id:'import-'+'a'.repeat(64)+'-png',bytes:3}));
 await expect(uploadLibraryFile(origin,'scene.png',new Uint8Array([1,2,3]))).rejects.toThrow('Connect Library');
 expect(fetcher).not.toHaveBeenCalled();
 state.set(origin,JSON.stringify({deviceId:device,token}));
 await uploadLibraryFile(origin,'scene.png',new Uint8Array([1,2,3]));
 expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',headers:{Authorization:`Bearer ${token}`,'X-Library-Authorization':'Bearer mlab-library-v1.fixture'}});
 expect(new Uint8Array(fetcher.mock.calls[0][1]?.body as ArrayBuffer)).toEqual(new Uint8Array([1,2,3]));
 fetcher.mockResolvedValue(json({id:'import-'+'a'.repeat(64)+'-png',bytes:99}));
 await expect(uploadLibraryFile(origin,'scene.png',new Uint8Array([1,2,3]))).rejects.toThrow('reply could not be verified');
 fetcher.mockResolvedValue(new Response('',{status:404}));
 await expect(uploadLibraryFile(origin,'scene.png',new Uint8Array([1,2,3]))).rejects.toThrow('Update your server');
});


it('saves an owned export to Library using both permissions',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const asset='import-'+'a'.repeat(64)+'-mp4',id='cut-'+'b'.repeat(32);
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({id:asset,kind:'video'}));
 expect(await saveExportToLibrary(origin,id,2)).toBe(asset);
 expect(fetcher.mock.calls[0][0]).toBe(origin+'/api/studio/editing/projects/'+id+'/exports/2/library');
 expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({Authorization:`Bearer ${token}`,'X-Library-Authorization':'Bearer mlab-library-v1.fixture'});
 fetcher.mockResolvedValue(json({id:'bad',kind:'video'}));
 await expect(saveExportToLibrary(origin,id,2)).rejects.toThrow('reply could not be verified');
});
it('explains transaction conflicts as editing errors rather than source-file failures',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const {applyAgentTimelineEdit}=await import('../src/lib/remote-editing');
 const input={revision:0,commands:[{id:'undo',type:'undo' as const,payload:{}}]};
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:422}));
 await expect(applyAgentTimelineEdit(origin,'cut-'+'a'.repeat(32),'a'.repeat(64),input,()=>{})).rejects.toThrow('request ID cannot be reused');
 fetcher.mockResolvedValue(new Response('{}',{status:409}));
 await expect(applyAgentTimelineEdit(origin,'cut-'+'a'.repeat(32),'a'.repeat(64),input,()=>{})).rejects.toThrow('current revision');
});
it('checks completed export receipts with GET and rejects mismatched revision data',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const {readEditingExportStatus}=await import('../src/lib/remote-editing');
 const id='cut-'+'a'.repeat(32),receipt={projectId:id,revision:0,quality:'high',mimeType:'video/mp4',candidate:true,bytes:12,sha256:'a'.repeat(64),seconds:1,width:640,height:360,fps:24};
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({projectId:id,revision:0,state:'ready',receipt}));
 expect(await readEditingExportStatus(origin,id,0)).toEqual(receipt);
 expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
 fetcher.mockResolvedValue(json({projectId:id,revision:0,state:'not-ready',receipt:null}));expect(await readEditingExportStatus(origin,id,0)).toBeNull();
 fetcher.mockResolvedValue(json({projectId:id,revision:0,state:'ready',receipt:{...receipt,revision:1}}));await expect(readEditingExportStatus(origin,id,0)).rejects.toThrow('unreadable');
});

it('starts and observes an export job without holding a render request open',async()=>{
 const {startEditingExportJob,readEditingExportJob}=await import('@/lib/remote-editing');
 state.set(origin,JSON.stringify({deviceId:device,token}));
 const id='cut-1234567890',running={projectId:id,revision:0,state:'running',receipt:null};
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>json(running));
 expect(await startEditingExportJob(origin,id,0)).toEqual(running);
 expect(fetcher.mock.calls[0][0]).toBe(origin+'/api/studio/editing/projects/'+id+'/export-jobs');
 expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',body:JSON.stringify({revision:0})});
 expect(await readEditingExportJob(origin,id,0)).toEqual(running);
 expect(fetcher.mock.calls[1][1]).toMatchObject({method:'GET'});
 fetcher.mockImplementation(async()=>json({...running,revision:1}));
 await expect(readEditingExportJob(origin,id,0)).rejects.toThrow('unreadable');
 fetcher.mockImplementation(async()=>json({...running,state:'ready'}));
 await expect(readEditingExportJob(origin,id,0)).rejects.toThrow('receipt');
});

it('connects explicitly requested Library and editor access together without changing device identity',async()=>{
 const library=`mlab-library-v1.user.1800000000.${'b'.repeat(24)}.${'c'.repeat(64)}`;
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({scope:'library:read',token:library,editScope:'editing:own',editToken:token}));
 await connectEditing(origin,'code',{includeLibrary:true});
 expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({code:'code',studio_edit:true,studio_library:true,studio_device:device});
 expect(state.get(origin+':library')).toBe(library);expect(JSON.parse(state.get(origin)!).deviceId).toBe(device);
 expect(await hasEditingMediaPermission(origin)).toBe(true);
});
it('does not overwrite editing credentials when a combined grant lacks a valid Library token',async()=>{
 state.set(origin,JSON.stringify({deviceId:device,token}));
 vi.spyOn(globalThis,'fetch').mockResolvedValue(json({scope:'library:read',token:'wrong',editScope:'editing:own',editToken:token}));
 await expect(connectEditing(origin,'code',{includeLibrary:true})).rejects.toThrow('Library access');
 expect(state.has(origin+':library')).toBe(false);expect(JSON.parse(state.get(origin)!).token).toBe(token);
});
it('serializes simultaneous editing-only and combined requests and completes the wider grant',async()=>{
 const library=`mlab-library-v1.user.1800000000.${'b'.repeat(24)}.${'c'.repeat(64)}`;
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  const body=JSON.parse(init!.body as string);
  return json({editScope:'editing:own',editToken:token,...(body.studio_library?{scope:'library:read',token:library}:{})});
 });
 await Promise.all([connectEditing(origin,'code'),connectEditing(origin,'code',{includeLibrary:true})]);
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(state.get(origin+':library')).toBe(library);
 for(const [,init] of fetcher.mock.calls)expect(JSON.parse(init!.body as string).studio_device).toBe(device);
});
