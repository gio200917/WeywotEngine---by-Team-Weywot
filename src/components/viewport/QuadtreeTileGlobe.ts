import * as THREE from 'three';
import { BODY_ELLIPSOIDS, latLonToThreeCartesian } from '../../engine/physics.js';
import type { BodyType } from '../../types/planetary.js';

export type TileScheme = 'mercator' | 'eq4326';

export interface TileProviderConfig {
  scheme: TileScheme;
  minZoom: number;
  maxZoom: number;
  getTileUrl: (z: number, x: number, y: number) => string;
  getElevationUrl?: (z: number, x: number, y: number) => string;
}

const PATCH_SEGS = 16;
const MAX_CONCURRENT_FETCHES = 8;
const MAX_CACHED_TILES_PER_PLANET = 190;
const SPLIT_PIXEL_THRESHOLD = 250;
const MERGE_PIXEL_THRESHOLD = 175;

function mercatorYToLatDeg(yTileFrac: number, n: number): number {
  const rad = Math.PI * (1 - (2 * yTileFrac) / n);
  return (Math.atan(Math.sinh(rad)) * 180) / Math.PI;
}

interface TilePatchNode {
  key: string;
  z: number;
  x: number;
  y: number;
  mesh: THREE.Mesh;
  centerLocal: THREE.Vector3;
  normalLocal: THREE.Vector3;
  boundingRadius: number;
  chordWidth: number;
  latGrid: Float32Array;
  lonGrid: Float32Array;
  skirtDepth: number;
  textureReady: boolean;
  textureLoading: boolean;
  elevationApplied: boolean;
  children: TilePatchNode[] | null;
  displacedElevGrid: Float32Array | null;
  lastUsedFrame: number;
  disposed: boolean;
}

interface FetchJob {
  node: TilePatchNode;
  planet: QuadtreePlanet;
  generation: number;
  distSq: number;
}

// Global bounded fetch queue shared across planets so zooming never saturates sockets
const pendingQueue: FetchJob[] = [];
let activeFetches = 0;

function pumpFetchQueue() {
  while (activeFetches < MAX_CONCURRENT_FETCHES && pendingQueue.length > 0) {
    // Pick nearest tile to camera
    let bestIdx = 0;
    for (let i = 1; i < pendingQueue.length; i++) {
      if (pendingQueue[i].distSq < pendingQueue[bestIdx].distSq) {
        bestIdx = i;
      }
    }
    const [job] = pendingQueue.splice(bestIdx, 1);
    if (
      job.planet.isDisposed ||
      job.generation !== job.planet.currentGeneration ||
      job.node.disposed ||
      job.node.textureReady
    ) {
      job.node.textureLoading = false;
      continue;
    }
    activeFetches++;
    void job.planet.executeTileFetch(job.node, job.generation).finally(() => {
      activeFetches--;
      pumpFetchQueue();
    });
  }
}

