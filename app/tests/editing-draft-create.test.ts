import {expect,it,vi} from 'vitest';
import {createOrResumeDraft,type DraftRequest,type DraftCreateDependencies} from '@/lib/editing-draft-create';
function fixture(){
 let saved:DraftRequest|null=null;
 const deps:DraftCreateDependencies={read:async()=>saved,write:async value=>{saved=value;},clear:async()=>{saved=null;},device:async()=> 'a'.repeat(32),id:()=> 'b'.repeat(32),submit:vi.fn(async()=> 'cut-result')};
 return {deps,read:()=>saved};
}
const input={title:'My cut',assetIds:['scene']};
it('does not submit if saving the recovery record fails',async()=>{
 const {deps}=fixture();deps.write=async()=>{throw new Error('disk');};
 await expect(createOrResumeDraft(deps,input)).rejects.toThrow('disk');expect(deps.submit).not.toHaveBeenCalled();
});
it('recovers the identical request after a lost response',async()=>{
 const {deps,read}=fixture();const submit=vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce('cut-result');deps.submit=submit;
 await expect(createOrResumeDraft(deps,input)).rejects.toThrow('lost');const saved=read();
 expect(saved).toMatchObject({...input,deviceId:'a'.repeat(32)});
 expect(await createOrResumeDraft({...deps})).toBe('cut-result');expect(submit.mock.calls[0][0]).toEqual(submit.mock.calls[1][0]);expect(read()).toBeNull();
});
it('blocks a different device and different selection while a request is pending',async()=>{
 const {deps}=fixture();deps.submit=vi.fn(async()=>{throw new Error('lost');});
 await expect(createOrResumeDraft(deps,input)).rejects.toThrow('lost');
 await expect(createOrResumeDraft({...deps,device:async()=> 'c'.repeat(32)})).rejects.toThrow('original editing device');
 await expect(createOrResumeDraft(deps,{...input,assetIds:['other']})).rejects.toThrow('Finish the saved');
 expect(deps.submit).toHaveBeenCalledTimes(1);
});
it('keeps recovery when clearing fails after server acceptance',async()=>{
 const {deps,read}=fixture();deps.clear=vi.fn().mockRejectedValueOnce(new Error('storage')).mockResolvedValueOnce(undefined);
 await expect(createOrResumeDraft(deps,input)).rejects.toThrow('storage');expect(read()).not.toBeNull();
 expect(await createOrResumeDraft(deps)).toBe('cut-result');expect(deps.submit).toHaveBeenCalledTimes(2);
});
it('rejects empty and duplicate selections without saving or submitting',async()=>{
 for(const assetIds of [[],['scene','scene']]){const {deps,read}=fixture();await expect(createOrResumeDraft(deps,{...input,assetIds})).rejects.toThrow('eight different');expect(read()).toBeNull();expect(deps.submit).not.toHaveBeenCalled();}
});
