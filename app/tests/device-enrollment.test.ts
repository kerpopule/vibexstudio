import {afterEach,expect,it,vi} from 'vitest';
import {claimWorkbenchInvite} from '../src/lib/device-enrollment';
import {parsePairDeepLinkV2,pairParamsFromInput} from '../src/lib/media-pairing';
const code='A'.repeat(43),token='vibex-device-v1.'+'B'.repeat(43),url='https://mine.test';
const reply={deviceId:'11111111-1111-1111-1111-111111111111',token,scope:'build-and-project-sync'};
afterEach(()=>vi.unstubAllGlobals());
it('preserves an invitation through scanning and refuses ambiguous owner-token links',()=>{
 const link=`vibex://pair?workbench=${encodeURIComponent(url)}&wbi=${code}`;
 expect(parsePairDeepLinkV2(link)).toEqual({mediaLab:null,workbench:{url,invitation:code}});
 expect(pairParamsFromInput(link)).toEqual({workbench:url,wbi:code});
 expect(parsePairDeepLinkV2(link+'&wbt=owner')).toBeNull();
 expect(parsePairDeepLinkV2(link.replace(code,'bad'))).toBeNull();
});
it('claims once for concurrent mounts without transmitting an owner credential',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(reply)));vi.stubGlobal('fetch',fetcher);
 const results=await Promise.all([claimWorkbenchInvite(url,code),claimWorkbenchInvite(url,code)]);expect(results).toEqual([token,token]);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(fetcher).toHaveBeenCalledWith(url+'/pairing/claim',expect.objectContaining({credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name:'VibeX Studio device'})}));
});
it('explains an expired invite without displaying server-supplied text',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-server-error',{status:410})));
 await expect(claimWorkbenchInvite(url,code)).rejects.toThrow('already used');
});
it('rejects malformed grants and oversized responses before saving any credential',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({...reply,scope:'owner'}))).mockResolvedValueOnce(new Response('{}',{headers:{'Content-Length':'9000'}})));
 await expect(claimWorkbenchInvite(url,code)).rejects.toThrow('Unexpected');await expect(claimWorkbenchInvite(url,code)).rejects.toThrow('Unexpected');
});
it('does not request an invalid invitation or credential-bearing URL',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(claimWorkbenchInvite('https://user:pass@mine.test',code)).rejects.toThrow('invalid');await expect(claimWorkbenchInvite(url,'bad')).rejects.toThrow('invalid');expect(fetcher).not.toHaveBeenCalled();
});
