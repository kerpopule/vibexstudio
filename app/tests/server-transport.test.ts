import {afterEach,it,expect,vi} from 'vitest';
import {requestProjectSync} from '../src/lib/sync/server-transport';
const connection={url:'https://my-server.test',token:'private-token'};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('uses only the paired endpoint and header credentials with redirects disabled',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({projects:[]})));vi.stubGlobal('fetch',fetch);
 expect(await requestProjectSync(connection,{operation:'list'})).toEqual({projects:[]});
 expect(fetch).toHaveBeenCalledWith('https://my-server.test/sync',expect.objectContaining({redirect:'error',headers:expect.objectContaining({'X-Workbench-Token':'private-token'}),body:'{"operation":"list"}'}));
});
it.each([[401,'Pair it again'],[404,'not enabled'],[409,'server changed']])('explains HTTP %s without claiming success',async(code,message)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:Number(code)})));
 await expect(requestProjectSync(connection,{})).rejects.toThrow(String(message));
});
it('rejects malformed and oversized responses',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('not JSON')).mockResolvedValueOnce(new Response('{}',{headers:{'content-length':'100000000'}})));
 await expect(requestProjectSync(connection)).rejects.toThrow('unreadable');await expect(requestProjectSync(connection)).rejects.toThrow('too large');
});
it('rejects credential-bearing addresses before sending anything',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 await expect(requestProjectSync({...connection,url:'https://user:pass@my-server.test'})).rejects.toThrow('Invalid');expect(fetch).not.toHaveBeenCalled();
});
