import {expect,it,vi} from 'vitest';
import {PAIRING_APPROVAL_TIMEOUT_MS} from '@/lib/agent-connect/core';
import {startLocalHttpServer} from '@/lib/agent-connect/http-server.native';
const state=vi.hoisted(()=>({connect:null as null|((socket:any)=>void)}));
vi.mock('react-native-tcp-socket',()=>({default:{createServer:(connect:any)=>{state.connect=connect;return {on:()=>{},listen:(_:unknown,ready:()=>void)=>ready(),close:()=>{}};}}}));
async function socket(){
 const events:Record<string,(chunk:string)=>void>={};
 const value={setEncoding:vi.fn(),setTimeout:vi.fn(),destroy:vi.fn(),on:(event:string,fn:any)=>{events[event]=fn;}};
 await startLocalHttpServer(8791,()=>new Promise(()=>{}));
 state.connect!(value);
 return {value,send:events.data};
}
it('keeps incomplete pairing requests bounded, then allows the full human approval deadline',async()=>{
 const {value,send}=await socket();
 send('POST /pair HTTP/1.1\r\nContent-Length: 2\r\n\r\n');
 expect(value.setTimeout.mock.calls.map(c=>c[0])).toEqual([30_000]);
 send('{}');
 expect(value.setTimeout.mock.calls.map(c=>c[0])).toEqual([30_000,PAIRING_APPROVAL_TIMEOUT_MS+10_000]);
});
it('does not extend the pairing timeout for other endpoints',async()=>{
 const {value,send}=await socket();
 send('POST /mcp HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}');
 expect(value.setTimeout.mock.calls.map(c=>c[0])).toEqual([30_000]);
});
