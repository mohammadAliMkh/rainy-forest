import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 1) Global fog replacement: distance fog that starts a few meters away from
//    the camera (so the near scene, cabin & fire stay crisp) and is a bit
//    thicker close to the ground than up in the canopy.
// ---------------------------------------------------------------------------
export function installFogChunks() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWorldPos = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogWorldPos = instanceMatrix * fogWorldPos;
  #endif
  vFogWorld = ( modelMatrix * fogWorldPos ).xyz;
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 fogRay = vFogWorld - cameraPosition;
  float fogDist = max( length( fogRay ) - 7.0, 0.0 );
  float fogAvgH = clamp( ( vFogWorld.y + cameraPosition.y ) * 0.5 / 28.0, 0.0, 1.0 );
  float fogHeightK = mix( 1.0, 0.6, fogAvgH );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDist * fogDist * fogHeightK );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogDist );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

// ---------------------------------------------------------------------------
// 2) Wind: shared uniforms + a vertex patch for foliage / trunks / plants.
// ---------------------------------------------------------------------------
export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.5 },     // overall wind strength (0..1.5), driven by WindField
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
};

/**
 * Adds wind sway to a built-in material (works with InstancedMesh).
 * sway: bending amount (scaled by local height^2 * heightScale)
 * flutter: fast small leaf flutter amount
 */
export function applyWind(material, { sway = 0.02, flutter = 0.02, heightScale = 0.1, extraFragment = null } = {}) {
  const own = {
    uSway: { value: sway },
    uFlutter: { value: flutter },
    uHeightScale: { value: heightScale },
  };
  material.userData.wind = own;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, windUniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uSway;
uniform float uFlutter;
uniform float uHeightScale;`
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
  vec4 windW = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
    windW = instanceMatrix * windW;
  #endif
  windW = modelMatrix * windW;
  float hW = max( position.y, 0.0 ) * uHeightScale;
  float ph = uTime * 0.9 + windW.x * 0.07 + windW.z * 0.05;
  float gust = 0.55 + 0.45 * sin( uTime * 0.31 + windW.x * 0.013 + windW.z * 0.009 );
  float bend = ( sin( ph ) * 0.6 + sin( ph * 2.13 + 1.7 ) * 0.25 + 0.35 ) * gust * uWind;
  vec2 dir = uWindDir;
  transformed.x += dir.x * bend * uSway * hW * hW;
  transformed.z += dir.y * bend * uSway * hW * hW;
  float fl = sin( uTime * 6.3 + position.x * 7.0 + position.z * 5.0 + windW.x ) * sin( uTime * 4.1 + position.y * 3.0 );
  transformed += normal * fl * uFlutter * ( 0.4 + uWind ) * min( hW, 1.0 );
}`
      );
    if (extraFragment) extraFragment(shader);
  };
  material.customProgramCacheKey = () => 'wind-v3' + (extraFragment ? extraFragment.key || 'x' : '');
  return material;
}
