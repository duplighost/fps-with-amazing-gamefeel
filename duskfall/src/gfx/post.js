// Post-processing: render the world into an HDR multisampled target, bloom the
// highlights, ACES tone-map + sRGB via OutputPass, then a final cinematic COLOR
// GRADE (saturation, gentle S-contrast, lifted shadows, warm-highlight/cool-
// shadow split-tone) so the golden hour reads rich instead of muddy-brown. The
// viewmodel is drawn forward on top afterwards.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// A compact film-grade shader run on the tone-mapped image (display space).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.28 },          // richer colour
    uContrast: { value: 1.09 },     // gentle S-curve pop
    uLift: { value: 0.022 },        // keep shadows from crushing to mud
    uShadow: { value: new THREE.Color(0.90, 0.95, 1.08) },   // cool shadows
    uHigh: { value: new THREE.Color(1.07, 1.02, 0.90) },     // warm highlights
    uVignette: { value: 0.16 },     // soft corner falloff
    uGrade: { value: 1.0 },         // master mix (0 = bypass)
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSat, uContrast, uLift, uVignette, uGrade;
    uniform vec3 uShadow, uHigh;
    varying vec2 vUv;
    const vec3 L = vec3(0.2126, 0.7152, 0.0722);
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = src.rgb;
      // saturation
      float l = dot(col, L);
      col = mix(vec3(l), col, uSat);
      // contrast around mid grey
      col = (col - 0.5) * uContrast + 0.5;
      // lift shadows softly (no crushed blacks)
      col += uLift * (1.0 - col);
      // split-tone: cool shadows -> warm highlights by luma
      float lum = clamp(dot(col, L), 0.0, 1.0);
      col *= mix(uShadow, uHigh, smoothstep(0.0, 1.0, lum));
      // soft vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * dot(d, d) * 2.6;
      col *= vig;
      col = mix(src.rgb, clamp(col, 0.0, 1.0), uGrade);
      gl_FragColor = vec4(col, src.a);
    }
  `,
};

// Screen-space GOD RAYS: march each pixel toward the sun's screen position and
// accumulate the bright samples (sky peeking through the canopy), so warm light
// shafts fan out from the low sun. Fades out when the sun is off-screen/behind.
const GodrayShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.9) },
    uIntensity: { value: 0.0 },
    uTint: { value: new THREE.Color(1.0, 0.86, 0.62) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uIntensity;
    uniform vec3 uTint;
    varying vec2 vUv;
    const int N = 30;
    const float density = 0.68, weight = 0.24, decay = 0.945;
    const vec3 L = vec3(0.2126, 0.7152, 0.0722);
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.001) { gl_FragColor = base; return; }
      vec2 delta = (vUv - uSun) * (density / float(N));
      vec2 coord = vUv;
      float illum = 1.0;
      vec3 shaft = vec3(0.0);
      for (int i = 0; i < N; i++) {
        coord -= delta;
        vec3 s = texture2D(tDiffuse, clamp(coord, 0.0, 1.0)).rgb;
        float b = smoothstep(0.62, 1.0, dot(s, L));   // only bright sky scatters
        shaft += s * b * illum * weight;
        illum *= decay;
      }
      gl_FragColor = vec4(base.rgb + shaft * uIntensity * uTint, base.a);
    }
  `,
};

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

  // a soft glow on genuinely bright things (sun halo, glowing accents, snow) —
  // richer than the old near-off bloom, but the threshold stays high enough that
  // the whole frame doesn't wash out into haze
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.6, 1.05);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const godrays = new ShaderPass(GodrayShader);
  composer.addPass(godrays);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    composer,
    bloom,
    grade,
    godrays,
    // the game feeds the sun's screen position + a visibility factor each frame
    setSun(u, v, intensity) {
      godrays.uniforms.uSun.value.set(u, v);
      godrays.uniforms.uIntensity.value = intensity;
    },
    setSize(w, h) { composer.setSize(w, h); bloom.setSize(w, h); },
    // let the world nudge the grade per season (colder, greyer deep winter)
    setSeason(season, haunt) {
      const u = grade.uniforms;
      u.uSat.value = 1.28 - season * 0.16 - haunt * 0.12;
      u.uShadow.value.setRGB(0.90 + season * 0.06, 0.95 + season * 0.03, 1.08);
      u.uHigh.value.setRGB(1.07 - season * 0.05, 1.02, 0.90 + season * 0.08);
    },
    render() { composer.render(); },
  };
}
