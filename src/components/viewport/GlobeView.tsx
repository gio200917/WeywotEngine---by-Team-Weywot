import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BODY_ELLIPSOIDS,
  computeMarsLsDeg,
  latLonToThreeCartesian,
  parseEpochDate,
  threeCartesianToLatLon,
} from '../../engine/physics.js';
import {
  type EarthOverlay,
  type FocusedPinCoords,
  type MarsOverlay,
  type MoonOverlay,
  useMissionStore,
} from '../../store/missionStore.js';
import type { BodyType } from '../../types/planetary.js';
import { PLANETARY_GAZETTEER } from './planetaryGazetteer.js';
import { QuadtreePlanet, type TileProviderConfig } from './QuadtreeTileGlobe.js';
import { resolveEarthRegion } from '../../engine/earthRegionResolver.js';

const UNIT_RADIUS = 1.0;

const OVERVIEW_SCALES: Record<BodyType, number> = {
  earth: 1.0,
  mars: 0.68,
  moon: 0.42,
};

const REAL_RADII_KM: Record<BodyType, number> = {
  earth: 6371,
  mars: 3390,
  moon: 1737.4,
};

const PLANET_OVERVIEW_POS: Record<BodyType, THREE.Vector3> = {
  earth: new THREE.Vector3(0, 0, 0),
  moon: new THREE.Vector3(2.85, 0.14, -1.35),
  mars: new THREE.Vector3(-4.2, -0.08, -2.0),
};

const BODY_ACCENT_HEX: Record<BodyType, number> = {
  earth: 0x38bdf8,
  mars: 0xf59e0b,
  moon: 0xe2e8f0,
};

const DEFAULT_BODY_CAMERA: Record<BodyType, { lat: number; lon: number; dist: number }> = {
  earth: { lat: 18, lon: 15, dist: 2.65 },
  mars: { lat: -10, lon: 65, dist: 2.5 },
  moon: { lat: -25, lon: -15, dist: 2.38 },
};

const SYSTEM_OVERVIEW_CAM = new THREE.Vector3(-0.7, 3.3, 8.2);
const SYSTEM_OVERVIEW_TARGET = new THREE.Vector3(-0.65, 0, -0.9);

// Reusable module-scope scratch objects (zero GC in render loop)
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vSurf = new THREE.Vector3();
const _vNorm = new THREE.Vector3();
const _vProj = new THREE.Vector3();
const _dirCurrent = new THREE.Vector3();
const _qFrom = new THREE.Quaternion();
const _qTo = new THREE.Quaternion();
const _unitForward = new THREE.Vector3(0, 0, 1);
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();
const _cFrom = new THREE.Color();
const _cTo = new THREE.Color();

interface PinUserData {
  kind: 'target' | 'site';
  body: BodyType;
  id: string;
  label: string;
  detail: string;
  lat: number;
  lon: number;
}

interface LabelCandidate {
  id: string;
  body: BodyType;
  name: string;
  lat: number;
  lon: number;
  tier: 1 | 2;
  category: 'target' | 'site' | 'landform' | 'region' | 'city';
  priority: number;
  localPos: THREE.Vector3;
  localNormal: THREE.Vector3;
}

interface ProjectedLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  tier: 1 | 2;
  category: LabelCandidate['category'];
}

function dirFromLatLon(lat: number, lon: number, body: BodyType, out = new THREE.Vector3()): THREE.Vector3 {
  const pt = latLonToThreeCartesian(lat, lon, 0, body, UNIT_RADIUS);
  return out.set(pt.x, pt.y, pt.z).normalize();
}

function getEarthProvider(overlay: EarthOverlay): TileProviderConfig {
  if (overlay === 'google_satellite') {
    return {
      scheme: 'mercator',
      minZoom: 1,
      maxZoom: 17,
      getTileUrl: (z, x, y) =>
        `https://mt${(x + y) & 3}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`,
      getElevationUrl: (z, x, y) =>
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    };
  }
  if (overlay === 'sentinel_cloudless') {
    return {
      scheme: 'mercator',
      minZoom: 1,
      maxZoom: 14,
      getTileUrl: (z, x, y) =>
        `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`,
      getElevationUrl: (z, x, y) =>
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    };
  }
  if (overlay === 'aster_gdem') {
    return {
      scheme: 'mercator',
      minZoom: 1,
      maxZoom: 12,
      getTileUrl: (z, x, y) =>
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/ASTER_GDEM_Greyscale_Shaded_Relief/default//GoogleMapsCompatible_Level12/${z}/${y}/${x}.png`,
      getElevationUrl: (z, x, y) =>
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    };
  }
  if (overlay === 'osm') {
    return {
      scheme: 'mercator',
      minZoom: 1,
      maxZoom: 15,
      getTileUrl: (z, x, y) =>
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
      getElevationUrl: (z, x, y) =>
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    };
  }
  return {
    scheme: 'mercator',
    minZoom: 1,
    maxZoom: 8,
    getTileUrl: (z, x, y) =>
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default//GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpg`,
    getElevationUrl: (z, x, y) =>
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  };
}

function getMarsProvider(overlay: MarsOverlay): TileProviderConfig {
  return {
    scheme: 'eq4326',
    minZoom: 0,
    maxZoom: overlay === 'themis_ir' ? 7 : 5,
    getTileUrl: (z, x, y) =>
      overlay === 'themis_ir'
        ? `/api/v1/tiles/mars/themis_ir/${z}/${y}/${x}`
        : `https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`,
  };
}

function getMoonProvider(_overlay: MoonOverlay): TileProviderConfig {
  return {
    scheme: 'eq4326',
    minZoom: 0,
    maxZoom: 6,
    getTileUrl: (z, x, y) =>
      `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`,
  };
}

