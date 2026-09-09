import {expect,it} from 'vitest';
import {musicVideoSelection} from '@/lib/music-video-plan';
import type {RemoteLibraryAsset} from '@/lib/library-core';
const asset=(id:string,kind:RemoteLibraryAsset['kind']):RemoteLibraryAsset=>({id,kind,title:id,prompt:'',createdAt:0,fileName:id,mimeType:'',bytes:100,providerLabel:'My server',serverUrl:'http://localhost'});
const assets=[asset('song','audio'),asset('song2','audio'),asset('scene1','image'),asset('scene2','video'),asset('model','model')];
it('keeps scene selection order while placing the soundtrack first in the durable request',()=>{
 const plan=musicVideoSelection(['scene2','song','scene1'],assets);
 expect(plan.assetIds).toEqual(['song','scene2','scene1']);expect(plan.scenes.map(row=>row.id)).toEqual(['scene2','scene1']);
});
it('rejects incomplete, unavailable, duplicate, or unsupported media selections',()=>{
 for(const ids of [[],['scene1'],['song'],['song','song2','scene1'],['song','gone'],['song','scene1','scene1'],['song','model']])expect(()=>musicVideoSelection(ids,assets)).toThrow();
});
it('respects the eight-source server limit without dropping chosen scenes',()=>{
 const rows=[asset('song','audio'),...Array.from({length:8},(_,i)=>asset('scene'+i,'image'))];
 expect(musicVideoSelection(rows.slice(0,8).map(row=>row.id),rows).scenes).toHaveLength(7);
 expect(()=>musicVideoSelection(rows.map(row=>row.id),rows)).toThrow('seven');
});
