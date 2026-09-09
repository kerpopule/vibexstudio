import {expect, it} from 'vitest';
import {directorProjectContext} from '@/lib/director-project-context';

const project = {id:'project-one',name:'My game'};

it('sends only media paths and types, without reading file contents', () => {
  const files = ['index.html','app.js','secrets.json','assets/win clip.mp4','assets/hero.glb','assets/logo.svg']
    .map(path=>({path,get content(): string {throw new Error('File content must not be read');}}));
  expect(directorProjectContext(project,files)).toEqual({version:1,projectId:'project-one',title:'My game',assets:[
    {path:'assets/win clip.mp4',kind:'video'},{path:'assets/hero.glb',kind:'model'},{path:'assets/logo.svg',kind:'image'}]});
});

it('supports an explicit selection without silently dropping requested assets', () => {
  const files=Array.from({length:33},(_,i)=>({path:`assets/${i}.png`}));
  expect(()=>directorProjectContext(project,files)).toThrow('32');
  expect(directorProjectContext(project,files,['assets/32.png']).assets).toEqual([{path:'assets/32.png',kind:'image'}]);
  expect(()=>directorProjectContext(project,files,['assets/missing.png'])).toThrow('no longer');
  expect(directorProjectContext(project,files,[]).assets).toEqual([]);
});

it.each(['/private.png','assets/../private.png','https://host/image.png','C:\\private.png','assets/a\nb.png'])(
  'rejects non-project asset path %s', path => {
    expect(()=>directorProjectContext(project,[{path}])).toThrow('relative');
  });

it('rejects duplicate paths and oversized metadata', () => {
  expect(()=>directorProjectContext(project,[{path:'a.png'},{path:'a.png'}])).toThrow('duplicate');
  expect(()=>directorProjectContext(project,[{path:'a.png'}],['a.png','a.png'])).toThrow('once');
  expect(()=>directorProjectContext({...project,name:'x'.repeat(161)},[])).toThrow('name');
});


it('refreshes default assets after import but preserves deliberate selections', async () => {
  const {refreshDirectorSelection} = await import('@/lib/director-project-context');
  const paths=['old.png','new.glb'];
  expect(refreshDirectorSelection(paths,['old.png'],false)).toEqual(paths);
  expect(refreshDirectorSelection(paths,['old.png'],true)).toEqual(['old.png']);
  expect(refreshDirectorSelection(paths,[],true)).toEqual([]);
  expect(refreshDirectorSelection(['new.glb'],['old.png'],true)).toEqual([]);
  const large=Array.from({length:33},(_,i)=>`${i}.png`);
  expect(refreshDirectorSelection(large,null,false)).toEqual([]);
  expect(refreshDirectorSelection(large,large.slice(0,32),false)).toEqual(large.slice(0,32));
});
