import {expect,it} from 'vitest';
import {generationChoice} from '@/lib/connection-permission';
const a='https://first.example', b='https://second.example';
it('does not carry a saved permission or manual choice to a different server',()=>{
 expect(generationChoice(b,null,{origin:a,allowed:true},{origin:a,allowed:true})).toBe(false);
 expect(generationChoice(b,null,null,{origin:b,allowed:true})).toBe(true);
 expect(generationChoice(null,a,{origin:a,allowed:true},null)).toBe(false);
});
it('limits a generation reconnect link to its requested server',()=>{
 expect(generationChoice(a,a,null,{origin:a,allowed:false})).toBe(true);
 expect(generationChoice(b,a,null,null)).toBe(false);
});
it('keeps an explicit switch choice despite a later saved-permission response',()=>{
 expect(generationChoice(a,a,{origin:a,allowed:false},{origin:a,allowed:true})).toBe(false);
 expect(generationChoice(a,null,{origin:a,allowed:true},{origin:a,allowed:false})).toBe(true);
});
