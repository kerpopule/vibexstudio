import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import type { ModelRotation } from '@/lib/model-placement';

/** Local inspection only: never modifies the source model or contacts its server. */
export function ModelInspector({base64, initialRotation, onSave}: {base64: string; initialRotation?: ModelRotation; onSave?: (rotation: ModelRotation) => Promise<void>}) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<((action: 'turn' | 'tip' | 'reset') => void) | null>(null);
  const [status, setStatus] = useState('Loading 3D preview…');
  const [ready, setReady] = useState(false);
  const rotation = useRef<ModelRotation>([0, 0, 0, 1]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    let ownedControls: typeof controls.current = null;
    const release = () => {
      const dispose = cleanup;
      cleanup = () => {};
      dispose();
      if (controls.current === ownedControls) controls.current = null;
    };
    void (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      if (cancelled || !host.current) return;
      setReady(false); setStatus('Loading 3D preview…');
      if (base64.length > Math.ceil(64 * 1024 * 1024 / 3) * 4) throw new Error('Model too large');
      const raw = atob(base64), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      // Embedded textures are allowed; server and filesystem URLs are refused.
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => {
        if (url.startsWith('blob:') || url.startsWith('data:')) return url;
        throw new Error('External model resources are unavailable');
      });
      const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, '');
      const disposeModel = () => gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      });
      if (cancelled || !host.current) { disposeModel(); return; }
      cleanup = disposeModel;
      const renderer = new THREE.WebGLRenderer({antialias: true});
      cleanup = () => {disposeModel(); renderer.dispose(); renderer.domElement.remove();};
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#192332');
      const pivot = new THREE.Group(); pivot.add(gltf.scene); scene.add(pivot);
      if (initialRotation) pivot.quaternion.fromArray(initialRotation);
      rotation.current = pivot.quaternion.toArray() as ModelRotation;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) throw new Error('Empty model');
      gltf.scene.position.sub(sphere.center);
      const camera = new THREE.PerspectiveCamera(40, 1, sphere.radius / 100, sphere.radius * 100);
      camera.position.set(sphere.radius * 1.8, sphere.radius, sphere.radius * 3); camera.lookAt(0, 0, 0);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);
      const container = host.current; container.appendChild(renderer.domElement);
      renderer.domElement.setAttribute('aria-label', '3D model preview');
      const draw = () => renderer.render(scene, camera);
      const resize = () => {
        const width = Math.max(1, container.clientWidth);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(width, 320);
        camera.aspect = width / 320; camera.updateProjectionMatrix(); draw();
      };
      const observer = new ResizeObserver(resize); observer.observe(container);
      cleanup = () => {observer.disconnect(); disposeModel(); renderer.dispose(); renderer.domElement.remove();};
      ownedControls = action => {
        if (action === 'reset') pivot.quaternion.identity();
        else pivot.rotateOnWorldAxis(new THREE.Vector3(action === 'tip' ? 1 : 0, action === 'turn' ? 1 : 0, 0), Math.PI / 2);
        rotation.current = pivot.quaternion.toArray() as ModelRotation;
        setSaveMessage('');
        draw();
      };
      controls.current = ownedControls;
      resize(); setReady(true); setStatus('Rotation leaves the original model unchanged. Save its orientation to use it in your project.');
    })().catch(() => {
      release();
      if (!cancelled) {setReady(false); setStatus('This model could not be previewed here. Your saved file is unchanged and can still be used or exported.');}
    });
    return () => {cancelled = true; release();};
  }, [base64, initialRotation]);
  return <View style={{gap: 12}}>
    <div ref={host} style={{width: '100%', minHeight: ready ? 320 : 0, overflow: 'hidden'}} />
    <ThemedText accessibilityLiveRegion="polite">{status}</ThemedText>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      <Button title="Turn 90°" disabled={!ready} onPress={() => controls.current?.('turn')} />
      <Button title="Tip 90°" disabled={!ready} onPress={() => controls.current?.('tip')} />
      <Button title="Reset view" variant="secondary" disabled={!ready} onPress={() => controls.current?.('reset')} />
    </View>
    {onSave ? <Button title={saving ? 'Saving orientation…' : 'Save orientation for builder'} disabled={!ready || saving} onPress={() => {
      setSaving(true); setSaveMessage('');
      void onSave([...rotation.current]).then(() => setSaveMessage('Orientation saved with this project. Ask the builder to use it.'))
        .catch(error => setSaveMessage(error instanceof Error ? error.message : 'Could not save orientation. Try again.'))
        .finally(() => setSaving(false));
    }} /> : null}
    {saveMessage ? <ThemedText accessibilityLiveRegion="polite">{saveMessage}</ThemedText> : null}
  </View>;
}
