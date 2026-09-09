import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { buildPreviewDocument } from '@/lib/preview-document';
import { rewritePreviewAssets } from '@/lib/preview-assets';
import { createModelPlacement, modelPlacementPath, readModelPlacement } from '@/lib/model-placement';
import { decodeBundle, encodeBundle } from '@/lib/share/bundle';

function render(files: Parameters<typeof buildPreviewDocument>[0]) {
  const html=buildPreviewDocument(files,(path)=>path.endsWith('.png'))!;
  const blobs: Blob[]=[];
  let page='';
  const script=html.slice(html.indexOf('<script>')+8,html.indexOf('</script>'));
  runInNewContext(script,{Blob,atob,Uint8Array,URL:{createObjectURL:(blob:Blob)=>{blobs.push(blob);return `blob:test${blobs.length}`;}},
    document:{open(){},write(text:string){page=text;},close(){}}});
  return {html,blobs,page};
}
it('builds JSON before its script and resolves atlas image relative to JSON',async()=>{
  const result=render([
    {path:'game.js',content:"fetch('assets/atlas.json')"},
    {path:'index.html',content:'<script src="game.js"></script>'},
    {path:'assets/atlas.json',content:'{"meta":{"image":"atlas.png"}}'},
    {path:'assets/atlas.png',content:btoa('png-fixture'),encoding:'base64'},
  ]);
  expect(await result.blobs[0].text()).toBe('png-fixture');
  expect(JSON.parse(await result.blobs[1].text()).meta.image).toBe('blob:test1');
  expect(await result.blobs[2].text()).toBe("fetch('blob:test2')");
  expect(result.page).toBe('<script src="blob:test3"></script>');
});
it('keeps project script terminators inside the sandbox payload',()=>{
  const content='<h1>Game</h1><script>window.test="</script><script>still inside</script>";</script>';
  const result=render([{path:'index.html',content}]);
  expect(result.html.match(/<script>/g)).toHaveLength(1);
  expect(result.html.match(/<\/script>/g)).toHaveLength(1);
  expect(result.page).toBe(content);
});
it('matches static rewrite semantics for CSS, JSON and game script references',async()=>{
  for(const [path,content] of [
    ['styles/main.css','.badge {background:url(../assets/atlas.png)}'],
    ['assets/data.json','{"image":"./atlas.png"}'],
    ['game.js',"image.src='assets/atlas.png';remote='https://site.test/image.png';"],
  ]) {
    const result=render([{path:'index.html',content:'ok'},{path,content},
      {path:'assets/atlas.png',content:btoa('fixture'),encoding:'base64'}]);
    expect(await result.blobs[1].text()).toBe(rewritePreviewAssets(content,path,new Map([['assets/atlas.png','blob:test1']])));
  }
});
it('does not change source project files or invent an index',()=>{
  expect(buildPreviewDocument([],()=>false)).toBeNull();
  const files=[{path:'index.html',content:'<img src="a.png">'},{path:'a.png',content:btoa('fixture'),encoding:'base64'}];
  const before=JSON.stringify(files); render(files);
  expect(JSON.stringify(files)).toBe(before);
});
it('resolves encoded model names while preserving malformed and escaping paths', async () => {
  const content = "load('assets/my%20chair.glb'); load('%2e%2e/assets/my%20chair.glb'); load('assets%2fmy%20chair.glb'); load('assets/bad%zz.glb');";
  const expected = "load('blob:test1'); load('%2e%2e/assets/my%20chair.glb'); load('assets%2fmy%20chair.glb'); load('assets/bad%zz.glb');";
  const result = render([
    { path: 'index.html', content: '<script src="game.js"></script>' },
    { path: 'game.js', content },
    { path: 'assets/my chair.glb', content: btoa('model-fixture'), encoding: 'base64' },
  ]);
  expect(await result.blobs[1].text()).toBe(expected);
  expect(rewritePreviewAssets(content, 'game.js', new Map([['assets/my chair.glb', 'blob:test1']]))).toBe(expected);
  expect(result.blobs[0].type).toBe('model/gltf-binary');
});
it('keeps saved orientation and model together across sharing and preview rewriting', async () => {
  const path = 'assets/my chair.glb';
  const placementPath = modelPlacementPath(path);
  const placement = createModelPlacement(path, [Math.SQRT1_2, 0, 0, -Math.SQRT1_2]);
  const files = [
    {path: 'index.html', content: '<script src="game.js"></script>', encoding: 'utf-8' as const},
    {path: 'game.js', content: `fetch('${placementPath}')`, encoding: 'utf-8' as const},
    {path, content: btoa('unchanged-binary-model'), encoding: 'base64' as const},
    {path: placementPath, content: JSON.stringify(placement), encoding: 'utf-8' as const},
  ];
  const imported = decodeBundle(encodeBundle({name:'Chair game', emoji:'🪑', description:'', files}, 123));
  expect(imported.files).toEqual(files);
  const saved = imported.files.find(file => file.path === placementPath)!;
  expect(readModelPlacement(saved.content, path)).toEqual(placement);
  const result = render(imported.files);
  expect(await result.blobs[0].text()).toBe('unchanged-binary-model');
  const rewritten = JSON.parse(await result.blobs[1].text());
  expect(rewritten.model).toBe('blob:test1');
  expect(rewritten.rotation).toEqual(placement.rotation);
  expect(rewritten.center).toBe('bounds');
  expect(await result.blobs[2].text()).toBe("fetch('blob:test2')");
  // The exported file keeps a portable relative name, never a preview-only blob.
  expect(saved.content).toBe(JSON.stringify(placement));
});
