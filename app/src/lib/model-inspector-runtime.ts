/** Browser runtime bundled locally for the native WebView; no remote scripts. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const host=window as typeof window&{
 __vibexModel:{base64:string;rotation:number[]};
 ReactNativeWebView?:{postMessage(message:string):void};
 vibexModelAction?:(action:string)=>void;
};
const report=(value:unknown)=>host.ReactNativeWebView?.postMessage(JSON.stringify(value));
void(async()=>{
 const raw=atob(host.__vibexModel.base64),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 const manager=new THREE.LoadingManager();
 manager.setURLModifier(url=>{if(url.startsWith('blob:')||url.startsWith('data:'))return url;throw new Error('External resources are unavailable');});
 const gltf=await new GLTFLoader(manager).parseAsync(bytes.buffer,'');
 const renderer=new THREE.WebGLRenderer({antialias:true});
 const scene=new THREE.Scene();scene.background=new THREE.Color('#10121a');
 const pivot=new THREE.Group();pivot.add(gltf.scene);scene.add(pivot);
 const sphere=new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());
 if(!Number.isFinite(sphere.radius)||sphere.radius<=0)throw new Error('Empty model');
 gltf.scene.position.sub(sphere.center);pivot.quaternion.fromArray(host.__vibexModel.rotation);
 const camera=new THREE.PerspectiveCamera(40,1,sphere.radius/100,sphere.radius*100);
 camera.position.set(sphere.radius*1.8,sphere.radius,sphere.radius*3);camera.lookAt(0,0,0);
 scene.add(new THREE.HemisphereLight(0xffffff,0x555555,3));
 const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,5,4);scene.add(light);
 document.body.appendChild(renderer.domElement);
 const draw=()=>renderer.render(scene,camera);
 const resize=()=>{renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/Math.max(1,innerHeight);camera.updateProjectionMatrix();draw();};
 host.vibexModelAction=action=>{
  if(action==='reset')pivot.quaternion.identity();
  else if(action==='turn'||action==='tip')pivot.rotateOnWorldAxis(new THREE.Vector3(action==='tip'?1:0,action==='turn'?1:0,0),Math.PI/2);
  else return;
  draw();report({type:'rotation',rotation:pivot.quaternion.toArray()});
 };
 addEventListener('resize',resize);
 addEventListener('pagehide',()=>{
  removeEventListener('resize',resize);delete host.vibexModelAction;
  gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material]){for(const value of Object.values(material))if(value instanceof THREE.Texture)value.dispose();material.dispose();}}});
  renderer.dispose();
 },{once:true});
 resize();report({type:'ready',rotation:pivot.quaternion.toArray()});
})().catch(()=>report({type:'error'}));