function createAtmosphereShell(
  radius: number,
  yScale: number,
  colorHex: number,
  intensity: number
): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius * 1.036, 48, 32);
  geo.scale(1, yScale, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uIntensity: { value: intensity },
    },
    vertexShader: `
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float rim = pow(clamp(0.72 - dot(-vNormalWorld, viewDir), 0.0, 1.0), 2.6);
        gl_FragColor = vec4(uColor, rim * uIntensity);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.raycast = () => {};
  return mesh;
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}

function computeSolarDirection(
  body: BodyType,
  epochDateIso: string,
  out: THREE.Vector3
): THREE.Vector3 {
  const date = parseEpochDate(epochDateIso);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = Math.floor((date.getTime() - start) / 86400000) + 1;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  let declRad = 0;
  let subSolarLonDeg = 35;

  if (body === 'mars') {
    const lsRad = (computeMarsLsDeg(date) * Math.PI) / 180;
    declRad = ((25.19 * Math.PI) / 180) * Math.sin(lsRad);
    subSolarLonDeg = ((computeMarsLsDeg(date) * 0.4 + 45) % 360) - 180;
  } else if (body === 'moon') {
    const eclLonRad = (2 * Math.PI * (doy - 81)) / 365.25;
    declRad = ((1.54 * Math.PI) / 180) * Math.sin(eclLonRad);
    // Lunar synodic sun angle progression across the month
    const synodicPhase = ((doy % 29.53) / 29.53) * 360;
    subSolarLonDeg = ((synodicPhase - 180) % 360);
  } else {
    declRad =
      ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (doy - 81)) / 365.25);
    // Shift away from pure noon over UTC 00:00 so sub-solar highlight stays visible on default day hemisphere
    subSolarLonDeg = 35 - (utcHours - 12) * 15;
  }

  const sunLonRad = (subSolarLonDeg * Math.PI) / 180;
  out.set(
    Math.cos(declRad) * Math.cos(sunLonRad),
    Math.sin(declRad),
    -Math.cos(declRad) * Math.sin(sunLonRad)
  );
  return out.normalize();
}

function getActiveDataSourceLabel(
  body: BodyType,
  earthOverlay: EarthOverlay,
  marsOverlay: MarsOverlay,
  moonOverlay: MoonOverlay
): string {
  if (body === 'earth') {
    if (earthOverlay === 'google_satellite') {
      return 'Imagery: Google Earth Satellite (HD) · DEM: AWS Terrarium';
    }
    if (earthOverlay === 'sentinel_cloudless') {
      return 'Imagery: EOX Sentinel-2 Cloudless · DEM: AWS Terrarium';
    }
    if (earthOverlay === 'aster_gdem') {
      return 'Imagery: NASA GIBS / METI ASTER GDEM v3 · DEM: AWS Terrarium';
    }
    if (earthOverlay === 'osm') {
      return 'Imagery: Esri World Street Map · DEM: AWS Terrarium';
    }
    return 'Imagery: NASA GIBS Blue Marble Next Gen · DEM: AWS Terrarium';
  }
  if (body === 'mars') {
    return marsOverlay === 'themis_ir'
      ? 'Imagery: NASA Mars Trek · Odyssey THEMIS IR Day (100 m)'
      : 'Imagery: NASA Mars Trek · MGS MOLA Color Shaded (463 m)';
  }
  return moonOverlay === 'lro_wac'
    ? 'Imagery: NASA Moon Trek · LRO WAC Global Mosaic (303 ppd)'
    : 'Imagery: NASA Moon Trek · LRO WAC Global Mosaic';
}

export function GlobeView() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    label: string;
    detail: string;
  } | null>(null);
  const [hudTelemetry, setHudTelemetry] = useState<{
    altKm: number;
    lodZoom: number;
    centerLat: number;
    centerLon: number;
  }>({ altKm: 10512, lodZoom: 2, centerLat: 18, centerLon: 15 });
  const [projectedLabels, setProjectedLabels] = useState<ProjectedLabel[]>([]);
  const [morphDisplay, setMorphDisplay] = useState<{
    active: boolean;
    from: BodyType;
    to: BodyType;
  } | null>(null);
  const [terrainElevSeq, setTerrainElevSeq] = useState(0);

  const {
    targets,
    config,
    dossiers,
    discoveryCells,
    activeTargetTabId,
    bodyFocus,
    setBodyFocus,
    globeCameraMode,
    setGlobeCameraMode,
    focusedPinCoords,
    setFocusedPinCoords,
    earthOverlay,
    marsOverlay,
    moonOverlay,
    showLocationLabels,
    showDiscoveryHeatmap,
    probeModeActive,
    probeEarthCoordinate,
    selectedSiteId,
    selectEarthSite,
    inspectPlanetaryPoint,
    inspectEarthCell,
    inspectedPlanetaryPoint,
    inspectedEarthPoint,
    maxSlopeFilterDeg,
    triggerWebglFallback,
  } = useMissionStore();

  // Build sorted label candidates for all 3 bodies whenever pins/gazetteer inputs change
  const labelCandidatesByBody = useMemo(() => {
    const byBody: Record<BodyType, LabelCandidate[]> = {
      earth: [],
      mars: [],
      moon: [],
    };

    const makeCandidate = (
      id: string,
      body: BodyType,
      name: string,
      lat: number,
      lon: number,
      tier: 1 | 2,
      category: LabelCandidate['category'],
      priority: number
    ): LabelCandidate => {
      const pt = latLonToThreeCartesian(lat, lon, 0, body, UNIT_RADIUS);
      const localPos = new THREE.Vector3(pt.x, pt.y, pt.z);
      const localNormal = localPos.clone().normalize();
      return { id, body, name, lat, lon, tier, category, priority, localPos, localNormal };
    };

    // 1. Mars & Moon mission targets
    for (const t of targets) {
      const isActive = config.targetIds.includes(t.id);
      const isFocused = activeTargetTabId === t.id;
      byBody[t.body].push(
        makeCandidate(
          `tgt:${t.id}`,
          t.body,
          t.name,
          t.lat,
          t.lon,
          1,
          'target',
          isFocused ? 140 : isActive ? 120 : 52
        )
      );
    }

    // 2. Earth ranked analog sites & anti-analog
    const activeDossier =
      dossiers.find((d) => d.target.id === activeTargetTabId) ?? dossiers[0];
    if (activeDossier) {
      const visibleCandidates = activeDossier.rankedCandidates.filter(
        (c) => c.site.morphology.medianSlopeDeg <= maxSlopeFilterDeg
      );
      visibleCandidates.slice(0, 12).forEach((cand) => {
        const isSelected = selectedSiteId === cand.site.id;
        const cleanName = cand.site.name.replace(/\s*\(Visual Anti-Analog\)/i, '');
        byBody.earth.push(
          makeCandidate(
            `site:${cand.site.id}`,
            'earth',
            `#${cand.rank} ${cleanName}`,
            cand.site.lat,
            cand.site.lon,
            cand.rank <= 3 || isSelected ? 1 : 2,
            'site',
            isSelected ? 150 : Math.max(70, 115 - cand.rank * 4)
          )
        );
      });
    }

    // 3. Curated Gazetteer across Earth, Mars, Moon
    for (const g of PLANETARY_GAZETTEER) {
      byBody[g.body].push(
        makeCandidate(
          g.id,
          g.body,
          g.name,
          g.lat,
          g.lon,
          g.tier,
          g.kind,
          g.tier === 1 ? 58 : 28
        )
      );
    }

    (['earth', 'mars', 'moon'] as BodyType[]).forEach((b) => {
      byBody[b].sort((a, bItem) => bItem.priority - a.priority);
    });
    return byBody;
  }, [targets, config.targetIds, dossiers, activeTargetTabId, selectedSiteId, maxSlopeFilterDeg]);

  // Per-tab camera zoom & orientation memory
  const perBodyCameraRef = useRef<
    Record<BodyType, { dir: THREE.Vector3; dist: number }>
  >({
    earth: {
      dir: dirFromLatLon(DEFAULT_BODY_CAMERA.earth.lat, DEFAULT_BODY_CAMERA.earth.lon, 'earth'),
      dist: DEFAULT_BODY_CAMERA.earth.dist,
    },
    mars: {
      dir: dirFromLatLon(DEFAULT_BODY_CAMERA.mars.lat, DEFAULT_BODY_CAMERA.mars.lon, 'mars'),
      dist: DEFAULT_BODY_CAMERA.mars.dist,
    },
    moon: {
      dir: dirFromLatLon(DEFAULT_BODY_CAMERA.moon.lat, DEFAULT_BODY_CAMERA.moon.lon, 'moon'),
      dist: DEFAULT_BODY_CAMERA.moon.dist,
    },
  });

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    sunLight: THREE.DirectionalLight;
    planets: Record<BodyType, QuadtreePlanet>;
    atmosphereMeshes: Partial<Record<BodyType, THREE.Mesh>>;
    atmosphereBaseIntensity: Partial<Record<BodyType, number>>;
    markerGroups: Record<BodyType, THREE.Group>;
    morphRing: THREE.Mesh;
    morph: {
      active: boolean;
      fromBody: BodyType;
      toBody: BodyType;
      elapsed: number;
      duration: number;
    };
    clickablePins: THREE.Object3D[];
    pinScalables: THREE.Object3D[];
    discoveryInstanced: THREE.InstancedMesh | null;
    discoveryTopCells: Array<{ lat: number; lon: number; scorePct: number; bestQuarter: number }>;
    requestRender: () => void;
    cameraGoalTarget: THREE.Vector3;
    cameraGoalDir: THREE.Vector3;
    cameraGoalDist: number;
    transitionActive: boolean;
    forceLabelRefresh: boolean;
    lastLabelSignature: string;
  } | null>(null);

  const latestRef = useRef({
    bodyFocus,
    globeCameraMode,
    probeModeActive,
    showLocationLabels,
    targetCount: config.targetIds.length,
    labelCandidatesByBody,
    setBodyFocus,
    setGlobeCameraMode,
    selectEarthSite,
    inspectPlanetaryPoint,
    inspectEarthCell,
    setFocusedPinCoords,
    probeEarthCoordinate,
  });
  latestRef.current = {
    bodyFocus,
    globeCameraMode,
    probeModeActive,
    showLocationLabels,
    targetCount: config.targetIds.length,
    labelCandidatesByBody,
    setBodyFocus,
    setGlobeCameraMode,
    selectEarthSite,
    inspectPlanetaryPoint,
    inspectEarthCell,
    setFocusedPinCoords,
    probeEarthCoordinate,
  };

  const prevBodyFocusRef = useRef<BodyType>(bodyFocus);
  const prevPinRef = useRef<FocusedPinCoords | null>(focusedPinCoords);
  const lastOrbitedCenterRef = useRef<{ body: BodyType; lat: number; lon: number } | null>(null);

  // Initialize Three.js WebGLRenderer, Quadtree LOD Planets, Morph Ring, Lighting & Controls once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
      if (!renderer.getContext()) {
        throw new Error('Null WebGL context');
      }
    } catch {
      triggerWebglFallback(
        'WebGL context unavailable on this device — automatically switched to 2D Tactical Map.'
      );
      return;
    }

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const handleContextLost = (ev: Event) => {
      ev.preventDefault();
      triggerWebglFallback(
        'WebGL context lost — automatically switched to 2D Tactical Map.'
      );
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04070d);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.002, 240);
    const initialCam = perBodyCameraRef.current[latestRef.current.bodyFocus];
    camera.position.copy(initialCam.dir).multiplyScalar(initialCam.dist);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 1.0025;
    controls.maxDistance = 24;

    // Solar Directional Light + Space Fill
    const sunLight = new THREE.DirectionalLight(0xfff5e4, 2.35);
    computeSolarDirection(latestRef.current.bodyFocus, config.epochDateIso, sunLight.position).multiplyScalar(30);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x0f172a, 0.65);
    scene.add(hemiLight);

    // Subtle Starfield
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = ((i * 73856093) % 10000) / 10000;
      const v = ((i * 19349663) % 10000) / 10000;
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 80 + (i % 25);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xcbd5e1,
      size: 0.25,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    stars.raycast = () => {};
    scene.add(stars);

    // Holographic Morph Scan Ring (used during tab-to-tab planetary morphing)
    const ringGeo = new THREE.TorusGeometry(1.0, 0.0085, 14, 96);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const morphRing = new THREE.Mesh(ringGeo, ringMat);
    morphRing.visible = false;
    morphRing.raycast = () => {};
    scene.add(morphRing);

    let frameId = 0;
    let timerId = 0;
    let elevSyncTimerId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTickMs = performance.now();
    let lastHudUpdateMs = 0;
    let lastLabelProjectMs = 0;

    const scheduleTerrainElevationSync = () => {
      if (elevSyncTimerId !== 0) return;
      elevSyncTimerId = window.setTimeout(() => {
        elevSyncTimerId = 0;
        setTerrainElevSeq((s) => s + 1);
      }, 450);
    };

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        timerId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          timerId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          timerId = window.setTimeout(cb, 80);
        }
      };
      timerId = window.setTimeout(poll, 5);
    };

    const projectSurfaceLabels = (
      st: NonNullable<typeof sceneRef.current>,
      focusBody: BodyType,
      altKm: number,
      vw: number,
      vh: number
    ) => {
      const candidates = latestRef.current.labelCandidatesByBody[focusBody];
      const tier2ThresholdKm =
        focusBody === 'earth' ? 5800 : focusBody === 'mars' ? 3800 : 2200;
      const tier1ThresholdKm =
        focusBody === 'earth' ? 28000 : focusBody === 'mars' ? 18000 : 11000;

      const accepted: ProjectedLabel[] = [];
      const padX = 118;
      const padY = 22;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.category !== 'target' && c.category !== 'site') {
          if (c.tier === 2 && altKm > tier2ThresholdKm) continue;
          if (c.tier === 1 && altKm > tier1ThresholdKm) continue;
        }

        // Exact horizon occlusion: surface point must face the camera
        _vSurf.copy(c.localPos);
        _vA.subVectors(camera.position, _vSurf);
        if (_vA.dot(c.localNormal) <= 0.03) continue;

        _vProj.copy(_vSurf).project(camera);
        if (_vProj.z > 1 || _vProj.z < -1) continue;

        const sx = (_vProj.x * 0.5 + 0.5) * vw;
        const sy = (-_vProj.y * 0.5 + 0.5) * vh;
        if (sx < 44 || sx > vw - 44 || sy < 34 || sy > vh - 34) continue;

        let overlaps = false;
        for (let k = 0; k < accepted.length; k++) {
          if (Math.abs(sx - accepted[k].x) < padX && Math.abs(sy - accepted[k].y) < padY) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;

        accepted.push({
          id: c.id,
          name: c.name,
          x: Math.round(sx * 2) / 2,
          y: Math.round(sy * 2) / 2,
          tier: c.tier,
          category: c.category,
        });
        if (accepted.length >= 22) break;
      }

      const sig = accepted.map((l) => `${l.id}:${Math.round(l.x / 2)},${Math.round(l.y / 2)}`).join('|');
      if (sig !== st.lastLabelSignature) {
        st.lastLabelSignature = sig;
        setProjectedLabels(accepted);
      }
    };

    const requestRender = () => {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const dt = Math.min(0.05, Math.max(0.001, (now - lastTickMs) / 1000));
        lastTickMs = now;

        const st = sceneRef.current;
        let stillTransitioning = false;

        // 1. Advance Planetary Surface Morph Animation (Centered Tab Switch)
        if (st && st.morph.active) {
          st.morph.elapsed += dt;
          const progress = Math.min(1, st.morph.elapsed / st.morph.duration);
          const ease =
            progress < 0.5
              ? 4 * progress * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 3) / 2;

          const fromPlanet = st.planets[st.morph.fromBody];
          const toPlanet = st.planets[st.morph.toBody];

          fromPlanet.group.visible = true;
          fromPlanet.group.position.set(0, 0, 0);
          fromPlanet.group.scale.setScalar(1.0 + 0.045 * ease);
          fromPlanet.setOpacity(1 - ease);

          toPlanet.group.visible = true;
          toPlanet.group.position.set(0, 0, 0);
          toPlanet.group.scale.setScalar(0.955 + 0.045 * ease);
          toPlanet.setOpacity(ease);

          const fromAtmos = st.atmosphereMeshes[st.morph.fromBody];
          const toAtmos = st.atmosphereMeshes[st.morph.toBody];
          if (fromAtmos) {
            const mat = fromAtmos.material as THREE.ShaderMaterial;
            mat.uniforms.uIntensity.value =
              (st.atmosphereBaseIntensity[st.morph.fromBody] ?? 0.4) * (1 - ease);
          }
          if (toAtmos) {
            const mat = toAtmos.material as THREE.ShaderMaterial;
            mat.uniforms.uIntensity.value =
              (st.atmosphereBaseIntensity[st.morph.toBody] ?? 0.4) * ease;
          }

          // Sweep glowing scan-ring down across the sphere
          const theta = Math.PI * (0.04 + 0.92 * ease);
          const ringY = Math.cos(theta) * 1.012;
          const ringScale = Math.max(0.14, Math.sin(theta) * 1.018);
          st.morphRing.visible = true;
          st.morphRing.position.set(0, ringY, 0);
          st.morphRing.scale.setScalar(ringScale);

          _cFrom.setHex(BODY_ACCENT_HEX[st.morph.fromBody]);
          _cTo.setHex(BODY_ACCENT_HEX[st.morph.toBody]);
          const rMat = st.morphRing.material as THREE.MeshBasicMaterial;
          rMat.color.copy(_cFrom).lerp(_cTo, ease);
          rMat.opacity = Math.sin(Math.PI * progress) * 0.9;

          if (progress >= 1) {
            st.morph.active = false;
            fromPlanet.group.visible = false;
            fromPlanet.group.scale.setScalar(1.0);
            fromPlanet.setOpacity(1.0);
            if (fromAtmos) {
              (fromAtmos.material as THREE.ShaderMaterial).uniforms.uIntensity.value =
                st.atmosphereBaseIntensity[st.morph.fromBody] ?? 0.4;
            }
            toPlanet.group.visible = true;
            toPlanet.group.scale.setScalar(1.0);
            toPlanet.setOpacity(1.0);
            if (toAtmos) {
              (toAtmos.material as THREE.ShaderMaterial).uniforms.uIntensity.value =
                st.atmosphereBaseIntensity[st.morph.toBody] ?? 0.4;
            }
            st.morphRing.visible = false;
            rMat.opacity = 0;
            st.forceLabelRefresh = true;
            setMorphDisplay(null);
          } else {
            stillTransitioning = true;
          }
        }

        // 2. Smooth Slerp Camera & Zoom Transition
        if (st && st.transitionActive) {
          const lambda = 5.4;
          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            st.cameraGoalTarget.x,
            lambda,
            dt
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            st.cameraGoalTarget.y,
            lambda,
            dt
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            st.cameraGoalTarget.z,
            lambda,
            dt
          );

          _vA.subVectors(camera.position, controls.target);
          const curDist = Math.max(0.02, _vA.length());
          _dirCurrent.copy(_vA).divideScalar(curDist);

          _qFrom.setFromUnitVectors(_unitForward, _dirCurrent);
          _qTo.setFromUnitVectors(_unitForward, st.cameraGoalDir);
          const alpha = 1 - Math.exp(-lambda * dt);
          _qFrom.slerp(_qTo, alpha);
          _vB.copy(_unitForward).applyQuaternion(_qFrom).normalize();

          const nextDist = THREE.MathUtils.damp(curDist, st.cameraGoalDist, lambda, dt);
          camera.position.copy(controls.target).addScaledVector(_vB, nextDist);

          const distErr =
            controls.target.distanceTo(st.cameraGoalTarget) +
            Math.abs(nextDist - st.cameraGoalDist) +
            _dirCurrent.distanceTo(st.cameraGoalDir);
          if (distErr < 0.0035) {
            st.transitionActive = false;
          } else {
            stillTransitioning = true;
          }
        }

        // 3. Altitude-adaptive controls, per-body zoom memory, pin scaling & Quadtree updates
        if (st) {
          const focusBody = latestRef.current.bodyFocus;
          const focusGroup = st.planets[focusBody].group;
          const activeWorldR = focusGroup.scale.x || UNIT_RADIUS;
          const distToPlanet = camera.position.distanceTo(focusGroup.position);
          const alt = Math.max(0.002 * activeWorldR, distToPlanet - activeWorldR);

          controls.minDistance =
            latestRef.current.globeCameraMode === 'planet_focus'
              ? UNIT_RADIUS * 1.0025
              : 1.8;
          controls.rotateSpeed = THREE.MathUtils.clamp((alt / activeWorldR) * 0.65, 0.014, 0.9);
          controls.zoomSpeed = THREE.MathUtils.clamp((alt / activeWorldR) * 1.15, 0.1, 1.15);

          const desiredNear = THREE.MathUtils.clamp(alt * 0.1, 0.00015, 0.08);
          if (Math.abs(camera.near - desiredNear) / camera.near > 0.15) {
            camera.near = desiredNear;
            camera.updateProjectionMatrix();
          }

          // Persist current user zoom level & orientation on the active tab
          if (
            latestRef.current.globeCameraMode === 'planet_focus' &&
            !st.transitionActive &&
            !st.morph.active
          ) {
            const len = camera.position.length();
            if (len > 0.5) {
              perBodyCameraRef.current[focusBody].dir.copy(camera.position).divideScalar(len);
              perBodyCameraRef.current[focusBody].dist = len;
            }
          }

          // Progressive pin shrinkage on zoom
          const ratio = alt / activeWorldR;
          const pinScale = THREE.MathUtils.clamp(Math.pow(ratio, 1.15) * 0.62, 0.002, 1.25);
          for (const pinObj of st.pinScalables) {
            pinObj.scale.setScalar(pinScale);
          }

          // Stream Quadtree LOD tiles only for visible planets
          const vh = container.clientHeight || 600;
          const vw = container.clientWidth || 800;
          (['earth', 'mars', 'moon'] as BodyType[]).forEach((b) => {
            if (st.planets[b].group.visible) {
              st.planets[b].update(camera, vh);
            }
          });

          const altKm = Math.round(((distToPlanet - activeWorldR) / activeWorldR) * REAL_RADII_KM[focusBody]);

          // Update HUD telemetry ~8 times/sec
          if (now - lastHudUpdateMs > 120) {
            lastHudUpdateMs = now;
            _vC.copy(camera.position).sub(focusGroup.position);
            const { latDeg, lonDeg } = threeCartesianToLatLon(
              _vC.x,
              _vC.y,
              _vC.z,
              focusBody
            );
            lastOrbitedCenterRef.current = { body: focusBody, lat: latDeg, lon: lonDeg };
            setHudTelemetry({
              altKm,
              lodZoom: st.planets[focusBody].maxZoomVisible,
              centerLat: latDeg,
              centerLon: lonDeg,
            });
          }

          // Project Google Earth-style location labels for active tab
          if (
            latestRef.current.showLocationLabels &&
            latestRef.current.globeCameraMode === 'planet_focus' &&
            !st.morph.active
          ) {
            if (st.forceLabelRefresh || now - lastLabelProjectMs > 45) {
              lastLabelProjectMs = now;
              st.forceLabelRefresh = false;
              projectSurfaceLabels(st, focusBody, altKm, vw, vh);
            }
          } else if (st.lastLabelSignature !== '') {
            st.lastLabelSignature = '';
            setProjectedLabels([]);
          }
        }

        const dampingChanged = controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || stillTransitioning || dampingChanged) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    };

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const planets = {} as Record<BodyType, QuadtreePlanet>;
    const atmosphereMeshes: Partial<Record<BodyType, THREE.Mesh>> = {};
    const atmosphereBaseIntensity: Partial<Record<BodyType, number>> = {
      earth: 0.52,
      mars: 0.34,
    };
    const markerGroups = {} as Record<BodyType, THREE.Group>;

    const providers: Record<BodyType, TileProviderConfig> = {
      earth: getEarthProvider(earthOverlay),
      mars: getMarsProvider(marsOverlay),
      moon: getMoonProvider(moonOverlay),
    };

    const initialFocus = latestRef.current.bodyFocus;
    (['earth', 'mars', 'moon'] as BodyType[]).forEach((body) => {
      const yScale = Math.sqrt(1 - BODY_ELLIPSOIDS[body].e2);
      const qp = new QuadtreePlanet(
        body,
        UNIT_RADIUS,
        providers[body],
        maxAniso,
        requestRender,
        body === 'earth' ? scheduleTerrainElevationSync : undefined
      );
      qp.group.position.set(0, 0, 0);
      qp.group.scale.setScalar(1.0);
      qp.group.visible = body === initialFocus;
      qp.setOpacity(body === initialFocus ? 1.0 : 0.0);
      scene.add(qp.group);

      if (body === 'earth') {
        const atmos = createAtmosphereShell(UNIT_RADIUS, yScale, 0x38bdf8, 0.52);
        qp.group.add(atmos);
        atmosphereMeshes[body] = atmos;
      } else if (body === 'mars') {
        const atmos = createAtmosphereShell(UNIT_RADIUS, yScale, 0xf59e0b, 0.34);
        qp.group.add(atmos);
        atmosphereMeshes[body] = atmos;
      }

      const markers = new THREE.Group();
      qp.group.add(markers);
      planets[body] = qp;
      markerGroups[body] = markers;
    });

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      sunLight,
      planets,
      atmosphereMeshes,
      atmosphereBaseIntensity,
      markerGroups,
      morphRing,
      morph: {
        active: false,
        fromBody: initialFocus,
        toBody: initialFocus,
        elapsed: 0,
        duration: 0.85,
      },
      clickablePins: [],
      pinScalables: [],
      discoveryInstanced: null,
      discoveryTopCells: [],
      requestRender,
      cameraGoalTarget: new THREE.Vector3(0, 0, 0),
      cameraGoalDir: initialCam.dir.clone(),
      cameraGoalDist: initialCam.dist,
      transitionActive: false,
      forceLabelRefresh: true,
      lastLabelSignature: '',
    };

    const onControlStart = () => {
      if (sceneRef.current) {
        sceneRef.current.transitionActive = false;
      }
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', requestRender);

    const resizeObserver = new ResizeObserver(() => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (sceneRef.current) sceneRef.current.forceLabelRefresh = true;
      requestRender();
    });
    resizeObserver.observe(container);

    // Raycaster & Interaction
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let lastHoverTs = 0;

    const updateNdc = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      return rect;
    };

    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };

    const onPointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTs < 32) return;
      lastHoverTs = now;

      const st = sceneRef.current;
      if (!st) return;
      const rect = updateNdc(ev);
      raycaster.setFromCamera(pointerNdc, camera);

      // Only raycast pins belonging to visible planets
      const activePins = st.clickablePins.filter((pin) => {
        const data = pin.userData as PinUserData;
        return st.planets[data.body].group.visible;
      });
      const pinHits = raycaster.intersectObjects(activePins, false);
      if (pinHits.length > 0) {
        const data = pinHits[0].object.userData as PinUserData;
        renderer.domElement.style.cursor = 'pointer';
        setHoverInfo({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          label: data.label,
          detail: data.detail,
        });
        return;
      }

      if (st.discoveryInstanced && st.planets.earth.group.visible) {
        const instHits = raycaster.intersectObject(st.discoveryInstanced, false);
        if (instHits.length > 0 && instHits[0].instanceId !== undefined) {
          const cell = st.discoveryTopCells[instHits[0].instanceId];
          if (cell) {
            const region = resolveEarthRegion(cell.lat, cell.lon);
            renderer.domElement.style.cursor = 'pointer';
            setHoverInfo({
              x: ev.clientX - rect.left,
              y: ev.clientY - rect.top,
              label: `${region.name} · 1° Analog Cell`,
              detail: `Screening Fit ${cell.scorePct.toFixed(1)}% · Best Q${cell.bestQuarter} · Click to inspect`,
            });
            return;
          }
        }
      }

      renderer.domElement.style.cursor =
        latestRef.current.probeModeActive && latestRef.current.bodyFocus === 'earth'
          ? 'crosshair'
          : 'grab';
      setHoverInfo(null);
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
      const st = sceneRef.current;
      if (!st) return;
      updateNdc(ev);
      raycaster.setFromCamera(pointerNdc, camera);

      const activePins = st.clickablePins.filter((pin) => {
        const data = pin.userData as PinUserData;
        return st.planets[data.body].group.visible;
      });
      const pinHits = raycaster.intersectObjects(activePins, false);
      if (pinHits.length > 0) {
        const data = pinHits[0].object.userData as PinUserData;
        const wasOverview = latestRef.current.globeCameraMode === 'system_overview';
        if (wasOverview) {
          latestRef.current.setGlobeCameraMode('planet_focus');
        }
        if (data.kind === 'site') {
          latestRef.current.setBodyFocus('earth');
          latestRef.current.selectEarthSite(data.id, wasOverview ? 'dossier' : 'viewport');
        } else if (
          data.kind === 'target' &&
          (data.body === 'mars' || data.body === 'moon')
        ) {
          latestRef.current.setBodyFocus(data.body);
          latestRef.current.inspectPlanetaryPoint({
            body: data.body,
            lat: data.lat,
            lon: data.lon,
            matchedTargetId: data.id,
            flyTo: wasOverview,
          });
        }
        return;
      }

      if (st.discoveryInstanced && st.planets.earth.group.visible) {
        const instHits = raycaster.intersectObject(st.discoveryInstanced, false);
        if (instHits.length > 0 && instHits[0].instanceId !== undefined) {
          const cell = st.discoveryTopCells[instHits[0].instanceId];
          if (cell && latestRef.current.targetCount > 0) {
            if (latestRef.current.probeModeActive) {
              latestRef.current.setFocusedPinCoords({
                body: 'earth',
                lat: cell.lat,
                lon: cell.lon,
              });
              void latestRef.current.probeEarthCoordinate(cell.lat, cell.lon);
            } else {
              latestRef.current.inspectEarthCell({
                lat: cell.lat,
                lon: cell.lon,
                scorePct: cell.scorePct,
                bestQuarter: cell.bestQuarter,
              });
            }
            return;
          }
        }
      }

      const tileMeshes = (['earth', 'mars', 'moon'] as BodyType[]).flatMap((b) =>
        st.planets[b].group.visible
          ? st.planets[b].tileGroup.children.filter((m) => m.visible)
          : []
      );
      const tileHits = raycaster.intersectObjects(tileMeshes, false);
      if (tileHits.length > 0) {
        const hit = tileHits[0];
        let hitBody: BodyType | null = null;
        for (const b of ['earth', 'mars', 'moon'] as BodyType[]) {
          if (hit.object.parent === st.planets[b].tileGroup) {
            hitBody = b;
            break;
          }
        }
        if (!hitBody) return;

        if (latestRef.current.globeCameraMode === 'system_overview') {
          latestRef.current.setBodyFocus(hitBody);
          latestRef.current.setGlobeCameraMode('planet_focus');
          return;
        }

        _vC.copy(hit.point);
        st.planets[hitBody].group.worldToLocal(_vC);
        const { latDeg, lonDeg } = threeCartesianToLatLon(
          _vC.x,
          _vC.y,
          _vC.z,
          hitBody
        );

        if (
          hitBody === 'earth' &&
          latestRef.current.probeModeActive &&
          latestRef.current.targetCount > 0
        ) {
          latestRef.current.setFocusedPinCoords({
            body: 'earth',
            lat: latDeg,
            lon: lonDeg,
          });
          void latestRef.current.probeEarthCoordinate(latDeg, lonDeg);
          return;
        }

        if (hitBody === 'mars' || hitBody === 'moon') {
          latestRef.current.inspectPlanetaryPoint({
            body: hitBody,
            lat: latDeg,
            lon: lonDeg,
            flyTo: false,
          });
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    requestRender();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
      if (elevSyncTimerId !== 0) clearTimeout(elevSyncTimerId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      planets.earth.dispose();
      planets.mars.dispose();
      planets.moon.dispose();
      disposeObject3D(scene);
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      if (
        lastOrbitedCenterRef.current &&
        latestRef.current.globeCameraMode === 'planet_focus'
      ) {
        latestRef.current.setFocusedPinCoords(lastOrbitedCenterRef.current);
      }
      sceneRef.current = null;
    };
  }, [triggerWebglFallback]);

  // Swap streaming tile provider cleanly when overlays change
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.planets.earth.setProvider(getEarthProvider(earthOverlay));
  }, [earthOverlay]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.planets.mars.setProvider(getMarsProvider(marsOverlay));
  }, [marsOverlay]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.planets.moon.setProvider(getMoonProvider(moonOverlay));
  }, [moonOverlay]);

  // Refresh projected labels immediately when showLocationLabels or label list changes
  useEffect(() => {
    const st = sceneRef.current;
    if (!showLocationLabels || globeCameraMode !== 'planet_focus') {
      if (st) st.lastLabelSignature = '';
      setProjectedLabels([]);
    } else if (st) {
      st.lastLabelSignature = '';
      st.forceLabelRefresh = true;
    }
    st?.requestRender();
  }, [showLocationLabels, labelCandidatesByBody, globeCameraMode, bodyFocus]);

  // Update Sun Terminator when epoch date or active body changes
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    computeSolarDirection(bodyFocus, config.epochDateIso, st.sunLight.position).multiplyScalar(30);
    st.requestRender();
  }, [config.epochDateIso, bodyFocus]);

  // Rebuild holographic pins, 2-site geodesic 3D arc, and Discovery InstancedMesh
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;

    (['earth', 'mars', 'moon'] as BodyType[]).forEach((body) => {
      const grp = st.markerGroups[body];
      while (grp.children.length > 0) {
        const child = grp.children[0];
        grp.remove(child);
        disposeObject3D(child);
      }
    });
    st.clickablePins = [];
    st.pinScalables = [];
    st.discoveryInstanced = null;
    st.discoveryTopCells = [];

    const addPin = (
      body: BodyType,
      lat: number,
      lon: number,
      elevM: number,
      colorHex: number,
      headRadius: number,
      stemHeight: number,
      highlight: boolean,
      ringMode: 'none' | 'single' | 'double',
      userData: PinUserData
    ) => {
      const sampledDisplacedM =
        body === 'earth' ? st.planets.earth.sampleDisplacedElevationM(lat, lon) : null;
      const baseElev =
        body === 'earth'
          ? (sampledDisplacedM !== null ? Math.max(0, sampledDisplacedM) : Math.max(0, elevM) * 3.2) + 450
          : 0;
      const basePos = latLonToThreeCartesian(lat, lon, baseElev, body, UNIT_RADIUS);
      const dir = new THREE.Vector3(basePos.x, basePos.y, basePos.z).normalize();

      const anchor = new THREE.Group();
      anchor.position.set(basePos.x, basePos.y, basePos.z);
      anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      st.markerGroups[body].add(anchor);
      st.pinScalables.push(anchor);

      const isTargetPin = userData.kind === 'target';
      const stemGeo = new THREE.CylinderGeometry(
        headRadius * (isTargetPin ? 0.16 : 0.2),
        headRadius * (isTargetPin ? 0.16 : 0.2),
        stemHeight,
        8
      );
      const stemMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: highlight ? 0.95 : 0.45,
        roughness: 0.3,
        metalness: 0.25,
      });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(0, stemHeight * 0.5, 0);
      stem.raycast = () => {};
      anchor.add(stem);

      const headGeo = isTargetPin
        ? new THREE.OctahedronGeometry(headRadius * 1.18, 0)
        : new THREE.SphereGeometry(headRadius, 14, 12);
      const headMat = new THREE.MeshStandardMaterial({
        color: highlight ? 0xffffff : colorHex,
        emissive: colorHex,
        emissiveIntensity: highlight ? 1.2 : 0.7,
        roughness: 0.22,
        metalness: 0.2,
      });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, stemHeight + headRadius * 0.55, 0);
      head.userData = userData;
      anchor.add(head);
      st.clickablePins.push(head);

      if (ringMode !== 'none') {
        const ringGeo = new THREE.RingGeometry(headRadius * 1.45, headRadius * 2.05, 28);
        const ringMat = new THREE.MeshBasicMaterial({
          color: colorHex,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: highlight ? 0.92 : 0.62,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(0, 0.004, 0);
        ring.raycast = () => {};
        anchor.add(ring);

        if (ringMode === 'double') {
          const outerGeo = new THREE.RingGeometry(headRadius * 2.55, headRadius * 3.05, 32);
          const outerMat = new THREE.MeshBasicMaterial({
            color: highlight ? 0xffffff : colorHex,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.72,
          });
          const outerRing = new THREE.Mesh(outerGeo, outerMat);
          outerRing.rotation.x = -Math.PI / 2;
          outerRing.position.set(0, 0.0045, 0);
          outerRing.raycast = () => {};
          anchor.add(outerRing);
        }
      }
    };

    // 1. Mars & Moon Target Reticles
    for (const t of targets) {
      const isActive = config.targetIds.includes(t.id);
      const isFocused = activeTargetTabId === t.id;
      addPin(
        t.body,
        t.lat,
        t.lon,
        t.elevationM,
        isActive ? 0xf59e0b : 0x92400e,
        isActive ? 0.023 : 0.013,
        isActive ? 0.054 : 0.024,
        isActive && isFocused,
        isActive && isFocused ? 'double' : isActive ? 'single' : 'none',
        {
          kind: 'target',
          body: t.body,
          id: t.id,
          label: `${t.name} (${t.body.toUpperCase()})`,
          detail: `${t.lat.toFixed(2)}°, ${t.lon.toFixed(2)}° · ${
            isActive ? 'Active Target' : 'Available Target'
          }`,
          lat: t.lat,
          lon: t.lon,
        }
      );
    }

    // 2. Earth Tiered Ranked Analog Beacons & 2-Site Geodesic Arc
    const activeDossier =
      dossiers.find((d) => d.target.id === activeTargetTabId) ?? dossiers[0];

    if (activeDossier) {
      const visibleCandidates = activeDossier.rankedCandidates.filter(
        (c) => c.site.morphology.medianSlopeDeg <= maxSlopeFilterDeg
      );

      for (const cand of visibleCandidates) {
        const isSelected = selectedSiteId === cand.site.id;
        const isTop3 = cand.rank <= 3;
        const isTop12 = cand.rank <= 12;
        const cleanName = cand.site.name.replace(/\s*\(Visual Anti-Analog\)/i, '');
        addPin(
          'earth',
          cand.site.lat,
          cand.site.lon,
          cand.site.elevationM,
          isSelected ? 0x22d3ee : isTop12 ? 0x06b6d4 : 0x0891b2,
          isSelected ? 0.026 : isTop3 ? 0.019 : isTop12 ? 0.014 : 0.010,
          isSelected ? 0.072 : isTop3 ? 0.050 : isTop12 ? 0.028 : 0.013,
          isSelected,
          isSelected ? 'double' : isTop3 ? 'single' : 'none',
          {
            kind: 'site',
            body: 'earth',
            id: cand.site.id,
            label: `#${cand.rank} ${cleanName}`,
            detail: `Fit ${cand.missionFitPct.toFixed(1)}% · ${cand.earthFrontierPct.toFixed(0)}% frontier`,
            lat: cand.site.lat,
            lon: cand.site.lon,
          }
        );
      }

      const arcDossiers =
        activeTargetTabId === 'portfolio'
          ? dossiers
          : activeDossier
            ? [activeDossier]
            : [];

      for (const d of arcDossiers) {
        if (!d.portfolio) continue;
        const { siteA, siteB } = d.portfolio;
        const pA = latLonToThreeCartesian(siteA.lat, siteA.lon, 0, 'earth', UNIT_RADIUS);
        const pB = latLonToThreeCartesian(siteB.lat, siteB.lon, 0, 'earth', UNIT_RADIUS);
        const vA = new THREE.Vector3(pA.x, pA.y, pA.z).normalize();
        const vB = new THREE.Vector3(pB.x, pB.y, pB.z).normalize();

        const steps = 48;
        const arcPoints: THREE.Vector3[] = [];
        const omega = Math.acos(THREE.MathUtils.clamp(vA.dot(vB), -1, 1));
        const sinOmega = Math.sin(omega);
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const interp = new THREE.Vector3();
          if (omega < 1e-4) {
            interp.copy(vA);
          } else {
            const a = Math.sin((1 - f) * omega) / sinOmega;
            const b = Math.sin(f * omega) / sinOmega;
            interp.addScaledVector(vA, a).addScaledVector(vB, b).normalize();
          }
          const lift = 1.01 + Math.sin(Math.PI * f) * 0.16;
          const surf = latLonToThreeCartesian(
            Math.asin(THREE.MathUtils.clamp(interp.y, -1, 1)) * (180 / Math.PI),
            Math.atan2(-interp.z, interp.x) * (180 / Math.PI),
            0,
            'earth',
            UNIT_RADIUS
          );
          arcPoints.push(new THREE.Vector3(surf.x * lift, surf.y * lift, surf.z * lift));
        }
        const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
        const arcMat = new THREE.LineBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.92,
        });
        const arcLine = new THREE.Line(arcGeo, arcMat);
        arcLine.raycast = () => {};
        st.markerGroups.earth.add(arcLine);
      }
    }

    // 3. Surface-Conforming 1°×1° Global Analog Screening Cells (InstancedMesh Tiles)
    if (showDiscoveryHeatmap && discoveryCells.length > 0) {
      const topCells = [...discoveryCells]
        .sort((a, b) => b.scorePct - a.scorePct)
        .slice(0, 2200);
      const cellGeo = new THREE.PlaneGeometry(1, 1);
      const cellMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const inst = new THREE.InstancedMesh(cellGeo, cellMat, topCells.length);

      const degToRad = Math.PI / 180;
      const cellHeightRad = degToRad * 0.86;
      const _east = new THREE.Vector3();
      const _north = new THREE.Vector3();
      const _up = new THREE.Vector3();
      const _worldUp = new THREE.Vector3(0, 1, 0);
      const _basis = new THREE.Matrix4();
      const _scaleMat = new THREE.Matrix4();

      topCells.forEach((cell, idx) => {
        const sampledElev = st.planets.earth.sampleDisplacedElevationM(cell.lat, cell.lon);
        const cellElevM = sampledElev !== null ? Math.max(3800, sampledElev + 1400) : 4500;
        const pt = latLonToThreeCartesian(
          cell.lat,
          cell.lon,
          cellElevM,
          'earth',
          UNIT_RADIUS
        );
        _up.set(pt.x, pt.y, pt.z).normalize();
        _east.crossVectors(_worldUp, _up);
        if (_east.lengthSq() < 1e-6) {
          _east.set(1, 0, 0);
        } else {
          _east.normalize();
        }
        _north.crossVectors(_up, _east).normalize();

        const cosLat = Math.max(0.18, Math.cos(cell.lat * degToRad));
        const cellWidthRad = cellHeightRad * cosLat;

        _basis.makeBasis(_east, _north, _up);
        _basis.setPosition(pt.x, pt.y, pt.z);
        _scaleMat.makeScale(cellWidthRad, cellHeightRad, 1);
        _mat4.multiplyMatrices(_basis, _scaleMat);
        inst.setMatrixAt(idx, _mat4);

        _color.setHex(
          cell.scorePct >= 68
            ? 0x10b981
            : cell.scorePct >= 54
              ? 0x06b6d4
              : 0xf59e0b
        );
        inst.setColorAt(idx, _color);
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();

      st.markerGroups.earth.add(inst);
      st.discoveryInstanced = inst;
      st.discoveryTopCells = topCells;
    }

    // 4. Inspected Surface Selection Bracket (Mars/Moon terrain, 1° cell, or Earth search)
    const addInspectionBeacon = (
      body: BodyType,
      lat: number,
      lon: number,
      colorHex: number,
      squareCell = false
    ) => {
      const sampledElev =
        body === 'earth' ? st.planets.earth.sampleDisplacedElevationM(lat, lon) : null;
      const beaconElevM =
        body === 'earth' ? Math.max(4500, (sampledElev ?? 0) + 1800) : 4500;
      const basePos = latLonToThreeCartesian(lat, lon, beaconElevM, body, UNIT_RADIUS);
      const dir = new THREE.Vector3(basePos.x, basePos.y, basePos.z).normalize();
      const anchor = new THREE.Group();
      anchor.position.set(basePos.x, basePos.y, basePos.z);

      if (squareCell) {
        const worldUp = new THREE.Vector3(0, 1, 0);
        const east = new THREE.Vector3().crossVectors(worldUp, dir);
        if (east.lengthSq() < 1e-6) {
          east.set(1, 0, 0);
        } else {
          east.normalize();
        }
        const north = new THREE.Vector3().crossVectors(dir, east).normalize();
        const basis = new THREE.Matrix4().makeBasis(east, north, dir);
        anchor.quaternion.setFromRotationMatrix(basis);
        st.markerGroups[body].add(anchor);

        const degToRad = Math.PI / 180;
        const hRad = degToRad * 0.94;
        const wRad = hRad * Math.max(0.18, Math.cos(lat * degToRad));
        const hw = wRad * 0.5;
        const hh = hRad * 0.5;
        const borderPts = [
          new THREE.Vector3(-hw, -hh, 0.002),
          new THREE.Vector3(hw, -hh, 0.002),
          new THREE.Vector3(hw, hh, 0.002),
          new THREE.Vector3(-hw, hh, 0.002),
          new THREE.Vector3(-hw, -hh, 0.002),
        ];
        const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
        const borderMat = new THREE.LineBasicMaterial({ color: colorHex });
        const borderLine = new THREE.Line(borderGeo, borderMat);
        borderLine.raycast = () => {};
        anchor.add(borderLine);
        return;
      }

      anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      st.markerGroups[body].add(anchor);
      st.pinScalables.push(anchor);

      const ringGeo = new THREE.RingGeometry(0.028, 0.042, 4);
      const ringMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.005, 0);
      ring.raycast = () => {};
      anchor.add(ring);

      const dotGeo = new THREE.OctahedronGeometry(0.011, 0);
      const dotMat = new THREE.MeshBasicMaterial({ color: colorHex });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(0, 0.014, 0);
      dot.raycast = () => {};
      anchor.add(dot);
    };

    if (inspectedPlanetaryPoint) {
      addInspectionBeacon(
        inspectedPlanetaryPoint.body,
        inspectedPlanetaryPoint.lat,
        inspectedPlanetaryPoint.lon,
        0xfbbf24
      );
    }
    if (inspectedEarthPoint) {
      addInspectionBeacon(
        'earth',
        inspectedEarthPoint.lat,
        inspectedEarthPoint.lon,
        0x22d3ee,
        inspectedEarthPoint.sourceKind === 'cell'
      );
    }

    st.forceLabelRefresh = true;
    st.requestRender();
  }, [
    targets,
    config.targetIds,
    dossiers,
    activeTargetTabId,
    selectedSiteId,
    maxSlopeFilterDeg,
    showDiscoveryHeatmap,
    discoveryCells,
    inspectedPlanetaryPoint,
    inspectedEarthPoint,
    terrainElevSeq,
  ]);

  // Tab-Style Morphing Switcher, System Overview & Pin Fly-To (Preserves Per-Tab Zoom Memory)
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;

    const prevBody = prevBodyFocusRef.current;
    const prevPin = prevPinRef.current;
    prevBodyFocusRef.current = bodyFocus;
    prevPinRef.current = focusedPinCoords;

    if (globeCameraMode === 'system_overview') {
      // Cancel morph & arrange all 3 bodies at compressed orbital positions
      st.morph.active = false;
      st.morphRing.visible = false;
      setMorphDisplay(null);
      (['earth', 'mars', 'moon'] as BodyType[]).forEach((b) => {
        st.planets[b].group.visible = true;
        st.planets[b].group.position.copy(PLANET_OVERVIEW_POS[b]);
        st.planets[b].group.scale.setScalar(OVERVIEW_SCALES[b]);
        st.planets[b].setOpacity(1.0);
        const atmos = st.atmosphereMeshes[b];
        if (atmos) {
          (atmos.material as THREE.ShaderMaterial).uniforms.uIntensity.value =
            st.atmosphereBaseIntensity[b] ?? 0.4;
        }
      });

      st.cameraGoalTarget.copy(SYSTEM_OVERVIEW_TARGET);
      _vA.subVectors(SYSTEM_OVERVIEW_CAM, SYSTEM_OVERVIEW_TARGET);
      st.cameraGoalDist = _vA.length();
      st.cameraGoalDir.copy(_vA).normalize();
      st.transitionActive = true;
      st.requestRender();
      return;
    }

    // Centered Tab Mode ('planet_focus')
    const bodyChanged = prevBody !== bodyFocus;
    const pinChangedForBody =
      focusedPinCoords !== null &&
      focusedPinCoords.body === bodyFocus &&
      (prevPin === null ||
        prevPin.nonce !== focusedPinCoords.nonce ||
        prevPin.body !== focusedPinCoords.body ||
        prevPin.lat !== focusedPinCoords.lat ||
        prevPin.lon !== focusedPinCoords.lon);

    if (bodyChanged) {
      // Snapshot outgoing body's latest camera state only if settled (not mid-flight)
      const outLen = st.camera.position.length();
      if (!st.transitionActive && !st.morph.active && outLen > 0.5 && st.controls.target.length() < 0.1) {
        perBodyCameraRef.current[prevBody].dir.copy(st.camera.position).divideScalar(outLen);
        perBodyCameraRef.current[prevBody].dist = outLen;
      }

      // Hide the 3rd non-participating body & center both morphing bodies at (0,0,0)
      (['earth', 'mars', 'moon'] as BodyType[]).forEach((b) => {
        st.planets[b].group.position.set(0, 0, 0);
        if (b !== prevBody && b !== bodyFocus) {
          st.planets[b].group.visible = false;
          st.planets[b].group.scale.setScalar(1.0);
          st.planets[b].setOpacity(0.0);
        }
      });

      st.morph = {
        active: true,
        fromBody: prevBody,
        toBody: bodyFocus,
        elapsed: 0,
        duration: 0.85,
      };
      setMorphDisplay({ active: true, from: prevBody, to: bodyFocus });
    } else {
      // Ensure active body is cleanly centered at (0,0,0) (e.g. returning from System Overview)
      st.morph.active = false;
      st.morphRing.visible = false;
      setMorphDisplay(null);
      (['earth', 'mars', 'moon'] as BodyType[]).forEach((b) => {
        st.planets[b].group.position.set(0, 0, 0);
        st.planets[b].group.scale.setScalar(1.0);
        st.planets[b].group.visible = b === bodyFocus;
        st.planets[b].setOpacity(b === bodyFocus ? 1.0 : 0.0);
        const atmos = st.atmosphereMeshes[b];
        if (atmos) {
          (atmos.material as THREE.ShaderMaterial).uniforms.uIntensity.value =
            st.atmosphereBaseIntensity[b] ?? 0.4;
        }
      });
    }

    st.cameraGoalTarget.set(0, 0, 0);

    if (pinChangedForBody && focusedPinCoords) {
      const targetDir = dirFromLatLon(focusedPinCoords.lat, focusedPinCoords.lon, bodyFocus);
      const savedDist = perBodyCameraRef.current[bodyFocus].dist;
      const targetDist = focusedPinCoords.zoom
        ? Math.min(savedDist, bodyFocus === 'earth' ? 1.18 : 1.35)
        : savedDist;
      perBodyCameraRef.current[bodyFocus].dir.copy(targetDir);
      perBodyCameraRef.current[bodyFocus].dist = targetDist;
      st.cameraGoalDir.copy(targetDir);
      st.cameraGoalDist = targetDist;
    } else {
      // Smoothly restore the target tab's saved zoom level & orientation!
      const saved = perBodyCameraRef.current[bodyFocus];
      st.cameraGoalDir.copy(saved.dir);
      st.cameraGoalDist = saved.dist;
    }

    st.transitionActive = true;
    st.forceLabelRefresh = true;
    st.requestRender();
  }, [bodyFocus, globeCameraMode, focusedPinCoords]);

  const adjustZoom = (factor: number) => {
    const st = sceneRef.current;
    if (!st) return;
    const focusGroup = st.planets[bodyFocus].group;
    const targetPos =
      globeCameraMode === 'system_overview'
        ? SYSTEM_OVERVIEW_TARGET
        : focusGroup.position;
    const r = globeCameraMode === 'system_overview' ? OVERVIEW_SCALES[bodyFocus] : UNIT_RADIUS;
    _vA.subVectors(st.camera.position, targetPos);
    const curDist = _vA.length();
    const minD = globeCameraMode === 'planet_focus' ? UNIT_RADIUS * 1.005 : 1.8;
    const nextDist = THREE.MathUtils.clamp(r + (curDist - r) * factor, minD, 24);
    st.cameraGoalTarget.copy(targetPos);
    st.cameraGoalDir.copy(_vA).normalize();
    st.cameraGoalDist = nextDist;
    if (globeCameraMode === 'planet_focus') {
      perBodyCameraRef.current[bodyFocus].dir.copy(st.cameraGoalDir);
      perBodyCameraRef.current[bodyFocus].dist = nextDist;
    }
    st.transitionActive = true;
    st.requestRender();
  };

  const resetOrbitView = () => {
    const st = sceneRef.current;
    if (!st) return;
    setGlobeCameraMode('planet_focus');
    const def = DEFAULT_BODY_CAMERA[bodyFocus];
    const dir = dirFromLatLon(def.lat, def.lon, bodyFocus);
    perBodyCameraRef.current[bodyFocus].dir.copy(dir);
    perBodyCameraRef.current[bodyFocus].dist = def.dist;
    st.cameraGoalTarget.set(0, 0, 0);
    st.cameraGoalDir.copy(dir);
    st.cameraGoalDist = def.dist;
    st.transitionActive = true;
    st.requestRender();
  };

  const activeBodyLabel = useMemo(() => bodyFocus.toUpperCase(), [bodyFocus]);
  const dataSourceLabel = useMemo(
    () => getActiveDataSourceLabel(bodyFocus, earthOverlay, marsOverlay, moonOverlay),
    [bodyFocus, earthOverlay, marsOverlay, moonOverlay]
  );

  return (
    <div className="relative w-full h-full bg-[#04070d] select-none overflow-hidden">
      <div ref={mountRef} className="w-full h-full" />

      {/* Google Earth-Style Projected Location Labels (All 3 Bodies, Toggleable) */}
      {showLocationLabels && globeCameraMode === 'planet_focus' && projectedLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
          {projectedLabels.map((lbl) => {
            const isTarget = lbl.category === 'target';
            const isSite = lbl.category === 'site';
            const isCity = lbl.category === 'city';
            const isRegion = lbl.tier === 1 && !isTarget && !isSite;

            return (
              <div
                key={lbl.id}
                style={{
                  transform: `translate(${lbl.x}px, ${lbl.y}px) translate(-50%, -120%)`,
                }}
                className="absolute top-0 left-0 flex items-center gap-1 whitespace-nowrap"
              >
                <span
                  className={
                    isTarget
                      ? 'text-[11px] font-semibold text-amber-200 [text-shadow:0_1px_3px_rgba(0,0,0,0.98),0_0_8px_rgba(0,0,0,0.95)]'
                      : isSite
                        ? 'text-[11px] font-semibold text-cyan-200 [text-shadow:0_1px_3px_rgba(0,0,0,0.98),0_0_8px_rgba(0,0,0,0.95)]'
                        : isRegion
                          ? bodyFocus === 'mars'
                            ? 'text-[10px] font-mono uppercase tracking-[0.14em] text-amber-100/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.95)]'
                            : bodyFocus === 'moon'
                              ? 'text-[10px] font-mono uppercase tracking-[0.14em] text-slate-200/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.95)]'
                              : 'text-[10px] font-mono uppercase tracking-[0.14em] text-sky-100/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.95)]'
                          : isCity
                            ? 'text-[11px] font-medium text-slate-100 [text-shadow:0_1px_3px_rgba(0,0,0,0.98),0_0_6px_rgba(0,0,0,0.95)]'
                            : 'text-[11px] font-medium text-slate-100/95 [text-shadow:0_1px_3px_rgba(0,0,0,0.98),0_0_6px_rgba(0,0,0,0.95)]'
                  }
                >
                  {lbl.name}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Morphing HUD Badge during Tab Transition */}
      {morphDisplay?.active && (
        <div className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-[25] px-3 py-1 rounded border border-cyan-500/50 bg-[#09111e]/95 text-[10px] font-mono tracking-widest uppercase text-cyan-200">
          Morphing Surface · {morphDisplay.from.toUpperCase()} → {morphDisplay.to.toUpperCase()}
        </div>
      )}

      {/* Top-Left Camera Mode Bar (Solid Surface, Zero Backdrop Blur) */}
      <div className="absolute top-3 left-3 z-[20] flex items-center gap-2">
        <div className="inline-flex rounded border border-slate-700 bg-[#0a0e16]/95 p-0.5">
          <button
            type="button"
            onClick={() => setGlobeCameraMode('planet_focus')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              globeCameraMode === 'planet_focus'
                ? 'bg-cyan-500/20 text-cyan-200'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Planet Tab ({activeBodyLabel})
          </button>
          <button
            type="button"
            onClick={() => setGlobeCameraMode('system_overview')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              globeCameraMode === 'system_overview'
                ? 'bg-amber-500/20 text-amber-200'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            System Overview
          </button>
        </div>

        {globeCameraMode === 'system_overview' && (
          <div className="px-2.5 py-1 rounded border border-amber-500/50 bg-[#1a1308] font-mono text-[10px] tracking-wider text-amber-300 whitespace-nowrap">
            ORBITAL SPACING COMPRESSED
          </div>
        )}
      </div>

      {/* Top-Right Pin Legend & Zoom Controls */}
      <div className="absolute top-3 right-3 z-[20] flex flex-col items-end gap-2">
        <div className="pointer-events-none px-2.5 py-1.5 rounded border border-slate-800 bg-[#0a0e16]/95 text-[10px] font-mono text-slate-300 flex items-center gap-3">
          {bodyFocus === 'earth' ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400" />
                Analog Pin
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 bg-emerald-400/70 border border-emerald-400" />
                1° Cell
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-emerald-400" />
                2-Site Arc
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rotate-45 bg-amber-400" />
              {bodyFocus.toUpperCase()} Target Reticle
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => adjustZoom(0.55)}
            title="Zoom In (Stream Higher Tile LOD)"
            className="p-1.5 rounded border border-slate-700 bg-[#0a0e16]/95 text-slate-200 hover:border-cyan-400 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => adjustZoom(1.75)}
            title="Zoom Out"
            className="p-1.5 rounded border border-slate-700 bg-[#0a0e16]/95 text-slate-200 hover:border-cyan-400 cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={resetOrbitView}
            title="Reset Current Tab Orbit"
            className="p-1.5 rounded border border-slate-700 bg-[#0a0e16]/95 text-slate-200 hover:border-amber-400 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom-Left Live Altitude, Coordinates & LOD Telemetry */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[20] px-2.5 py-1 rounded border border-slate-800 bg-[#0a0e16]/95 text-[10px] font-mono tabular-nums text-slate-300 flex items-center gap-2">
        <span className="text-cyan-300">LOD z={hudTelemetry.lodZoom}</span>
        <span>·</span>
        <span>ALT {hudTelemetry.altKm.toLocaleString()} km</span>
        <span>·</span>
        <span>
          {hudTelemetry.centerLat.toFixed(2)}°, {hudTelemetry.centerLon.toFixed(2)}°
        </span>
      </div>

      {/* Bottom-Right Active Imagery & DEM Data Source Attribution */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-[20] px-2.5 py-1 rounded border border-slate-800 bg-[#0a0e16]/95 text-[10px] font-mono text-slate-300 max-w-[56%] truncate">
        {dataSourceLabel}
      </div>

      {/* Hover Telemetry Tooltip */}
      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-[30] px-2.5 py-1.5 rounded border border-slate-700 bg-[#0d121c] text-[11px] shadow-lg max-w-[260px]"
          style={{
            left: Math.max(
              8,
              Math.min(
                hoverInfo.x + 14,
                Math.max(12, (mountRef.current?.clientWidth ?? 600) - 276)
              )
            ),
            top: Math.max(
              8,
              Math.min(
                hoverInfo.y - 44,
                Math.max(12, (mountRef.current?.clientHeight ?? 480) - 68)
              )
            ),
          }}
        >
          <div className="font-semibold text-slate-100 truncate">
            {hoverInfo.label}
          </div>
          <div className="font-mono text-[10px] text-cyan-300 truncate">
            {hoverInfo.detail}
          </div>
        </div>
      )}
    </div>
  );
}
