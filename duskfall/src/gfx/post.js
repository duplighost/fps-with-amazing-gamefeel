// Post-processing: render the world into an HDR multisampled target, add a
// subtle bloom on highlights (sun, muzzle flashes, tracers), then ACES tone-map
// + sRGB via OutputPass. The viewmodel is drawn forward on top afterwards.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function buildComposer(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const dpr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, {
    type: THREE.HalfFloatType, samples: 4,
  });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(dpr);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  // subtle bloom — high threshold so only genuinely HDR-bright things (the
  // sky near the sun) glow, not muzzle particles/tracers
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.4, 1.2);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  return {
    composer,
    bloom,
    setSize(w, h) { composer.setSize(w, h); bloom.setSize(w, h); },
    render() { composer.render(); },
  };
}
