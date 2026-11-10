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

export interface VolumeGlow {
  mesh: THREE.Mesh;
  /** Brightness: 0 is off, 1 is the normal light */
  setPower(k: number): void;
}

/**
 * Volumetric glow of a lamp: lit air inside a ball around the flame, computed
 * per pixel along the view ray (not a picture turned to the camera). The hood
 * of the lamp (a disc `hood.r` wide, `hood.y` above the flame) casts a shadow:
 * the cone above it stays dark and the hood itself hides the light behind it.
 * Local space: the flame is at the origin.
 */
export function volumeGlow(
  radius: number,
  color: number,
  hood: { y: number; r: number },
  gain = 1,
): VolumeGlow {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      power: { value: 0 },
      radius: { value: radius },
      hood: { value: new THREE.Vector2(hood.y, hood.r) },
      gain: { value: gain * 0.075 * radius },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vPos;
      varying vec3 vCam;
      void main() {
        vPos = position;
        vCam = ( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float power;
      uniform float radius;
      uniform vec2 hood;
      uniform float gain;
      varying vec3 vPos;
      varying vec3 vCam;

      // Light scattered on the way from a to b along the ray: the density falls
      // with the square of the distance to the flame and is zero at the ball's edge
      float lit( float a, float b, float tc, float k, float edge ) {
        if ( b <= a ) return 0.0;
        return ( atan( ( b - tc ) / k ) - atan( ( a - tc ) / k ) ) / k - ( b - a ) * edge;
      }

      bool shaded( vec3 p, float ca ) {
        return p.y > 0.0 && p.y * p.y > ca * ca * dot( p, p );
      }

      void main() {
        vec3 ro = vCam;
        vec3 rd = normalize( vPos - vCam );
        float b = dot( ro, rd );
        float h = b * b - dot( ro, ro ) + radius * radius;
        if ( h <= 0.0 ) discard;
        float s = sqrt( h );
        float t0 = max( - b - s, 0.0 );
        float t1 = - b + s;

        // The hood is opaque: nothing is seen behind it
        if ( abs( rd.y ) > 1e-4 ) {
          float th = ( hood.x - ro.y ) / rd.y;
          vec3 p = ro + rd * th;
          if ( th > t0 && th < t1 && dot( p.xz, p.xz ) < hood.y * hood.y ) t1 = th;
        }

        float e = radius * 0.07;
        float tc = - b;
        float k = sqrt( max( dot( ro, ro ) - b * b, 0.0 ) + e * e );
        float edge = 1.0 / ( radius * radius + e * e );
        float light = lit( t0, t1, tc, k, edge );

        // The cone of shadow above the hood (apex in the flame, axis up)
        float ca = hood.x / length( hood );
        float A = rd.y * rd.y - ca * ca;
        float B = ro.y * rd.y - ca * ca * b;
        float C = ro.y * ro.y - ca * ca * dot( ro, ro );
        float D = B * B - A * C;
        if ( D > 0.0 && abs( A ) > 1e-5 ) {
          float q = sqrt( D );
          float u0 = ( - B - q ) / A;
          float u1 = ( - B + q ) / A;
          if ( u0 > u1 ) { float u = u0; u0 = u1; u1 = u; }
          float far = 4.0 * radius;
          if ( shaded( ro + rd * ( 0.5 * ( u0 + u1 ) ), ca ) ) light -= lit( max( t0, u0 ), min( t1, u1 ), tc, k, edge );
          else if ( shaded( ro + rd * ( u1 + far ), ca ) ) light -= lit( max( t0, u1 ), t1, tc, k, edge );
          else if ( shaded( ro + rd * ( u0 - far ), ca ) ) light -= lit( t0, min( t1, u0 ), tc, k, edge );
        }

        gl_FragColor = vec4( color * max( light, 0.0 ) * gain * power, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material);
  mesh.renderOrder = 2;
  return { mesh, setPower: (k) => (material.uniforms['power'].value = k) };
}
