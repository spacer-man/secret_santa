/**
 * Kenney Holiday Kit models (CC0, https://kenney.nl/assets/holiday-kit).
 * Loaded lazily and re-materialised in our toon style.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { outlineMaterial, smoothForOutline } from './outline';

const BASE = '/models/holiday/';

export type ModelName =
  | 'train-locomotive'
  | 'train-tender'
  | 'train-wagon'
  | 'train-wagon-logs'
  | 'train-wagon-short'
  | 'snowman-hat'
  | 'snowman'
  | 'reindeer'
  | 'sled'
  | 'sled-long'
  | 'candy-cane-red'
  | 'candy-cane-green'
  | 'lantern'
  | 'bench'
  | 'present-a-cube'
  | 'present-a-rectangle'
  | 'present-a-round'
  | 'present-b-cube'
  | 'present-b-rectangle'
  | 'present-b-round'
  | 'tree-snow-a'
  | 'tree-snow-b'
  | 'tree-snow-c'
  | 'rocks-large'
  | 'rocks-medium'
  | 'rocks-small'
  | 'snow-pile'
  | 'snow-flat'
  | 'snow-flat-large'
  | 'gingerbread-man'
  | 'nutcracker'
  | 'wreath-decorated'
  | 'snow-bunker';

export class Models {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<ModelName, Promise<THREE.Group>>();
  private readonly materials = new Map<string, THREE.MeshToonMaterial>();

  constructor(private readonly gradient: THREE.Texture) {
  }

  /** A fresh copy of the model (geometry and materials are shared) */
  async get(name: ModelName, outline = true): Promise<THREE.Group> {
    if (!this.cache.has(name)) this.cache.set(name, this.load(name));
    const source = await this.cache.get(name)!;
    const copy = source.clone(true);
    if (outline) {
      copy.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !mesh.userData['outline']) {
          const hull = new THREE.Mesh(smoothForOutline(mesh.geometry), outlineMaterial());
          hull.userData['outline'] = true;
          mesh.add(hull);
        }
      });
    }
    return copy;
  }

  /** Geometry + material of a single-mesh model, for instancing */
  async mesh(name: ModelName): Promise<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
    const group = await this.get(name, false);
    let found: THREE.Mesh | undefined;
    group.traverse((o) => (found ??= (o as THREE.Mesh).isMesh ? (o as THREE.Mesh) : undefined));
    if (!found) throw new Error(`No mesh in ${name}`);
    found.updateWorldMatrix(true, false);
    const geometry = found.geometry.clone().applyMatrix4(found.matrixWorld);
    return { geometry, material: found.material as THREE.Material };
  }

  private async load(name: ModelName): Promise<THREE.Group> {
    const gltf = await this.loader.loadAsync(`${BASE}${name}.glb`);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.toon(mesh.material as THREE.MeshStandardMaterial);
    });
    return gltf.scene;
  }

  /** One toon material per original material (they all share the colour palette texture) */
  private toon(source: THREE.MeshStandardMaterial): THREE.MeshToonMaterial {
    const key = `${source.name}|${source.map?.uuid ?? ''}|${source.color?.getHexString()}`;
    let mat = this.materials.get(key);
    if (!mat) {
      if (source.map) {
        source.map.colorSpace = THREE.SRGBColorSpace;
        source.map.magFilter = THREE.NearestFilter;
      }
      mat = new THREE.MeshToonMaterial({ map: source.map, color: source.color, gradientMap: this.gradient });
      this.materials.set(key, mat);
    }
    return mat;
  }

  dispose(): void {
    this.materials.forEach((m) => m.dispose());
  }
}
