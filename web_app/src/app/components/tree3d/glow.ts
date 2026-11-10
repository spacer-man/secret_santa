/**
 * Glow sprites are flat and always face the camera: where the plane crosses a
 * model (a post, a roof edge) the cut is visible. `pushForward` keeps the sprite
 * where it is on screen but tests its depth nearer to the camera, so the things
 * it surrounds no longer slice it, while everything really in front still hides it.
 */
import * as THREE from 'three';

/** Objects on this layer are never drawn (the camera sees only layer 0) */
export const HIDDEN_LAYER = 1;

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

/**
 * Colour of a light source for the bloom: scaled so that its brightness is
 * `power` (above 1 = glows). Saturated colours (red, blue) are dim for the eye
 * and need a bigger push than white to start glowing.
 */
export function emit(color: THREE.ColorRepresentation, power: number): THREE.Color {
  const c = new THREE.Color(color);
  const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return c.multiplyScalar(THREE.MathUtils.clamp(power / Math.max(luminance, 1e-3), 1, 3.5));
}
