import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.006 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain; uniform float uAberration; uniform vec2 uRes;
    varying vec2 vUv;
    float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uAberration;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float vig = smoothstep(0.9, 0.25, length(d * vec2(1.0, 0.92)));
      col *= mix(1.0 - uVignette, 1.0, vig);
      col += (rnd(vUv * uRes + fract(uTime * 7.13)) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { msaa = true, bloom = true } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.55, 0.95);
  bloomPass.enabled = bloom;
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    composer,
    bloomPass,
    grade,
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      grade.uniforms.uRes.value.set(s.x, s.y);
    },
    setQuality({ msaa: m, bloom: b }) {
      bloomPass.enabled = b;
      composer.renderTarget1.samples = m ? 4 : 0;
      composer.renderTarget2.samples = m ? 4 : 0;
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
    },
    render(dt) {
      grade.uniforms.uTime.value += dt;
      composer.render(dt);
    },
  };
}
