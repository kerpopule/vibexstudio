import {modelInspectorRuntime} from '../generated/model-inspector-runtime';
import {createModelPlacement,type ModelRotation} from './model-placement';
export function modelInspectorDocument(base64:string,rotation:ModelRotation=[0,0,0,1]){
 if(!base64||base64.length>Math.ceil(64*1024*1024/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('This model cannot be previewed.');
 createModelPlacement('preview.glb',rotation);
 const payload=JSON.stringify({base64,rotation}).replace(/</g,'\\u003c');
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src blob: data:"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#10121a}canvas{display:block}</style></head><body><script>window.__vibexModel=${payload};${modelInspectorRuntime.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
}
export function modelInspectorMessage(raw:string):{type:'ready'|'rotation';rotation:ModelRotation}|{type:'error'}|null{
 try{
  if(raw.length>1024)return null;const value=JSON.parse(raw);
  if(value?.type==='error')return {type:'error'};
  if(!['ready','rotation'].includes(value?.type)||!Array.isArray(value.rotation))return null;
  return {type:value.type,rotation:createModelPlacement('preview.glb',value.rotation as ModelRotation).rotation};
 }catch{return null;}
}
