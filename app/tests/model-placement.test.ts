import {expect, it} from 'vitest';
import {createModelPlacement, readModelPlacement, modelPlacementPath} from '@/lib/model-placement';
it('round-trips a chosen orientation alongside a portable model', () => {
  const value = createModelPlacement('assets/my chair.glb', [Math.SQRT1_2,0,0,Math.SQRT1_2]);
  expect(value.model).toBe('my chair.glb');
  expect(modelPlacementPath('assets/my chair.glb')).toBe('assets/my chair.glb.vibex-model.json');
  expect(readModelPlacement(JSON.stringify(value), 'assets/my chair.glb')).toEqual(value);
});
it('rejects unrelated settings, mismatched models and invalid quaternions', () => {
  const value=createModelPlacement('assets/chair.glb',[0,0,0,1]);
  for (const changed of [{...value,version:2},{...value,model:'other.glb'},{...value,rotation:[0,0,0,0]},{...value,rotation:[0,1]}]) {
    expect(()=>readModelPlacement(JSON.stringify(changed),'assets/chair.glb')).toThrow();
  }
  expect(()=>createModelPlacement('assets/chair.glb',[NaN,0,0,1])).toThrow();
});