function buildPatchGeometry(
  body: BodyType,
  radius: number,
  scheme: TileScheme,
  z: number,
  x: number,
  y: number
): {
  geometry: THREE.BufferGeometry;
  centerLocal: THREE.Vector3;
  normalLocal: THREE.Vector3;
  boundingRadius: number;
  chordWidth: number;
  latGrid: Float32Array;
  lonGrid: Float32Array;
  skirtDepth: number;
} {
  const segs = PATCH_SEGS;
  const gridSide = segs + 1; // 17
  const gridVertCount = gridSide * gridSide; // 289
  const totalVertCount = gridVertCount + 4 * gridSide; // 357 (grid + 4 border skirts)

  const positions = new Float32Array(totalVertCount * 3);
  const normals = new Float32Array(totalVertCount * 3);
  const uvs = new Float32Array(totalVertCount * 2);
  const latGrid = new Float32Array(gridVertCount);
  const lonGrid = new Float32Array(gridVertCount);

  const cols = scheme === 'mercator' ? 2 ** z : 2 ** (z + 1);
  const rows = 2 ** z;

  const { e2 } = BODY_ELLIPSOIDS[body];
  const oneMinusE2 = 1 - e2;

  for (let r = 0; r <= segs; r++) {
    const vFrac = r / segs;
    const latDeg =
      scheme === 'mercator'
        ? mercatorYToLatDeg(y + vFrac, rows)
        : 90 - ((y + vFrac) / rows) * 180;
    const latRad = (latDeg * Math.PI) / 180;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);

    for (let c = 0; c <= segs; c++) {
      const uFrac = c / segs;
      const lonDeg = -180 + ((x + uFrac) / cols) * 360;
      const idx = r * gridSide + c;
      latGrid[idx] = latDeg;
      lonGrid[idx] = lonDeg;

      const pt = latLonToThreeCartesian(latDeg, lonDeg, 0, body, radius);
      positions[idx * 3] = pt.x;
      positions[idx * 3 + 1] = pt.y;
      positions[idx * 3 + 2] = pt.z;

      // Analytical outward normal for oblate spheroid
      const lonRad = (lonDeg * Math.PI) / 180;
      const nx = cosLat * Math.cos(lonRad);
      const ny = sinLat / Math.max(0.5, oneMinusE2);
      const nz = -cosLat * Math.sin(lonRad);
      const nLen = Math.hypot(nx, ny, nz) || 1;
      normals[idx * 3] = nx / nLen;
      normals[idx * 3 + 1] = ny / nLen;
      normals[idx * 3 + 2] = nz / nLen;

      uvs[idx * 2] = uFrac;
      uvs[idx * 2 + 1] = 1 - vFrac;
    }
  }

  // Compute chordWidth & bounding sphere
  const nwIdx = 0;
  const seIdx = gridVertCount - 1;
  const dx = positions[seIdx * 3] - positions[nwIdx * 3];
  const dy = positions[seIdx * 3 + 1] - positions[nwIdx * 3 + 1];
  const dz = positions[seIdx * 3 + 2] - positions[nwIdx * 3 + 2];
  const chordWidth = Math.hypot(dx, dy, dz) * 0.7071;
  const skirtDepth = Math.min(radius * 0.03, Math.max(radius * 0.00025, chordWidth * 0.018));

  const midIdx = Math.floor(segs / 2) * gridSide + Math.floor(segs / 2);
  const centerLocal = new THREE.Vector3(
    positions[midIdx * 3],
    positions[midIdx * 3 + 1],
    positions[midIdx * 3 + 2]
  );
  const normalLocal = new THREE.Vector3(
    normals[midIdx * 3],
    normals[midIdx * 3 + 1],
    normals[midIdx * 3 + 2]
  ).normalize();

  let maxR = 0;
  for (let i = 0; i < gridVertCount; i++) {
    const dist = Math.hypot(
      positions[i * 3] - centerLocal.x,
      positions[i * 3 + 1] - centerLocal.y,
      positions[i * 3 + 2] - centerLocal.z
    );
    if (dist > maxR) maxR = dist;
  }

  // Build 4 edge skirts (Top, Bottom, Left, Right) to hide inter-LOD seams
  const edgeIndices: number[][] = [
    Array.from({ length: gridSide }, (_, c) => c), // Top (r=0)
    Array.from({ length: gridSide }, (_, c) => segs * gridSide + c), // Bottom (r=segs)
    Array.from({ length: gridSide }, (_, r) => r * gridSide), // Left (c=0)
    Array.from({ length: gridSide }, (_, r) => r * gridSide + segs), // Right (c=segs)
  ];

  let skirtOffset = gridVertCount;
  for (let e = 0; e < 4; e++) {
    const edge = edgeIndices[e];
    for (let k = 0; k < gridSide; k++) {
      const src = edge[k];
      const dst = skirtOffset + k;
      positions[dst * 3] = positions[src * 3] - normals[src * 3] * skirtDepth;
      positions[dst * 3 + 1] = positions[src * 3 + 1] - normals[src * 3 + 1] * skirtDepth;
      positions[dst * 3 + 2] = positions[src * 3 + 2] - normals[src * 3 + 2] * skirtDepth;
      normals[dst * 3] = normals[src * 3];
      normals[dst * 3 + 1] = normals[src * 3 + 1];
      normals[dst * 3 + 2] = normals[src * 3 + 2];
      uvs[dst * 2] = uvs[src * 2];
      uvs[dst * 2 + 1] = uvs[src * 2 + 1];
    }
    skirtOffset += gridSide;
  }

  const indices: number[] = [];
  // Surface triangles (counter-clockwise outward winding)
  for (let r = 0; r < segs; r++) {
    for (let c = 0; c < segs; c++) {
      const tl = r * gridSide + c;
      const tr = tl + 1;
      const bl = (r + 1) * gridSide + c;
      const br = bl + 1;
      indices.push(tl, bl, tr);
      indices.push(tr, bl, br);
    }
  }

  // Skirt triangles
  const skirtBaseOffsets = [
    gridVertCount,
    gridVertCount + gridSide,
    gridVertCount + gridSide * 2,
    gridVertCount + gridSide * 3,
  ];
  // Top edge (left->right, skirt below)
  for (let k = 0; k < segs; k++) {
    const a = edgeIndices[0][k];
    const b = edgeIndices[0][k + 1];
    const sa = skirtBaseOffsets[0] + k;
    const sb = skirtBaseOffsets[0] + k + 1;
    indices.push(a, b, sa);
    indices.push(b, sb, sa);
  }
  // Bottom edge
  for (let k = 0; k < segs; k++) {
    const a = edgeIndices[1][k];
    const b = edgeIndices[1][k + 1];
    const sa = skirtBaseOffsets[1] + k;
    const sb = skirtBaseOffsets[1] + k + 1;
    indices.push(a, sa, b);
    indices.push(b, sa, sb);
  }
  // Left edge
  for (let k = 0; k < segs; k++) {
    const a = edgeIndices[2][k];
    const b = edgeIndices[2][k + 1];
    const sa = skirtBaseOffsets[2] + k;
    const sb = skirtBaseOffsets[2] + k + 1;
    indices.push(a, sa, b);
    indices.push(b, sa, sb);
  }
  // Right edge
  for (let k = 0; k < segs; k++) {
    const a = edgeIndices[3][k];
    const b = edgeIndices[3][k + 1];
    const sa = skirtBaseOffsets[3] + k;
    const sb = skirtBaseOffsets[3] + k + 1;
    indices.push(a, b, sa);
    indices.push(b, sb, sa);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return {
    geometry,
    centerLocal,
    normalLocal,
    boundingRadius: maxR + skirtDepth,
    chordWidth,
    latGrid,
    lonGrid,
    skirtDepth,
  };
}

