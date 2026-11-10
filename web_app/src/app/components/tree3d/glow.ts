/**
 * Glow sprites are flat and always face the camera: where the plane crosses a
 * model (a post, a roof edge) the cut is visible. `pushForward` keeps the sprite
 * where it is on screen but tests its depth nearer to the camera, so the things
 * it surrounds no longer slice it, while everything really in front still hides it.
 */
import * as THREE from 'three';

export function pushForward<T extends THREE.SpriteMaterial>(material: T, distance: number): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['push'] = { value: distance };
    shader.vertexShader =
      'uniform float push;\n' +
      shader.vertexShader.replace(
        'gl_Position = projectionMatrix * mvPosition;',
        `gl_Position = projectionMatrix * mvPosition;
	vec4 nearer = projectionMatrix * ( mvPosition + vec4( 0.0, 0.0, push, 0.0 ) );
	if ( nearer.w > 0.0 ) gl_Position.z = nearer.z / nearer.w * gl_Position.w;`,
      );
  };
  material.customProgramCacheKey = () => 'glow-push';
  return material;
}
