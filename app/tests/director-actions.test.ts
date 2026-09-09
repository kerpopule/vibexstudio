import {beforeEach,expect,it,vi} from 'vitest';
import {directorAssetProposal} from '@/lib/director-actions';
import {reviewDirectorAsset,importDirectorAsset} from '@/lib/director-asset-import';
const mocks=vi.hoisted(()=>({entries:vi.fn(),read:vi.fn(),local:vi.fn(),project:vi.fn(),commit:vi.fn()}));
vi.mock('@/lib/library-entries',()=>({loadEntries:mocks.entries}));
vi.mock('@/lib/remote-library',()=>({readRemoteAsset:mocks.read}));
vi.mock('@/lib/storage/import-source',()=>({readImportSource:mocks.local}));
vi.mock('@/lib/storage/projects',()=>({readProject:mocks.project,importBinaryAssetExclusive:mocks.commit}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_:string,text:string)=>(await import('node:crypto')).createHash('sha256').update(text).digest('hex')}));
const entry={id:'server-video',kind:'video',prompt:'Victory clip',createdAt:1,mimeType:'video/mp4',uri:'',remote:{id:'video',kind:'video',title:'Victory clip',prompt:'',createdAt:1,fileName:'victory.mp4',mimeType:'video/mp4',bytes:3,providerLabel:'Owned',serverUrl:'https://lab.example'}};
const block=(value:unknown)=>'Use this clip.\n```vibex-action\n'+JSON.stringify(value)+'\n```';
beforeEach(()=>{vi.resetAllMocks();mocks.entries.mockResolvedValue({items:[entry],remoteError:null,deviceError:null});mocks.project.mockResolvedValue({id:'game',createdAt:1});mocks.read.mockResolvedValue(new Uint8Array([1,2,3]));mocks.commit.mockResolvedValue({alreadyImported:false});});
it('turns only one strictly bounded asset proposal into a review, never a command or path',()=>{
 const proposal={type:'import-library-asset',assetId:'server-video'};
 expect(directorAssetProposal(block(proposal))).toEqual({text:'Use this clip.',proposal});
 for(const bad of [{...proposal,path:'assets/code.js'},{...proposal,assetId:'https://other/secret'},[],{...proposal,type:'run-command'}, {...proposal,assetId:'server-../secret'}])expect(directorAssetProposal(block(bad)).proposal).toBeNull();
 expect(directorAssetProposal(block(proposal)+block(proposal)).proposal).toBeNull();
 expect(mocks.commit).not.toHaveBeenCalled();
});
it('reviews real metadata without downloading and copies only after the separate action',async()=>{
 const review=await reviewDirectorAsset('game','server-video','https://lab.example');
 expect(review.entry.prompt).toBe('Victory clip');expect(review.path).toMatch(/^assets\/Videos\/victory-[a-f0-9]{32}\.mp4$/);
 expect(mocks.read).not.toHaveBeenCalled();expect(mocks.commit).not.toHaveBeenCalled();
 await expect(importDirectorAsset(review,()=>true)).resolves.toMatchObject({path:review.path});
 expect(mocks.commit).toHaveBeenCalledWith('game',review.path,new Uint8Array([1,2,3]),1);
 expect((await reviewDirectorAsset('game','server-video','https://other.example')).path).not.toBe(review.path);
});
it('blocks changed metadata, project replacement and missing assets before download',async()=>{
 const review=await reviewDirectorAsset('game','server-video','https://lab.example');
 mocks.entries.mockResolvedValueOnce({items:[{...entry,prompt:'Different clip'}]});
 await expect(importDirectorAsset(review,()=>true)).rejects.toThrow('Library item changed');
 mocks.project.mockResolvedValueOnce({id:'game',createdAt:2});
 await expect(importDirectorAsset(review,()=>true)).rejects.toThrow('project changed');
 await expect(reviewDirectorAsset('game','server-missing')).rejects.toThrow('no longer');
 expect(mocks.read).not.toHaveBeenCalled();expect(mocks.commit).not.toHaveBeenCalled();
});
it('does not commit if builder or connection changes during download, or bytes no longer match',async()=>{
 const review=await reviewDirectorAsset('game','server-video','https://lab.example');let ready=true;
 mocks.read.mockImplementationOnce(async()=>{ready=false;return new Uint8Array([1,2,3]);});
 await expect(importDirectorAsset(review,()=>ready)).rejects.toThrow('became busy');
 mocks.read.mockResolvedValueOnce(new Uint8Array([1]));
 await expect(importDirectorAsset(review,()=>true)).rejects.toThrow('file changed');
 expect(mocks.commit).not.toHaveBeenCalled();
});
it('supports device media without following arbitrary remote URLs',async()=>{
 const device={...entry,id:'device-song',kind:'audio',mimeType:'audio/wav',uri:'blob:owned',remote:undefined};
 mocks.entries.mockResolvedValue({items:[device]});mocks.local.mockResolvedValue(new Uint8Array([4,5]));
 const review=await reviewDirectorAsset('game','device-song');await importDirectorAsset(review,()=>true);
 expect(mocks.local).toHaveBeenCalledWith('blob:owned');expect(review.path).toMatch(/\.wav$/);
 mocks.entries.mockResolvedValue({items:[{...device,uri:'https://other.example/track'}]});
 const unsafe=await reviewDirectorAsset('game','device-song');
 await expect(importDirectorAsset(unsafe,()=>true)).rejects.toThrow('not stored locally');
 expect(mocks.local).toHaveBeenCalledTimes(1);
});
it('uses the exclusive commit retry result and preserves its conflict rejection',async()=>{
 const review=await reviewDirectorAsset('game','server-video');mocks.commit.mockResolvedValueOnce({alreadyImported:true});
 await expect(importDirectorAsset(review,()=>true)).resolves.toMatchObject({alreadyImported:true});
 mocks.commit.mockRejectedValueOnce(new Error('different content'));
 await expect(importDirectorAsset(review,()=>true)).rejects.toThrow('different content');
});

it('keeps names readable and isolates same-named assets without accepting path syntax',async()=>{
 const first=await reviewDirectorAsset('game','server-video','https://lab.example');
 mocks.entries.mockResolvedValue({items:[{...entry,id:'server-other',remote:{...entry.remote,id:'other'}}]});
 const second=await reviewDirectorAsset('game','server-other','https://lab.example');
 expect(first.path).not.toBe(second.path);expect(second.path).toContain('assets/Videos/victory-');
 mocks.entries.mockResolvedValue({items:[{...entry,remote:{...entry.remote,fileName:'../CON /'+('a'.repeat(500))+'.mp4'}}]});
 const unsafeName=await reviewDirectorAsset('game','server-video','https://lab.example');
 expect(unsafeName.path.length).toBeLessThanOrEqual(180);expect(unsafeName.path).not.toContain('..');
 expect(unsafeName.path.split('/')).toHaveLength(3);
});
