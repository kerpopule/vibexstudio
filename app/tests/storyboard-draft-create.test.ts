import {expect,it,vi} from 'vitest';
import {createOrResumeStoryboard,validateStoryboardInput,type StoryboardDraftRequest,type StoryboardDraftInput} from '../src/lib/storyboard-draft-create';
const input:StoryboardDraftInput={musicAssetId:'song',storyboardId:'board',sourceSha256:'a'.repeat(64),title:'Copy',fps:24,scenes:[{assetId:'video',seconds:1},{assetId:'video',seconds:2}]};
function fixture(){
 let saved:StoryboardDraftRequest|null=null;
 const deps={read:async()=>saved,write:async(value:StoryboardDraftRequest)=>{saved=value;},clear:async()=>{saved=null;},device:async()=>'b'.repeat(32),id:()=> 'c'.repeat(32),submit:vi.fn(async(_:StoryboardDraftRequest)=>'cut-result')};
 return {deps,saved:()=>saved};
}
it('saves before submission and reuses exact scenes after a dropped response',async()=>{
 const f=fixture();f.deps.submit.mockImplementationOnce(async request=>{expect(f.saved()).toEqual(request);throw new Error('lost response');});
 await expect(createOrResumeStoryboard(f.deps,input)).rejects.toThrow('lost response');
 const original=f.saved();expect(original?.scenes.map(scene=>scene.assetId)).toEqual(['video','video']);
 expect(await createOrResumeStoryboard(f.deps)).toBe('cut-result');
 expect(f.deps.submit.mock.calls[1][0]).toEqual(original);expect(f.saved()).toBeNull();
});
it('does not submit if durable storage fails',async()=>{
 const f=fixture();f.deps.write=async()=>{throw new Error('disk full');};
 await expect(createOrResumeStoryboard(f.deps,input)).rejects.toThrow('disk full');expect(f.deps.submit).not.toHaveBeenCalled();
});
it('keeps uncertain requests and refuses another device or changed choices',async()=>{
 const f=fixture();f.deps.clear=async()=>{throw new Error('clear failed');};
 await expect(createOrResumeStoryboard(f.deps,input)).rejects.toThrow('clear failed');
 await expect(createOrResumeStoryboard(f.deps,{...input,title:'Another'})).rejects.toThrow('Resume');
 f.deps.device=async()=>'d'.repeat(32);
 await expect(createOrResumeStoryboard(f.deps)).rejects.toThrow('original editing device');expect(f.deps.submit).toHaveBeenCalledTimes(1);
});
it('validates all scene choices and total duration while allowing repeated assets',()=>{
 expect(()=>validateStoryboardInput(input)).not.toThrow();
 for(const seconds of [0,-1,NaN,Infinity,601])expect(()=>validateStoryboardInput({...input,scenes:[{assetId:'video',seconds}]})).toThrow();
 expect(()=>validateStoryboardInput({...input,scenes:[{assetId:'../private',seconds:1}]})).toThrow();
});
