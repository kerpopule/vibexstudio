import {afterEach,expect,it,vi} from 'vitest';
import {askDirector} from '@/lib/remote-director';
const stored=vi.hoisted(()=>({value:JSON.stringify({token:'mlab-render-v1.test'}),library:null as string|null}));
vi.mock('@/lib/storage/secrets',()=>({getGenerationConnection:async()=>stored.value,getLibraryToken:async()=>stored.library}));
afterEach(()=>{vi.unstubAllGlobals();stored.library=null;stored.value=JSON.stringify({token:'mlab-render-v1.test'});});
const project={version:1 as const,projectId:'game',title:'Game',assets:[]};
const messages=[{role:'user' as const,content:'Help me plan'}];
it('uses the paired token and exact independent endpoint',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({version:1,message:'A plan',actions:[]})));
  vi.stubGlobal('fetch',fetcher);
  expect(await askDirector('https://lab.example',messages,project)).toBe('A plan');
  expect(fetcher).toHaveBeenCalledWith('https://lab.example/api/studio/director',expect.objectContaining({credentials:'omit',redirect:'error',headers:{Authorization:'Bearer mlab-render-v1.test','Content-Type':'application/json'}}));
});
it('does not call a server without a paired token',async()=>{
  stored.value='{}';const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(askDirector('https://lab.example',messages,project)).rejects.toThrow('Connect');
  expect(fetcher).not.toHaveBeenCalled();
});
it('refuses action-bearing replies',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({version:1,message:'Queued',actions:[{type:'run'}]}))));
  await expect(askDirector('https://lab.example',messages,project)).rejects.toThrow('unsupported');
});
it('reports an unavailable director without pretending it answered',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
  await expect(askDirector('https://lab.example',messages,project)).rejects.toThrow('not available');
});
it('bounds serialized history while preserving the latest user message',async()=>{
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
    const body=JSON.parse(init.body as string);
    expect(new TextEncoder().encode(init.body as string).length).toBeLessThanOrEqual(65536);
    expect(body.messages.at(-1)).toEqual(messages[0]);
    return new Response(JSON.stringify({version:1,message:'A plan',actions:[]}));
  });vi.stubGlobal('fetch',fetcher);
  await askDirector('https://lab.example',[...Array.from({length:19},()=>({role:'assistant' as const,content:'界'.repeat(5000)})),...messages],project);
});
it('allows studio planning without inventing selected project metadata',async()=>{
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
    expect(JSON.parse(init.body as string)).toEqual({messages});
    return new Response(JSON.stringify({version:1,message:'Let us plan your game.',actions:[]}));
  });
  vi.stubGlobal('fetch',fetcher);
  expect(await askDirector('https://lab.example',messages)).toBe('Let us plan your game.');
  expect(fetcher).toHaveBeenCalledOnce();
});
it('includes Library permission only when requested, and never in conversation text',async()=>{
  stored.library='mlab-library-v1.test';
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
    expect(init.headers).toEqual(expect.objectContaining({'X-Library-Authorization':'Bearer mlab-library-v1.test'}));
    expect(JSON.parse(init.body as string)).toEqual({messages,selected_project:project,include_library:true});
    expect(init.body).not.toContain('mlab-library');
    return new Response(JSON.stringify({version:1,message:'A Library suggestion',actions:[]}));
  });
  vi.stubGlobal('fetch',fetcher);
  await askDirector('https://lab.example',messages,project,undefined,true);
});
it('retains the request locally when Library access is missing',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(askDirector('https://lab.example',messages,project,undefined,true)).rejects.toThrow('Connect Library access');
  expect(fetcher).not.toHaveBeenCalled();
});
