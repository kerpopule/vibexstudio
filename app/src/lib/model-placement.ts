export type ModelRotation = [number, number, number, number];
export interface ModelPlacement {
  format: 'vibex-model-placement'; version: 1;
  model: string; center: 'bounds'; rotation: ModelRotation;
}
export function modelPlacementPath(modelPath: string): string {
  if (!modelPath.toLowerCase().endsWith('.glb')) throw new Error('Choose a GLB model.');
  return modelPath + '.vibex-model.json';
}
export function createModelPlacement(modelPath: string, rotation: ModelRotation): ModelPlacement {
  modelPlacementPath(modelPath);
  if (rotation.length !== 4 || rotation.some(v => !Number.isFinite(v)) || Math.abs(Math.hypot(...rotation) - 1) > 0.00001) {
    throw new Error('The model orientation is invalid. Reset the view and try again.');
  }
  return {format: 'vibex-model-placement', version: 1, model: modelPath.split('/').pop()!, center: 'bounds', rotation: [...rotation]};
}
export function readModelPlacement(text: string, modelPath: string): ModelPlacement {
  const value = JSON.parse(text);
  if (!value || value.format !== 'vibex-model-placement' || value.version !== 1 ||
      value.model !== modelPath.split('/').pop() || value.center !== 'bounds' || !Array.isArray(value.rotation)) {
    throw new Error('The existing orientation file is not recognized. It has not been changed.');
  }
  return createModelPlacement(modelPath, value.rotation as ModelRotation);
}