function buildPolarCapMesh(
  radius: number,
  north: boolean,
  colorHex: number
): THREE.Mesh {
  const latEdge = north ? 85.0 : -85.0;
  const latPole = north ? 90.0 : -90.0;
  const rings = 4;
  const segs = 32;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const lat = latEdge + ((latPole - latEdge) * r) / rings;
    for (let c = 0; c <= segs; c++) {
      const lon = -180 + (360 * c) / segs;
      const pt = latLonToThreeCartesian(lat, lon, 0, 'earth', radius * 0.9992);
      positions.push(pt.x, pt.y, pt.z);
    }
  }

  const stride = segs + 1;
  for (let r = 0; r < rings; r++) {
    for (let c = 0; c < segs; c++) {
      const a = r * stride + c;
      const b = a + 1;
      const d = (r + 1) * stride + c;
      const e = d + 1;
      if (north) {
        indices.push(a, b, d);
        indices.push(b, e, d);
      } else {
        indices.push(a, d, b);
        indices.push(b, d, e);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.85,
    metalness: 0.02,
    envMapIntensity: 0.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.raycast = () => {};
  return mesh;
}

const _camLocal = new THREE.Vector3();
const _worldCenter = new THREE.Vector3();
const _worldSphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();

export class QuadtreePlanet {
  readonly body: BodyType;
  readonly radius: number;
  readonly group: THREE.Group;
  readonly tileGroup: THREE.Group;
  private baseSphere: THREE.Mesh;
  private polarCaps: THREE.Mesh[] = [];
  private provider: TileProviderConfig;
  private maxAniso: number;
  private onRenderNeeded: () => void;
  private roots: TilePatchNode[] = [];
  private allNodes = new Map<string, TilePatchNode>();
  private frameCounter = 0;
  private currentMaxLoadedZoom = 0;
  private currentOpacity = 1;
  private elevationCanvas: HTMLCanvasElement;
  private elevationCtx: CanvasRenderingContext2D;
  private onElevationUpdated?: () => void;
  private disposed = false;
  private generation = 0;

  constructor(
    body: BodyType,
    radius: number,
    provider: TileProviderConfig,
    maxAnisotropy: number,
    onRenderNeeded: () => void,
    onElevationUpdated?: () => void
  ) {
    this.body = body;
    this.radius = radius;
    this.provider = provider;
    this.maxAniso = maxAnisotropy;
    this.onRenderNeeded = onRenderNeeded;
    this.onElevationUpdated = onElevationUpdated;

    this.group = new THREE.Group();
    this.tileGroup = new THREE.Group();
    this.group.add(this.tileGroup);

    this.elevationCanvas = document.createElement('canvas');
    this.elevationCanvas.width = 256;
    this.elevationCanvas.height = 256;
    this.elevationCtx = this.elevationCanvas.getContext('2d', {
      willReadFrequently: true,
    })!;

    // Underlay fallback ellipsoid visible while root tiles stream
    const yScale = Math.sqrt(1 - BODY_ELLIPSOIDS[body].e2);
    const baseGeo = new THREE.SphereGeometry(radius * 0.996, 48, 32);
    baseGeo.scale(1, yScale, 1);
    const baseColor =
      body === 'earth' ? 0x0b1f38 : body === 'mars' ? 0x8b442a : 0x4c5059;
    const baseMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: body === 'earth' ? 0.78 : 0.9,
      metalness: 0.03,
      envMapIntensity: 0.4,
    });
    this.baseSphere = new THREE.Mesh(baseGeo, baseMat);
    this.baseSphere.raycast = () => {};
    this.group.add(this.baseSphere);

    if (body === 'earth') {
      const northCap = buildPolarCapMesh(radius, true, 0x16324c);
      const southCap = buildPolarCapMesh(radius, false, 0xc7d6e4);
      this.polarCaps.push(northCap, southCap);
      this.group.add(northCap, southCap);
    }

    this.initRoots();
  }

  get maxZoomVisible(): number {
    return this.currentMaxLoadedZoom;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  sampleDisplacedElevationM(latDeg: number, lonDeg: number): number | null {
    if (this.disposed || this.provider.scheme !== 'mercator') return null;
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, latDeg));
    const normLon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
    const latRad = (clampedLat * Math.PI) / 180;
    const uGlobal = (normLon + 180) / 360;
    const vGlobal =
      (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;

    let bestNode: TilePatchNode | null = null;
    for (const node of this.allNodes.values()) {
      if (node.disposed || !node.displacedElevGrid) continue;
      const n = 2 ** node.z;
      const tx = uGlobal * n - node.x;
      const ty = vGlobal * n - node.y;
      if (tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1) {
        if (!bestNode || node.z > bestNode.z) {
          bestNode = node;
        }
      }
    }
    if (!bestNode || !bestNode.displacedElevGrid) return null;

    const n = 2 ** bestNode.z;
    const tx = Math.max(0, Math.min(1, uGlobal * n - bestNode.x));
    const ty = Math.max(0, Math.min(1, vGlobal * n - bestNode.y));
    const segs = PATCH_SEGS;
    const gridSide = segs + 1;
    const fx = tx * segs;
    const fy = ty * segs;
    const c0 = Math.min(segs - 1, Math.floor(fx));
    const r0 = Math.min(segs - 1, Math.floor(fy));
    const wx = fx - c0;
    const wy = fy - r0;
    const g = bestNode.displacedElevGrid;
    const v00 = g[r0 * gridSide + c0];
    const v10 = g[r0 * gridSide + c0 + 1];
    const v01 = g[(r0 + 1) * gridSide + c0];
    const v11 = g[(r0 + 1) * gridSide + c0 + 1];
    const top = v00 * (1 - wx) + v10 * wx;
    const bot = v01 * (1 - wx) + v11 * wx;
    return top * (1 - wy) + bot * wy;
  }

  private initRoots() {
    const z = this.provider.minZoom;
    const cols = this.provider.scheme === 'mercator' ? 2 ** z : 2 ** (z + 1);
    const rows = 2 ** z;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const node = this.createNode(z, x, y);
        this.roots.push(node);
        this.enqueueFetch(node, 1);
      }
    }
  }

  setProvider(nextProvider: TileProviderConfig) {
    if (this.disposed) return;
    this.clearAllNodes();
    this.provider = nextProvider;
    this.currentMaxLoadedZoom = 0;
    this.baseSphere.visible = true;
    this.initRoots();
    this.onRenderNeeded();
  }

  setOpacity(opacity: number) {
    const clamped = Math.max(0, Math.min(1, opacity));
    if (Math.abs(clamped - this.currentOpacity) < 0.004 && clamped > 0.004 && clamped < 0.996) {
      return;
    }
    this.currentOpacity = clamped;
    const isTransparent = clamped < 0.996;
    const applyMat = (mat: THREE.MeshStandardMaterial) => {
      mat.transparent = isTransparent;
      mat.opacity = clamped;
      mat.depthWrite = !isTransparent;
      mat.needsUpdate = true;
    };
    applyMat(this.baseSphere.material as THREE.MeshStandardMaterial);
    for (const cap of this.polarCaps) {
      applyMat(cap.material as THREE.MeshStandardMaterial);
    }
    for (const node of this.allNodes.values()) {
      applyMat(node.mesh.material as THREE.MeshStandardMaterial);
    }
  }

  private createNode(z: number, x: number, y: number): TilePatchNode {
    const key = `${this.body}:${z}/${x}/${y}`;
    const existing = this.allNodes.get(key);
    if (existing && !existing.disposed) return existing;

    const patch = buildPatchGeometry(
      this.body,
      this.radius,
      this.provider.scheme,
      z,
      x,
      y
    );
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: this.body === 'earth' ? 0.76 : this.body === 'mars' ? 0.88 : 0.94,
      metalness: 0.03,
      envMapIntensity: 0.4,
    });
    const mesh = new THREE.Mesh(patch.geometry, mat);
    mesh.visible = false;
    this.tileGroup.add(mesh);

    const node: TilePatchNode = {
      key,
      z,
      x,
      y,
      mesh,
      centerLocal: patch.centerLocal,
      normalLocal: patch.normalLocal,
      boundingRadius: patch.boundingRadius,
      chordWidth: patch.chordWidth,
      latGrid: patch.latGrid,
      lonGrid: patch.lonGrid,
      skirtDepth: patch.skirtDepth,
      textureReady: false,
      textureLoading: false,
      elevationApplied: false,
      children: null,
      displacedElevGrid: null,
      lastUsedFrame: this.frameCounter,
      disposed: false,
    };
    this.allNodes.set(key, node);
    return node;
  }

  private enqueueFetch(node: TilePatchNode, distSq: number) {
    if (this.disposed || node.textureReady || node.textureLoading || node.disposed) return;
    node.textureLoading = true;
    pendingQueue.push({
      node,
      planet: this,
      generation: this.generation,
      distSq,
    });
    pumpFetchQueue();
  }

  async executeTileFetch(node: TilePatchNode, expectedGen: number): Promise<void> {
    if (this.disposed || expectedGen !== this.generation || node.disposed) return;
    const url = this.provider.getTileUrl(node.z, node.x, node.y);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`Tile load failed: ${url}`));
        el.src = url;
      });
      if (this.disposed || expectedGen !== this.generation || node.disposed) return;

      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = this.maxAniso;
      tex.needsUpdate = true;

      const mat = node.mesh.material as THREE.MeshStandardMaterial;
      mat.map = tex;
      mat.transparent = this.currentOpacity < 0.996;
      mat.opacity = this.currentOpacity;
      mat.depthWrite = !(this.currentOpacity < 0.996);
      mat.needsUpdate = true;
      node.textureReady = true;
      node.textureLoading = false;
      this.onRenderNeeded();

      // Non-blocking Terrarium 3D terrain elevation displacement on Earth z >= 3
      if (
        this.provider.getElevationUrl &&
        node.z >= 3 &&
        node.z <= 13 &&
        !node.elevationApplied
      ) {
        void this.applyTerrariumElevation(node, expectedGen);
      }
    } catch {
      node.textureLoading = false;
    }
  }

  private async applyTerrariumElevation(
    node: TilePatchNode,
    expectedGen: number
  ): Promise<void> {
    if (
      this.disposed ||
      expectedGen !== this.generation ||
      !this.provider.getElevationUrl ||
      node.disposed
    ) {
      return;
    }
    const elevUrl = this.provider.getElevationUrl(node.z, node.x, node.y);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Terrarium failed'));
        el.src = elevUrl;
      });
      if (this.disposed || expectedGen !== this.generation || node.disposed) return;

      this.elevationCtx.clearRect(0, 0, 256, 256);
      this.elevationCtx.drawImage(img, 0, 0, 256, 256);
      const pixels = this.elevationCtx.getImageData(0, 0, 256, 256).data;

      const posAttr = node.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const normAttr = node.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const segs = PATCH_SEGS;
      const gridSide = segs + 1;
      const gridVertCount = gridSide * gridSide;
      const displacedElevGrid = new Float32Array(gridVertCount);

      // Exaggerate relief noticeably at regional zoom, taper gently at street scale
      const exag = node.z <= 7 ? 3.2 : node.z <= 10 ? 2.5 : 1.7;

      for (let r = 0; r <= segs; r++) {
        const py = Math.min(255, Math.round((r / segs) * 255));
        for (let c = 0; c <= segs; c++) {
          const px = Math.min(255, Math.round((c / segs) * 255));
          const pIdx = (py * 256 + px) * 4;
          const R = pixels[pIdx];
          const G = pixels[pIdx + 1];
          const B = pixels[pIdx + 2];
          const rawElev = R * 256 + G + B / 256 - 32768;
          const elevM = Math.max(-450, Math.min(8850, rawElev)) * exag;

          const idx = r * gridSide + c;
          displacedElevGrid[idx] = elevM;
          const pt = latLonToThreeCartesian(
            node.latGrid[idx],
            node.lonGrid[idx],
            elevM,
            this.body,
            this.radius
          );
          posAttr.setXYZ(idx, pt.x, pt.y, pt.z);
        }
      }

      // Update border skirts to follow displaced border vertices
      const edgeIndices: number[][] = [
        Array.from({ length: gridSide }, (_, c) => c),
        Array.from({ length: gridSide }, (_, c) => segs * gridSide + c),
        Array.from({ length: gridSide }, (_, r) => r * gridSide),
        Array.from({ length: gridSide }, (_, r) => r * gridSide + segs),
      ];
      let skirtOffset = gridVertCount;
      for (let e = 0; e < 4; e++) {
        const edge = edgeIndices[e];
        for (let k = 0; k < gridSide; k++) {
          const src = edge[k];
          const dst = skirtOffset + k;
          posAttr.setXYZ(
            dst,
            posAttr.getX(src) - normAttr.getX(src) * node.skirtDepth,
            posAttr.getY(src) - normAttr.getY(src) * node.skirtDepth,
            posAttr.getZ(src) - normAttr.getZ(src) * node.skirtDepth
          );
        }
        skirtOffset += gridSide;
      }

      posAttr.needsUpdate = true;
      node.mesh.geometry.computeVertexNormals();
      node.mesh.geometry.computeBoundingSphere();
      node.displacedElevGrid = displacedElevGrid;
      node.elevationApplied = true;
      this.onElevationUpdated?.();
      this.onRenderNeeded();
    } catch {
      // Elevation enhancement is best-effort
    }
  }

  update(camera: THREE.PerspectiveCamera, viewportHeight: number) {
    this.frameCounter++;
    this.group.updateMatrixWorld();

    // Camera position in planet-local coordinates
    _camLocal.copy(camera.position);
    this.group.worldToLocal(_camLocal);

    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);

    const focalDenom = 2 * Math.tan((camera.fov * Math.PI) / 360);
    const camRadius = _camLocal.length() || this.radius * 3;
    const camDir = _camLocal.clone().normalize();
    const horizonCos = -Math.sqrt(Math.max(0, 1 - (this.radius / Math.max(this.radius * 1.001, camRadius)) ** 2));

    let maxLoadedZ = this.provider.minZoom;
    let rootsReadyCount = 0;

    const traverse = (node: TilePatchNode, forceHide: boolean) => {
      node.lastUsedFrame = this.frameCounter;

      if (forceHide) {
        node.mesh.visible = false;
        if (node.children) {
          for (const ch of node.children) traverse(ch, true);
        }
        return;
      }

      // Check horizon & camera frustum for z >= minZoom + 1
      let visibleInView = true;
      if (node.z > this.provider.minZoom) {
        const tileAngularRadius = node.boundingRadius / this.radius;
        const dot = node.normalLocal.dot(camDir);
        if (dot < horizonCos - tileAngularRadius * 1.35) {
          visibleInView = false;
        } else {
          _worldCenter.copy(node.centerLocal).applyMatrix4(this.group.matrixWorld);
          _worldSphere.set(_worldCenter, node.boundingRadius * 1.25 * this.group.scale.x);
          if (!_frustum.intersectsSphere(_worldSphere)) {
            visibleInView = false;
          }
        }
      }

      if (!visibleInView) {
        // Keep a coarse node hidden without tearing down immediately
        node.mesh.visible = false;
        if (node.children) {
          for (const ch of node.children) traverse(ch, true);
        }
        return;
      }

      const distToCam = _camLocal.distanceTo(node.centerLocal);
      const surfaceDist = Math.max(0.004, distToCam - node.boundingRadius * 0.45);
      const projPx = (node.chordWidth / (surfaceDist * focalDenom)) * viewportHeight;

      const shouldSubdivide =
        node.textureReady &&
        node.z < this.provider.maxZoom &&
        (node.children ? projPx > MERGE_PIXEL_THRESHOLD : projPx > SPLIT_PIXEL_THRESHOLD);

      if (shouldSubdivide) {
        if (!node.children) {
          const nz = node.z + 1;
          const nx = node.x * 2;
          const ny = node.y * 2;
          node.children = [
            this.createNode(nz, nx, ny),
            this.createNode(nz, nx + 1, ny),
            this.createNode(nz, nx, ny + 1),
            this.createNode(nz, nx + 1, ny + 1),
          ];
        }

        const allChildrenReady = node.children.every((ch) => ch.textureReady);
        if (allChildrenReady) {
          node.mesh.visible = false;
          for (const ch of node.children) {
            traverse(ch, false);
          }
          return;
        } else {
          // Stream children in background while parent stays visible seamlessly
          for (const ch of node.children) {
            ch.lastUsedFrame = this.frameCounter;
            ch.mesh.visible = false;
            const dSq = _camLocal.distanceToSquared(ch.centerLocal);
            this.enqueueFetch(ch, dSq);
          }
        }
      } else if (node.children) {
        for (const ch of node.children) traverse(ch, true);
      }

      if (node.textureReady) {
        node.mesh.visible = true;
        if (node.z > maxLoadedZ) maxLoadedZ = node.z;
      } else {
        node.mesh.visible = false;
        const dSq = _camLocal.distanceToSquared(node.centerLocal);
        this.enqueueFetch(node, dSq);
      }
    };

    for (const root of this.roots) {
      if (root.textureReady) rootsReadyCount++;
      traverse(root, false);
    }

    this.currentMaxLoadedZoom = maxLoadedZ;
    this.baseSphere.visible = rootsReadyCount < this.roots.length;

    // Prune least-recently-used non-visible deep tiles when cache grows above budget
    if (this.allNodes.size > MAX_CACHED_TILES_PER_PLANET) {
      this.pruneLruNodes();
    }
  }

  private subtreeHasVisible(node: TilePatchNode): boolean {
    if (node.mesh.visible) return true;
    if (!node.children) return false;
    for (const ch of node.children) {
      if (this.subtreeHasVisible(ch)) return true;
    }
    return false;
  }

  private subtreeMaxLastUsed(node: TilePatchNode): number {
    let maxFrame = node.lastUsedFrame;
    if (node.children) {
      for (const ch of node.children) {
        const subMax = this.subtreeMaxLastUsed(ch);
        if (subMax > maxFrame) maxFrame = subMax;
      }
    }
    return maxFrame;
  }

  private disposeSubtreeChildren(node: TilePatchNode) {
    if (!node.children) return;
    const children = node.children;
    node.children = null;
    for (const ch of children) {
      this.disposeSubtreeChildren(ch);
      this.disposeSingleNode(ch);
    }
  }

  private pruneLruNodes() {
    const collapsibleParents: Array<{ parent: TilePatchNode; maxLastUsed: number }> = [];
    for (const node of this.allNodes.values()) {
      if (!node.children) continue;
      if (node.children.every((ch) => !this.subtreeHasVisible(ch))) {
        let maxChildUsed = 0;
        for (const ch of node.children) {
          const m = this.subtreeMaxLastUsed(ch);
          if (m > maxChildUsed) maxChildUsed = m;
        }
        collapsibleParents.push({ parent: node, maxLastUsed: maxChildUsed });
      }
    }
    collapsibleParents.sort((a, b) => a.maxLastUsed - b.maxLastUsed);

    for (const item of collapsibleParents) {
      if (this.allNodes.size <= MAX_CACHED_TILES_PER_PLANET) break;
      this.disposeSubtreeChildren(item.parent);
    }
  }

  private disposeSingleNode(node: TilePatchNode) {
    if (node.disposed) return;
    node.disposed = true;
    this.tileGroup.remove(node.mesh);
    node.mesh.geometry.dispose();
    const mat = node.mesh.material as THREE.MeshStandardMaterial;
    if (mat.map) mat.map.dispose();
    mat.dispose();
    this.allNodes.delete(node.key);
  }

  private clearAllNodes() {
    this.generation++;
    for (const node of Array.from(this.allNodes.values())) {
      this.disposeSingleNode(node);
    }
    this.allNodes.clear();
    this.roots = [];
  }

  dispose() {
    this.disposed = true;
    this.clearAllNodes();
    this.baseSphere.geometry.dispose();
    (this.baseSphere.material as THREE.Material).dispose();
    for (const cap of this.polarCaps) {
      cap.geometry.dispose();
      (cap.material as THREE.Material).dispose();
    }
  }
}
