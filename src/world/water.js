import * as THREE from 'three';

const PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uDepthTex;
uniform vec4 uDepthRect;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoamCol;
uniform float uNight;
varying vec3 vWPos;

float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 wNoiseGrad(vec2 p) {
  const float e = 0.1;
  return vec2(wNoise(p + vec2(e, 0.0)) - wNoise(p - vec2(e, 0.0)), wNoise(p + vec2(0.0, e)) - wNoise(p - vec2(0.0, e))) / (2.0 * e);
}
vec2 waveSlope(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d1 = normalize(vec2(1.0, 0.35)); g += d1 * cos(dot(d1, p) * 0.32 + t * 1.05) * 0.02;
  vec2 d2 = normalize(vec2(-0.6, 1.0)); g += d2 * cos(dot(d2, p) * 0.55 + t * 1.45) * 0.016;
  vec2 d3 = normalize(vec2(0.2, -1.0)); g += d3 * cos(dot(d3, p) * 1.3 + t * 2.1) * 0.012;
  vec2 d4 = normalize(vec2(0.9, -0.4)); g += d4 * cos(dot(d4, p) * 2.7 + t * 3.1) * 0.008;
  g += wNoiseGrad(p * 0.23 + vec2(t * 0.06, t * 0.04)) * 0.06;
  g += wNoiseGrad(p * 0.61 + vec2(t * 0.12, t * 0.07)) * 0.05;
  g += wNoiseGrad(p * 1.7 - vec2(t * 0.25, -t * 0.18)) * 0.026;
  return g;
}
`;

export function createWater(island) {
  const uniforms = {
    uTime: { value: 0 },
    uDepthTex: { value: island.depthTex },
    uDepthRect: { value: island.depthRect },
    uShallow: { value: new THREE.Color(0x3fd2c4) },
    uDeep: { value: new THREE.Color(0x0f5f8c) },
    uFoamCol: { value: new THREE.Color(0xf7fbff) },
    uNight: { value: 0 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.07,
    metalness: 0,
    ior: 1.333,
    transparent: true,
    depthWrite: true,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 wuv = (vWPos.xz - uDepthRect.xy) / uDepthRect.zw;
        float inside = step(0.0, wuv.x) * step(0.0, wuv.y) * step(wuv.x, 1.0) * step(wuv.y, 1.0);
        float enc = texture2D(uDepthTex, clamp(wuv, 0.0, 1.0)).r;
        float groundH = mix(-12.0, mix(-12.0, 2.0, enc), inside);
        float wDepth = max(-groundH, 0.0);
        float shallowT = exp(-wDepth * 0.3);
        vec3 wCol = mix(uDeep, uShallow, shallowT);
        float fn1 = wNoise(vWPos.xz * 0.35 + uTime * 0.05);
        float fn2 = wNoise(vWPos.xz * 1.9 - uTime * 0.12);
        float band = sin(wDepth * 5.5 - uTime * 1.6 + fn1 * 4.0) * 0.5 + 0.5;
        float shoreMask = 1.0 - smoothstep(0.0, 1.5, wDepth);
        float wFoam = shoreMask * smoothstep(0.6, 0.92, band + fn2 * 0.28);
        wFoam = max(wFoam, (1.0 - smoothstep(0.0, 0.2, wDepth)) * (0.6 + 0.4 * fn2));
        wFoam = clamp(wFoam * inside, 0.0, 1.0);
        diffuseColor.rgb = mix(wCol, uFoamCol, wFoam);
        diffuseColor.a = mix(mix(0.45, 0.97, 1.0 - shallowT), 1.0, wFoam);`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, wFoam);')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          float wDist = length(vWPos - cameraPosition);
          float fade = exp(-wDist * 0.0035);
          vec2 sl = waveSlope(vWPos.xz, uTime) * (0.3 + 0.7 * fade) * (1.0 - wFoam * 0.7);
          vec3 wn = normalize(vec3(-sl.x, 1.0, -sl.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.15, 0.75, 1.0) * wFoam * uNight * (0.35 + 0.65 * fn2) * 1.6;'
      );
  };
  mat.customProgramCacheKey = () => 'pelican-water-v1';

  const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return {
    mesh,
    uniforms,
    update(dt, palette, night) {
      uniforms.uTime.value += dt;
      uniforms.uShallow.value.copy(palette.water[0]);
      uniforms.uDeep.value.copy(palette.water[1]);
      uniforms.uFoamCol.value.copy(palette.water[2]);
      uniforms.uNight.value = night;
    },
  };
}
