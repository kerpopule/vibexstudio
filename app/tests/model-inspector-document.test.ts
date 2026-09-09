import {expect,it} from 'vitest';
import {modelInspectorDocument,modelInspectorMessage} from '../src/lib/model-inspector-document';
it('embeds its renderer locally and limits resources to embedded model data',()=>{
 const html=modelInspectorDocument('Z2xURg==');
 expect(html).toContain("default-src 'none'");
 expect(html).toContain('connect-src blob: data:');
 expect(html).not.toMatch(/<script\s+src=/i);
 expect(html).toContain('Three.js license:');
 expect(html).toContain('Copyright © 2010-2026 three.js authors');
 expect(html.match(/<\/script>/g)).toHaveLength(1);
 expect(html).toContain('"rotation":[0,0,0,1]');
});
it('refuses injected payloads and invalid orientations before opening a WebView',()=>{
 for(const bad of ['', '</script><script>alert(1)</script>', 'abc', '💥'])expect(()=>modelInspectorDocument(bad)).toThrow();
 expect(()=>modelInspectorDocument('Z2xURg==',[0,0,0,2])).toThrow('orientation');
});
it('accepts only bounded validated orientation messages from the viewer',()=>{
 expect(modelInspectorMessage('{"type":"ready","rotation":[0,0,0,1]}')).toEqual({type:'ready',rotation:[0,0,0,1]});
 expect(modelInspectorMessage('{"type":"rotation","rotation":[1,0,0,0]}')).toEqual({type:'rotation',rotation:[1,0,0,0]});
 expect(modelInspectorMessage('{"type":"error"}')).toEqual({type:'error'});
 for(const bad of ['oops','{"type":"navigate","url":"https://example.com"}','{"type":"rotation","rotation":[0,0,0,8]}','x'.repeat(1025)])expect(modelInspectorMessage(bad)).toBeNull();
});
