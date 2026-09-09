import {afterEach,expect,it,vi} from 'vitest';
import {probeMediaHost} from '@/lib/media-host-probe';
afterEach(()=>vi.unstubAllGlobals());
it('requires an explicit versioned declaration before hiding an existing website',async()=>{
  for(const [manifest,expected] of [[{},true],[{vibexStudio:{version:1,legacyQueue:false}},true],[{vibexStudio:{version:2,webInterface:false}},true],[{vibexStudio:{version:1,webInterface:false}},false]] as const){
    const request=vi.fn(async()=>new Response(JSON.stringify(manifest)));
    vi.stubGlobal('fetch',request);
    expect(await probeMediaHost('https://lab.example/')).toEqual({modelSetup:(manifest as any).vibexStudio?.version!==1,integratedStudio:false,webInterface:expected,editingDrafts:false,editingPreview:false,editingExport:false,editingLibrarySave:false,editingAddSources:false});
    expect(request).toHaveBeenCalledWith('https://lab.example/manifest.json',expect.objectContaining({credentials:'omit',redirect:'error'}));
  }
});
it('does not call an unreachable or malformed host ready',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('bad',{status:503})));
  expect(await probeMediaHost('https://lab.example')).toBeNull();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('not json')));
  expect(await probeMediaHost('https://lab.example')).toBeNull();
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
  expect(await probeMediaHost('https://lab.example')).toBeNull();
});

it('requires an explicit supported editing capability',async()=>{
 for(const [version,expected] of [[1,true],[2,false]]){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({vibexStudio:{version,editingDrafts:true,webInterface:false}}))));
  expect((await probeMediaHost('https://lab.example'))?.editingDrafts).toBe(expected);
 }
});

it('only advertises explicitly supported render tools on known manifests',async()=>{
 for(const [manifest,preview,exported] of [[{vibexStudio:{version:1,editingDrafts:true}},false,false],[{vibexStudio:{version:1,editingPreview:true,editingExport:true}},true,true],[{vibexStudio:{version:2,editingPreview:true,editingExport:true}},false,false]] as const){
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));
  const host=await probeMediaHost('https://lab.example');
  expect([host?.editingPreview,host?.editingExport]).toEqual([preview,exported]);
 }
});


it('uses integrated Studio tools instead of opening another copy of Studio',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({vibexStudio:{version:1,webInterface:true,integratedStudio:true,editingDrafts:true}}))));
 const host=await probeMediaHost('https://studio.example');
 expect(host?.integratedStudio).toBe(true);
 expect(host?.webInterface).toBe(false);
 expect(host?.editingDrafts).toBe(true);
});

it('only offers model setup on a versioned host that explicitly supports it',async()=>{
 for(const supported of [false,true]){
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({vibexStudio:{version:1,modelSetup:supported}})));
  expect((await probeMediaHost('https://lab.example'))?.modelSetup).toBe(supported);
 }
});


it('offers Library export saves only when explicitly supported',async()=>{
 for(const [version,capability,expected] of [[1,true,true],[1,false,false],[1,undefined,false],[2,true,false]]){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({vibexStudio:{version,editingLibrarySave:capability}}))));
  expect((await probeMediaHost('https://lab.example'))?.editingLibrarySave).toBe(expected);
 }
});
