import {it,expect,vi} from 'vitest';
import {createCollectionTools} from '../src/lib/agent-connect/collection-tools';
const rows=Array.from({length:30},(_,i)=>({id:`record-${i}`,title:`Character ${i}`,description:'Saved description',details:[],beats:Array.from({length:30},(_,j)=>({title:`Scene ${j}`,description:'Scene'})),links:{voiceId:'original-voice',castIds:[]}}));
const invoke=async (args:Record<string,unknown>)=>createCollectionTools(async()=>rows)[0].handler(args,{} as never) as Promise<any>;
it('requires existing media-read permission',()=>{
 expect(createCollectionTools(async()=>rows)[0].requiredPermission).toBe('mediaRead');
});
it('pages discovery and scenes without losing original IDs',async()=>{
 const page=await invoke({collection:'characters'});expect(page.records).toHaveLength(25);expect(page.nextOffset).toBe(25);
 const second=await invoke({collection:'characters',offset:25});expect(second.records[0].id).toBe('record-25');
 const detail=await invoke({collection:'storyboards',recordId:'record-1',offset:25});expect(detail.record.beats).toHaveLength(5);expect(detail.record.links.voiceId).toBe('original-voice');
});
it('validates input before reading private collections',async()=>{
 const load=vi.fn(async()=>rows);const tool=createCollectionTools(load)[0];
 await expect(tool.handler({collection:'credentials'},{} as never)).rejects.toThrow();
 await expect(tool.handler({collection:'voices',offset:-1},{} as never)).rejects.toThrow();
 expect(load).not.toHaveBeenCalled();
});
it('includes missing relationship IDs in discovery and detail for recovery',async()=>{
 const issue={field:'character_id',targetId:'missing-character',reason:'target_not_in_preserved_collection'};
 const tool=createCollectionTools(async()=>[{...rows[0],relationshipIssues:[issue]}])[0];
 const page=await tool.handler({collection:'voices'},{} as never) as any;
 const detail=await tool.handler({collection:'voices',recordId:'record-0'},{} as never) as any;
 expect(page.records[0].relationshipIssues).toEqual([issue]);
 expect(detail.record.relationshipIssues).toEqual([issue]);
});
