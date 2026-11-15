import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { resolveEarthRegion } from '../src/engine/earthRegionResolver.js';
import { computeEarthGrazingSunHoursPerDay } from '../src/engine/physics.js';
import type {
  DataLineageItem,
  EarthAnalogSite,
  LiveTelemetryPatch,
  LiveVerificationBatchResponse,
  MonthlyClimatologyBin,
  PermitTier,
  ProbeEarthPointResponse,
  ProcessTag,
  ProvenanceTier,
  VoidType,
} from '../src/types/planetary.js';

export const MAX_BATCH_POINTS = 40;
const CACHE_DIR = path.resolve(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'earth_probe_cache.json');
const MAX_CACHE_ENTRIES = 600;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedProbeRecord {
  key: string;
  cachedAt: string;
  site: EarthAnalogSite;
  patch?: LiveTelemetryPatch;
  warnings: string[];
}

const memoryLru = new Map<string, CachedProbeRecord>();
let diskLoaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();

async function ensureDiskLoaded(): Promise<void> {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const raw = await readFile(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as CachedProbeRecord[];
    if (Array.isArray(parsed)) {
      const now = Date.now();
      for (const entry of parsed.slice(-MAX_CACHE_ENTRIES)) {
        if (!entry?.key || !entry?.site) continue;
        const ts = Date.parse(entry.cachedAt);
        if (Number.isFinite(ts) && now - ts <= CACHE_TTL_MS) {
          memoryLru.set(entry.key, entry);
        }
      }
    }
  } catch {
    // Cache file may not exist on first run
  }
}

async function persistCacheAtomic(): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entries = Array.from(memoryLru.values()).slice(-MAX_CACHE_ENTRIES);
    const tmpFile = `${CACHE_FILE}.tmp`;
    await writeFile(tmpFile, JSON.stringify(entries), 'utf-8');
    await rename(tmpFile, CACHE_FILE);
  } catch {
    // Non-fatal cache write failure
  }
}

function schedulePersistCacheToDisk(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistChain = persistChain.then(() => persistCacheAtomic());
  }, 150);
}

function getCache(key: string): CachedProbeRecord | null {
  const hit = memoryLru.get(key);
  if (!hit) return null;
  const ts = Date.parse(hit.cachedAt);
  if (!Number.isFinite(ts) || Date.now() - ts > CACHE_TTL_MS) {
    memoryLru.delete(key);
    return null;
  }
  memoryLru.delete(key);
  memoryLru.set(key, hit);
  return hit;
}

function setCache(record: CachedProbeRecord): void {
  if (memoryLru.has(record.key)) {
    memoryLru.delete(record.key);
  }
  memoryLru.set(record.key, record);
  while (memoryLru.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryLru.keys().next().value;
    if (!oldestKey) break;
    memoryLru.delete(oldestKey);
  }
  schedulePersistCacheToDisk();
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'WeywotEngine-Probe/7.0',
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface PowerResult {
  monthly: MonthlyClimatologyBin[];
  meanAlbedo: number | null;
  meanRhPct: number;
  wind50Ms: number;
  wind95Ms: number;
  fallbackUsed: boolean;
}

const POWER_MONTH_KEYS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

function buildFallbackClimatology(lat: number): PowerResult {
  const absLat = Math.abs(lat);
  const monthly: MonthlyClimatologyBin[] = [];
  for (let m = 1; m <= 12; m++) {
    const phase = ((m - (lat >= 0 ? 7 : 1)) * Math.PI) / 6;
    const baseTempC = 28 - absLat * 0.55 + Math.cos(phase) * (4 + absLat * 0.12);
    const tMeanK = Math.max(225, baseTempC + 273.15);
    const clearSkyFraction = Math.max(0.25, Math.min(0.88, 0.72 - (absLat < 15 ? 0.25 : 0)));
    monthly.push({
      month: m,
      tMeanK: Number(tMeanK.toFixed(2)),
      tStdK: 2.8,
      diurnalDeltaK: 11.5,
      pPrecipGt5Mm: 0.04,
      pressureKpa: 94.5,
      ambientDensityKgM3: Number(((94.5 * 1000) / (287.058 * tMeanK)).toFixed(4)),
      uvAbFluxWm2: Number(Math.max(2, 28 - absLat * 0.25).toFixed(2)),
      clearSkyFraction: Number(clearSkyFraction.toFixed(3)),
      grazingSunHoursPerDay: Number(
        computeEarthGrazingSunHoursPerDay(lat, m, clearSkyFraction).toFixed(3)
      ),
      snowDepthCm: absLat > 65 ? 12 : 0,
      gwettop: 0.22,
    });
  }
  return {
    monthly,
    meanAlbedo: 0.22,
    meanRhPct: 45,
    wind50Ms: 3.4,
    wind95Ms: 7.8,
    fallbackUsed: true,
  };
}

function validPowerVal(val: unknown): val is number {
  return typeof val === 'number' && val > -900 && Number.isFinite(val);
}

async function fetchNasaPowerCore(lat: number, lon: number): Promise<PowerResult> {
  // Fast 20-year climatology endpoint eliminates multi-megabyte 10-yr daily payloads & timeouts
  const agUrl =
    `https://power.larc.nasa.gov/api/temporal/climatology/point?` +
    `parameters=T2M,T2M_MIN,T2M_MAX,PRECTOTCORR,PS,GWETTOP,SNODP,RH2M,WS10M` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
  const reUrl =
    `https://power.larc.nasa.gov/api/temporal/climatology/point?` +
    `parameters=ALLSKY_SRF_ALB,ALLSKY_SFC_UVA,ALLSKY_SFC_UVB,CLOUD_AMT` +
    `&community=RE&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;

  try {
    const [agResp, reResp] = await Promise.all([
      fetchWithTimeout(agUrl, 6000),
      fetchWithTimeout(reUrl, 6000),
    ]);
    if (!agResp.ok || !reResp.ok) {
      throw new Error(`POWER HTTP ${agResp.status}/${reResp.status}`);
    }
    const [agJson, reJson] = (await Promise.all([agResp.json(), reResp.json()])) as [
      { properties?: { parameter?: Record<string, Record<string, number>> } },
      { properties?: { parameter?: Record<string, Record<string, number>> } },
    ];

    const agP = agJson.properties?.parameter;
    const reP = reJson.properties?.parameter;
    if (!agP?.T2M || !reP?.CLOUD_AMT) {
      throw new Error('Incomplete POWER climatology payload');
    }

    const monthly: MonthlyClimatologyBin[] = [];
    const allAlbedos: number[] = [];
    const allRh: number[] = [];
    const allWs: number[] = [];
    const absLat = Math.abs(lat);

    for (let idx = 0; idx < POWER_MONTH_KEYS.length; idx++) {
      const m = idx + 1;
      const mKey = POWER_MONTH_KEYS[idx];

      const t2m = agP.T2M[mKey];
      const tMeanK = validPowerVal(t2m) ? t2m + 273.15 : 285;

      const tmin = agP.T2M_MIN?.[mKey];
      const tmax = agP.T2M_MAX?.[mKey];
      const diurnalDeltaK =
        validPowerVal(tmin) && validPowerVal(tmax) ? Math.max(0.5, tmax - tmin) : 10.0;

      const tStdK = Number((2.0 + absLat * 0.03 + diurnalDeltaK * 0.08).toFixed(2));

      const pr = agP.PRECTOTCORR?.[mKey];
      // Map mean monthly precipitation rate (mm/day) cleanly to P(precip > 5mm/day)
      const pPrecipGt5Mm = validPowerVal(pr)
        ? pr <= 0.05
          ? 0.0
          : Math.min(0.85, 1 - Math.exp(-Math.max(0, pr) / 8.5))
        : 0.02;

      const ps = agP.PS?.[mKey];
      const pressureKpa = validPowerVal(ps) ? Math.max(25, ps) : 95.0;
      const ambientDensityKgM3 = (pressureKpa * 1000) / (287.058 * Math.max(150, tMeanK));

      const gw = agP.GWETTOP?.[mKey];
      const gwettop = validPowerVal(gw) ? Math.max(0, Math.min(1, gw)) : 0.25;

      const sn = agP.SNODP?.[mKey];
      const snowDepthCm = validPowerVal(sn) ? Math.max(0, sn) : 0;

      const rh = agP.RH2M?.[mKey];
      if (validPowerVal(rh)) allRh.push(Math.max(0, Math.min(100, rh)));

      const ws = agP.WS10M?.[mKey];
      if (validPowerVal(ws)) allWs.push(Math.max(0, ws));

      const uva = reP.ALLSKY_SFC_UVA?.[mKey];
      const uvb = reP.ALLSKY_SFC_UVB?.[mKey];
      const uvAbFluxWm2 =
        validPowerVal(uva) && validPowerVal(uvb)
          ? Math.max(0, uva + uvb)
          : validPowerVal(uva)
            ? Math.max(0, uva)
            : 15.0;

      const cld = reP.CLOUD_AMT?.[mKey];
      const cldPct = validPowerVal(cld) ? Math.max(0, Math.min(100, cld)) : 35.0;
      const clearSkyFraction = Math.max(0, Math.min(1, 1 - cldPct / 100));
      const grazingSunHoursPerDay = computeEarthGrazingSunHoursPerDay(
        lat,
        m,
        clearSkyFraction
      );

      const alb = reP.ALLSKY_SRF_ALB?.[mKey];
      if (validPowerVal(alb) && alb >= 0.01 && alb <= 0.98) {
        allAlbedos.push(alb);
      }

      monthly.push({
        month: m,
        tMeanK: Number(tMeanK.toFixed(2)),
        tStdK,
        diurnalDeltaK: Number(diurnalDeltaK.toFixed(2)),
        pPrecipGt5Mm: Number(pPrecipGt5Mm.toFixed(4)),
        pressureKpa: Number(pressureKpa.toFixed(2)),
        ambientDensityKgM3: Number(ambientDensityKgM3.toFixed(4)),
        uvAbFluxWm2: Number(uvAbFluxWm2.toFixed(2)),
        clearSkyFraction: Number(clearSkyFraction.toFixed(3)),
        grazingSunHoursPerDay: Number(grazingSunHoursPerDay.toFixed(3)),
        snowDepthCm: Number(snowDepthCm.toFixed(2)),
        gwettop: Number(gwettop.toFixed(3)),
      });
    }

    const sortedWs = [...allWs].sort((a, b) => a - b);
    const wind50Ms =
      sortedWs.length > 0 ? sortedWs[Math.floor(sortedWs.length * 0.5)] : 3.2;
    const maxMonthlyWind = sortedWs.length > 0 ? sortedWs[sortedWs.length - 1] : 4.5;
    const wind95Ms = Math.max(wind50Ms * 1.6, maxMonthlyWind * 1.55);
    const meanRhPct =
      allRh.length > 0 ? allRh.reduce((a, b) => a + b, 0) / allRh.length : 45;
    const meanAlbedo =
      allAlbedos.length > 0
        ? Number((allAlbedos.reduce((a, b) => a + b, 0) / allAlbedos.length).toFixed(3))
        : null;

    return {
      monthly,
      meanAlbedo,
      meanRhPct: Number(meanRhPct.toFixed(1)),
      wind50Ms: Number(wind50Ms.toFixed(2)),
      wind95Ms: Number(wind95Ms.toFixed(2)),
      fallbackUsed: false,
    };
  } catch {
    return buildFallbackClimatology(lat);
  }
}

export interface TerrariumResult {
  elevationM: number;
  medianSlopeDeg: number | null;
  p95SlopeDeg: number | null;
  dtmResolutionM: number;
  zoomUsed: number;
  source: 'terrarium' | 'open_meteo_fallback' | 'prior_fallback';
  elevationOnly?: boolean;
}

export function latLonToTilePixel(lat: number, lon: number, z: number) {
  const latC = Math.max(-85.0511, Math.min(85.0511, lat));
  const n = 2 ** z;
  const xFloat = ((lon + 180) / 360) * n;
  const latRad = (latC * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = ((Math.floor(xFloat) % n) + n) % n;
  const ty = Math.max(0, Math.min(n - 1, Math.floor(yFloat)));
  const px = Math.max(0, Math.min(255, Math.floor((xFloat - Math.floor(xFloat)) * 256)));
  const py = Math.max(0, Math.min(255, Math.floor((yFloat - Math.floor(yFloat)) * 256)));
  return { tx, ty, px, py };
}

export function computeStitchedTerrariumSlopes(
  tiles: Map<string, PNG>,
  z: number,
  tx: number,
  ty: number,
  px: number,
  py: number,
  resM: number
): { centerElev: number; medianSlopeDeg: number; p95SlopeDeg: number } {
  const n = 2 ** z;
  const elevAtOffset = (ox: number, oy: number): number => {
    const absX = px + ox;
    const absY = py + oy;
    const dtx = Math.floor(absX / 256);
    const dty = Math.floor(absY / 256);
    const ntx = ((tx + dtx) % n + n) % n;
    const nty = Math.max(0, Math.min(n - 1, ty + dty));
    const localX = ((absX % 256) + 256) % 256;
    const localY = Math.max(0, Math.min(255, absY - dty * 256));

    const tile = tiles.get(`${ntx}_${nty}`) ?? tiles.get(`${tx}_${ty}`);
    if (!tile) return 0;
    const idx = (Math.min(tile.height - 1, localY) * tile.width + Math.min(tile.width - 1, localX)) * 4;
    const r = tile.data[idx];
    const g = tile.data[idx + 1];
    const b = tile.data[idx + 2];
    return r * 256 + g + b / 256 - 32768;
  };

  const centerElev = elevAtOffset(0, 0);
  const slopes: number[] = [];

  for (let oy = -16; oy < 16; oy++) {
    for (let ox = -16; ox < 16; ox++) {
      const a = elevAtOffset(ox - 1, oy - 1);
      const b = elevAtOffset(ox, oy - 1);
      const c = elevAtOffset(ox + 1, oy - 1);
      const d = elevAtOffset(ox - 1, oy);
      const f = elevAtOffset(ox + 1, oy);
      const g = elevAtOffset(ox - 1, oy + 1);
      const h = elevAtOffset(ox, oy + 1);
      const i = elevAtOffset(ox + 1, oy + 1);
      const dzDx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * resM);
      const dzDy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * resM);
      slopes.push((Math.atan(Math.hypot(dzDx, dzDy)) * 180) / Math.PI);
    }
  }

  slopes.sort((u, v) => u - v);
  const medianSlopeDeg = slopes.length > 0 ? slopes[Math.floor(slopes.length * 0.5)] : 2.5;
  const p95SlopeDeg =
    slopes.length > 0 ? slopes[Math.min(slopes.length - 1, Math.floor(slopes.length * 0.95))] : 6.5;

  return { centerElev, medianSlopeDeg, p95SlopeDeg };
}

async function fetchTerrariumCore(
  lat: number,
  lon: number,
  featureFootprintKm: number
): Promise<TerrariumResult> {
  const z = featureFootprintKm < 1.5 ? 14 : featureFootprintKm <= 10 ? 12 : 10;

  if (Math.abs(lat) <= 85.0) {
    try {
      const n = 2 ** z;
      const { tx, ty, px, py } = latLonToTilePixel(lat, lon, z);

      // Determine adjacent tiles needed if 34x34 neighborhood crosses a 256px tile edge
      const dtxSet = new Set<number>([0]);
      const dtySet = new Set<number>([0]);
      if (px - 17 < 0) dtxSet.add(-1);
      if (px + 16 >= 256) dtxSet.add(1);
      if (py - 17 < 0 && ty > 0) dtySet.add(-1);
      if (py + 16 >= 256 && ty < n - 1) dtySet.add(1);

      const tileCoords: Array<{ key: string; ntx: number; nty: number }> = [];
      for (const dtx of dtxSet) {
        for (const dty of dtySet) {
          const ntx = ((tx + dtx) % n + n) % n;
          const nty = Math.max(0, Math.min(n - 1, ty + dty));
          const key = `${ntx}_${nty}`;
          if (!tileCoords.some((tc) => tc.key === key)) {
            tileCoords.push({ key, ntx, nty });
          }
        }
      }

      const tiles = new Map<string, PNG>();
      await Promise.all(
        tileCoords.map(async ({ key, ntx, nty }) => {
          const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${ntx}/${nty}.png`;
          const resp = await fetchWithTimeout(url, 4000);
          if (!resp.ok) {
            if (ntx === tx && nty === ty) {
              throw new Error(`Terrarium HTTP ${resp.status}`);
            }
            return;
          }
          const buf = Buffer.from(await resp.arrayBuffer());
          tiles.set(key, PNG.sync.read(buf));
        })
      );

      if (!tiles.has(`${tx}_${ty}`)) {
        throw new Error('Center Terrarium tile missing');
      }

      const resM = Math.max(
        4.0,
        (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
      );
      const { centerElev, medianSlopeDeg, p95SlopeDeg } = computeStitchedTerrariumSlopes(
        tiles,
        z,
        tx,
        ty,
        px,
        py,
        resM
      );

      return {
        elevationM: Number(centerElev.toFixed(1)),
        medianSlopeDeg: Number(medianSlopeDeg.toFixed(2)),
        p95SlopeDeg: Number(p95SlopeDeg.toFixed(2)),
        dtmResolutionM: Number(resM.toFixed(1)),
        zoomUsed: z,
        source: 'terrarium',
        elevationOnly: false,
      };
    } catch {
      // Fallback to Open-Meteo Elevation below
    }
  }

  try {
    const omUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
    const omResp = await fetchWithTimeout(omUrl, 3000);
    if (omResp.ok) {
      const json = (await omResp.json()) as { elevation?: number[] };
      const el = json.elevation?.[0];
      if (typeof el === 'number' && Number.isFinite(el)) {
        return {
          elevationM: Number(el.toFixed(1)),
          medianSlopeDeg: null,
          p95SlopeDeg: null,
          dtmResolutionM: 90.0,
          zoomUsed: z,
          source: 'open_meteo_fallback',
          elevationOnly: true,
        };
      }
    }
  } catch {
    // Final static fallback
  }

  return {
    elevationM: 450,
    medianSlopeDeg: null,
    p95SlopeDeg: null,
    dtmResolutionM: 90.0,
    zoomUsed: z,
    source: 'prior_fallback',
    elevationOnly: true,
  };
}

interface MacrostratPriors {
  lithologyDesc: string;
  maficIndex: number;
  silicaWtPct: number;
  tiO2WtPct: number;
  clayIndex: number;
  sulfateIndex: number;
  carbonateIndex: number;
  simulantNearest: string;
  voidHint: VoidType;
  processes: ProcessTag[];
  available: boolean;
}

async function fetchMacrostratEnrichment(lat: number, lon: number): Promise<MacrostratPriors> {
  const defaultPriors: MacrostratPriors = {
    lithologyDesc: 'Unmapped sedimentary/siliciclastic regolith prior',
    maficIndex: 0.25,
    silicaWtPct: 58.0,
    tiO2WtPct: 0.7,
    clayIndex: 0.16,
    sulfateIndex: 0.1,
    carbonateIndex: 0.1,
    simulantNearest: 'Siliciclastic Basaltic-Andesitic Regolith',
    voidHint: 'none',
    processes: ['aeolian_saltation'],
    available: false,
  };

  try {
    const url = `https://macrostrat.org/api/v2/geologic_units/map?lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}`;
    const resp = await fetchWithTimeout(url, 3500);
    if (!resp.ok) return defaultPriors;
    const json = (await resp.json()) as {
      success?: {
        data?: Array<{
          unit_name?: string;
          strat_name?: string;
          lith?: string;
          descrip?: string;
        }>;
      };
    };
    const units = json.success?.data;
    if (!units || units.length === 0) return defaultPriors;

    const top = units[0];
    const text = `${top.unit_name ?? ''} ${top.strat_name ?? ''} ${top.lith ?? ''} ${top.descrip ?? ''}`;
    const lower = text.toLowerCase();
    const label = `${top.unit_name || top.strat_name || 'Geologic Unit'} (${top.lith || 'mixed'})`.trim();

    if (/basalt|gabbro|mafic|diabase|volcanic|scoria|olivine|andesit/i.test(lower)) {
      return {
        lithologyDesc: `Macrostrat v2: ${label} (host rock; subsurface void unconfirmed)`,
        maficIndex: 0.56,
        silicaWtPct: 48.2,
        tiO2WtPct: 1.95,
        clayIndex: 0.05,
        sulfateIndex: 0.04,
        carbonateIndex: 0.03,
        simulantNearest: 'MGS-1 / JSC-1A Basaltic Regolith Prior',
        voidHint: 'none',
        processes: ['effusive_basalt_volcanism', 'aeolian_saltation'],
        available: true,
      };
    }

    if (/anorthosit|norite|feldspath/i.test(lower)) {
      return {
        lithologyDesc: `Macrostrat v2: ${label}`,
        maficIndex: 0.14,
        silicaWtPct: 50.5,
        tiO2WtPct: 0.3,
        clayIndex: 0.03,
        sulfateIndex: 0.02,
        carbonateIndex: 0.02,
        simulantNearest: 'LHS-1 / NU-LHT-2M Highland Anorthosite Prior',
        voidHint: 'none',
        processes: ['impact_shock_ejecta'],
        available: true,
      };
    }

    if (/limestone|dolomite|carbonate|chalk|marl|karst/i.test(lower)) {
      return {
        lithologyDesc: `Macrostrat v2: ${label} (carbonate bedrock; karst cavity unconfirmed)`,
        maficIndex: 0.12,
        silicaWtPct: 18.0,
        tiO2WtPct: 0.15,
        clayIndex: 0.14,
        sulfateIndex: 0.08,
        carbonateIndex: 0.72,
        simulantNearest: 'Mg/Ca-Carbonate Jezero Margin Prior',
        voidHint: 'none',
        processes: ['pit_collapse_karst'],
        available: true,
      };
    }

    if (/evaporite|gypsum|anhydrite|halite|saline|playa/i.test(lower)) {
      return {
        lithologyDesc: `Macrostrat v2: ${label}`,
        maficIndex: 0.2,
        silicaWtPct: 38.0,
        tiO2WtPct: 0.35,
        clayIndex: 0.18,
        sulfateIndex: 0.68,
        carbonateIndex: 0.18,
        simulantNearest: 'Noachian Sulfate / Evaporite Regolith Prior',
        voidHint: 'none',
        processes: ['evaporite_brine_precipitation', 'aeolian_saltation'],
        available: true,
      };
    }

    if (/shale|mudstone|clay|siltstone|alluvium|fluvial/i.test(lower)) {
      return {
        lithologyDesc: `Macrostrat v2: ${label}`,
        maficIndex: 0.24,
        silicaWtPct: 60.0,
        tiO2WtPct: 0.65,
        clayIndex: 0.44,
        sulfateIndex: 0.12,
        carbonateIndex: 0.12,
        simulantNearest: 'Phyllosilicate Mudstone Analog Prior',
        voidHint: 'none',
        processes: ['fluvial_deltaic_sedimentation'],
        available: true,
      };
    }

    return {
      ...defaultPriors,
      lithologyDesc: `Macrostrat v2: ${label}`,
      available: true,
    };
  } catch {
    return defaultPriors;
  }
}

interface OsmPriors {
  roadDistanceKm: number;
  rfQuietnessScore: number;
  permitTier: PermitTier;
  ndwi: number;
  locationLabel: string | null;
  available: boolean;
}

async function fetchOsmEnrichment(lat: number, lon: number): Promise<OsmPriors> {
  const defaultOsm: OsmPriors = {
    roadDistanceKm: 15.0,
    rfQuietnessScore: 0.85,
    permitTier: Math.abs(lat) > 66 ? 'polar_expedition' : 'open_public',
    ndwi: -0.3,
    locationLabel: null,
    available: false,
  };

  try {
    const query = `
      [out:json][timeout:8];
      (
        way["highway"](around:15000,${lat.toFixed(4)},${lon.toFixed(4)});
        node["place"~"city|town|village"](around:15000,${lat.toFixed(4)},${lon.toFixed(4)});
        nwr["boundary"~"protected_area|national_park"](around:15000,${lat.toFixed(4)},${lon.toFixed(4)});
        nwr["natural"="water"](around:1200,${lat.toFixed(4)},${lon.toFixed(4)});
      );
      out center tags 40;
    `.trim();

    const resp = await fetchWithTimeout('https://overpass-api.de/api/interpreter', 3500, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!resp.ok) return defaultOsm;

    const json = (await resp.json()) as {
      elements?: Array<{
        type: string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };

    const elements = json.elements ?? [];
    let minRoadKm = 15.0;
    let minSettlementKm = 15.0;
    let isProtected = false;
    let hasWater = false;
    let nearestPlaceName: string | null = null;

    for (const el of elements) {
      const tags = el.tags ?? {};
      const eLat = el.lat ?? el.center?.lat;
      const eLon = el.lon ?? el.center?.lon;

      if (tags.highway && eLat !== undefined && eLon !== undefined) {
        const d = haversineKm(lat, lon, eLat, eLon);
        if (d < minRoadKm) minRoadKm = d;
      }
      if (tags.place && eLat !== undefined && eLon !== undefined) {
        const d = haversineKm(lat, lon, eLat, eLon);
        if (d < minSettlementKm) {
          minSettlementKm = d;
          nearestPlaceName = tags.name ?? null;
        }
      }
      if (tags.boundary === 'protected_area' || tags.boundary === 'national_park') {
        isProtected = true;
      }
      if (tags.natural === 'water') {
        hasWater = true;
      }
    }

    const rfQuietnessScore = Number(
      Math.max(0.15, Math.min(0.98, minSettlementKm / 15.0)).toFixed(2)
    );
    const permitTier: PermitTier = isProtected
      ? 'protected_park'
      : Math.abs(lat) > 66
        ? 'polar_expedition'
        : 'open_public';

    return {
      roadDistanceKm: Number(minRoadKm.toFixed(2)),
      rfQuietnessScore,
      permitTier,
      ndwi: hasWater ? 0.15 : -0.32,
      locationLabel: nearestPlaceName,
      available: true,
    };
  } catch {
    return defaultOsm;
  }
}

export async function probeEarthPoint(params: {
  lat: number;
  lon: number;
  featureFootprintKm?: number;
  includeOsm?: boolean;
}): Promise<ProbeEarthPointResponse> {
  const t0 = performance.now();
  await ensureDiskLoaded();

  const lat = Math.max(-89.9, Math.min(89.9, params.lat));
  const lon = ((((params.lon + 180) % 360) + 360) % 360) - 180;
  const footprintKm = Math.max(0.2, Math.min(100, params.featureFootprintKm ?? 5));
  const includeOsm = params.includeOsm ?? true;

  const coordKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const fullKey = `${coordKey}_${footprintKm.toFixed(1)}_osm1`;
  const slimKey = `${coordKey}_${footprintKm.toFixed(1)}_osm0`;
  const cacheKey = includeOsm ? fullKey : slimKey;

  const cached = getCache(fullKey) ?? (!includeOsm ? getCache(slimKey) : null);
  if (cached && (!includeOsm || cached.patch?.osmLive)) {
    return {
      site: cached.site,
      patch: cached.patch,
      latencyMs: Math.round(performance.now() - t0),
      cacheHit: true,
      warnings: cached.warnings,
    };
  }

  // Fast Core (POWER + Terrarium) + Non-Blocking Enrichments in parallel
  const [powerRes, terrariumRes, macroSettled, osmSettled] = await Promise.all([
    fetchNasaPowerCore(lat, lon),
    fetchTerrariumCore(lat, lon, footprintKm),
    Promise.allSettled([fetchMacrostratEnrichment(lat, lon)]).then((r) => r[0]),
    includeOsm
      ? Promise.allSettled([fetchOsmEnrichment(lat, lon)]).then((r) => r[0])
      : Promise.resolve({
          status: 'fulfilled' as const,
          value: {
            roadDistanceKm: 15.0,
            rfQuietnessScore: 0.85,
            permitTier: (Math.abs(lat) > 66 ? 'polar_expedition' : 'open_public') as PermitTier,
            ndwi: -0.3,
            locationLabel: null,
            available: false,
          },
        }),
  ]);

  const warnings: string[] = [];
  if (powerRes.fallbackUsed) {
    warnings.push('NASA POWER timed out — used latitude climatology prior.');
  }
  if (terrariumRes.source === 'open_meteo_fallback') {
    warnings.push(
      Math.abs(lat) > 85.0
        ? 'Polar |lat|>85°: Open-Meteo elevation only (DEM slope unavailable).'
        : 'AWS Terrarium unavailable — fell back to Open-Meteo elevation only.'
    );
  } else if (terrariumRes.source === 'prior_fallback') {
    warnings.push('Elevation tile unavailable — fell back to default terrain prior.');
  }

  const macro: MacrostratPriors =
    macroSettled.status === 'fulfilled'
      ? macroSettled.value
      : await fetchMacrostratEnrichment(lat, lon);
  if (!macro.available) {
    warnings.push('Macrostrat v2 enrichment unavailable/unmapped — using siliciclastic prior.');
  }

  const osm: OsmPriors =
    osmSettled.status === 'fulfilled'
      ? osmSettled.value
      : await fetchOsmEnrichment(lat, lon);
  if (includeOsm && !osm.available) {
    warnings.push('OSM Overpass timed out (>3.5s) — using remote access fallback (15 km).');
  }

  // Always pass voidCode = 0 so surface lithology never auto-fabricates confirmed caves
  const resolvedRegion = resolveEarthRegion(lat, lon, 0);

  const avgGwet =
    powerRes.monthly.reduce((acc, m) => acc + m.gwettop, 0) / powerRes.monthly.length;
  const avgSnow =
    powerRes.monthly.reduce((acc, m) => acc + m.snowDepthCm, 0) / powerRes.monthly.length;
  const avgTemp =
    powerRes.monthly.reduce((acc, m) => acc + m.tMeanK, 0) / powerRes.monthly.length;
  const avgPrecipProb =
    powerRes.monthly.reduce((acc, m) => acc + m.pPrecipGt5Mm, 0) / powerRes.monthly.length;

  const isPermafrost = avgTemp < 268.0 || Math.abs(lat) > 64.0;
  const wehWtPct = Number(
    (isPermafrost ? 6.5 : Math.max(0.2, avgGwet * 5.2)).toFixed(2)
  );
  const slopeForTi = terrariumRes.medianSlopeDeg ?? 5.0;
  const thermalInertia = Math.round(
    180 + Math.min(350, slopeForTi * 14) + avgGwet * 120
  );
  const albedo = powerRes.meanAlbedo ?? (avgSnow > 5 ? 0.58 : 0.24);
  const ndviPrior = avgPrecipProb > 0.08 ? 0.22 : avgGwet > 0.4 ? 0.12 : 0.03;
  const ndsiPrior = avgSnow > 2 ? 0.45 : 0.0;
  const permitScore =
    osm.permitTier === 'open_public'
      ? 0.92
      : osm.permitTier === 'regulated_research'
        ? 0.72
        : osm.permitTier === 'protected_park'
          ? 0.38
          : 0.18;
  const roadPenalty = Math.min(0.25, osm.roadDistanceKm / 80);
  const logisticsFrictionIndex = Number(Math.max(0.1, permitScore - roadPenalty).toFixed(2));

  const provenanceTier: ProvenanceTier =
    powerRes.fallbackUsed || terrariumRes.source === 'prior_fallback' || terrariumRes.elevationOnly
      ? 'tier2_best_effort_fallback'
      : 'tier2_live_probe';

  const siteId = `probe_${lat.toFixed(2)}_${lon.toFixed(2)}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const placeSuffix = osm.locationLabel ? ` (${osm.locationLabel})` : '';
  const effectiveSiteSlope = terrariumRes.medianSlopeDeg ?? 4.5;
  const effectiveSiteP95Slope = terrariumRes.p95SlopeDeg ?? 11.0;

  const lineage: DataLineageItem[] = [
    {
      domain: 'thermal',
      source: powerRes.fallbackUsed
        ? 'Climatology Latitude Prior'
        : 'NASA POWER Climatology API (20-yr)',
      detail: `T_mean=${avgTemp.toFixed(1)} K, RH=${powerRes.meanRhPct}%, ALB=${albedo.toFixed(2)}`,
      resolutionOrPeriod: '0.5° × 0.625° / 20-yr climatology',
    },
    {
      domain: 'morphology',
      source:
        terrariumRes.source === 'terrarium'
          ? `AWS Mapzen Terrarium RGB (3×3 stitched, z=${terrariumRes.zoomUsed})`
          : terrariumRes.source === 'open_meteo_fallback'
            ? 'Open-Meteo Elevation Only (Polar/DEM Fallback)'
            : 'Terrain Slope Prior',
      detail:
        terrariumRes.medianSlopeDeg !== null
          ? `Elev=${terrariumRes.elevationM} m, medSlope=${terrariumRes.medianSlopeDeg}°, p95=${terrariumRes.p95SlopeDeg}°`
          : `Elev=${terrariumRes.elevationM} m (DEM slope unavailable at |lat|>85°; using regional slope prior)`,
      resolutionOrPeriod: `${terrariumRes.dtmResolutionM} m/px`,
    },
    {
      domain: 'atmospheric',
      source: 'NASA POWER PS/WS10M + Shao-Lu (2000)',
      detail: `Wind p50=${powerRes.wind50Ms} m/s, est. p95=${powerRes.wind95Ms} m/s`,
      resolutionOrPeriod: '20-yr climatology',
    },
    {
      domain: 'geochemistry',
      source: macro.available ? 'Macrostrat v2 Geologic Units' : 'Siliciclastic Oxide Prior',
      detail: macro.lithologyDesc,
      resolutionOrPeriod: 'Regional map polygon',
    },
    {
      domain: 'operations',
      source: osm.available ? 'OSM Overpass (15 km) + POWER CLOUD_AMT' : 'Remote Permit Fallback',
      detail: `Nearest road ${osm.roadDistanceKm} km · RF quietness ${osm.rfQuietnessScore} · Permit ${osm.permitTier}`,
      resolutionOrPeriod: '15 km radius',
    },
  ];

  const site: EarthAnalogSite = {
    id: siteId,
    name: `Live Probe ${lat.toFixed(2)}°, ${lon.toFixed(2)}°${placeSuffix}`,
    region: osm.locationLabel ?? resolvedRegion.region,
    country: resolvedRegion.country,
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
    elevationM: terrariumRes.elevationM,
    provenanceTier,
    isClassicRegion: false,
    permitTier: osm.permitTier,
    geology: {
      maficIndex: macro.maficIndex,
      silicaWtPct: macro.silicaWtPct,
      tiO2WtPct: macro.tiO2WtPct,
      clayIndex: macro.clayIndex,
      sulfateIndex: macro.sulfateIndex,
      carbonateIndex: macro.carbonateIndex,
      waterEquivalentHydrogenWtPct: wehWtPct,
      simulantNearest: macro.simulantNearest,
      macrostratLithology: macro.lithologyDesc,
    },
    morphology: {
      medianSlopeDeg: effectiveSiteSlope,
      p95SlopeDeg: effectiveSiteP95Slope,
      dtmResolutionM: terrariumRes.dtmResolutionM,
      rockCfaK: null,
      cohesionKpa: null,
      frictionAngleDeg: null,
      regolithThicknessM: effectiveSiteSlope > 18 ? 0.35 : 1.2,
      iceTableDepthM: isPermafrost ? 0.35 : null,
      sarBackscatterSigma0Db: null,
    },
    thermalStatic: {
      apparentThermalInertia: thermalInertia,
      albedo,
    },
    aeolianStatic: {
      medianGrainDiameterUm: 150,
      particleDensityKgM3: 2650,
    },
    operationsStatic: {
      roadDistanceKm: osm.roadDistanceKm,
      rfQuietnessScore: osm.rfQuietnessScore,
      ndvi: ndviPrior,
      ndwi: osm.ndwi,
      ndsi: ndsiPrior,
      logisticsFrictionIndex,
    },
    monthly: powerRes.monthly,
    voidProfile: {
      voidType: 'none',
      overburdenThicknessM: null,
      voidSpanWidthM: null,
      ceilingHeightM: null,
      skylightAccessSlopeDeg: null,
      subterraneanDeltaTK: null,
    },
    isruProfile: {
      ilmeniteO2YieldPotential: Number(Math.min(0.9, macro.tiO2WtPct / 4.5).toFixed(2)),
      constructionFeedstockSuitability: Number(
        Math.max(0.2, 0.85 - macro.clayIndex * 1.1).toFixed(2)
      ),
      landingPlumeDustHazard: 0.42,
      directToEarthVisibilityPct: 92,
    },
    astrobiology: {
      tocWtPct: avgPrecipProb < 0.03 ? 0.02 : 0.25,
      waterActivityAw: avgGwet > 0.3 ? 0.65 : 0.4,
      surfacePh: macro.carbonateIndex > 0.4 ? 8.1 : 7.0,
      biosignaturePreservationIndex: Number(
        Math.min(0.9, macro.sulfateIndex * 0.6 + macro.carbonateIndex * 0.5 + 0.2).toFixed(2)
      ),
      extremophileGuilds: isPermafrost
        ? ['psychrophile', 'cryptoendolith']
        : macro.sulfateIndex > 0.4
          ? ['halophile', 'cryptoendolith']
          : ['chemoautotroph'],
    },
    activeProcesses: macro.processes,
    relictProcesses: ['aeolian_saltation'],
    earthCoBenefits:
      'Live satellite-to-ground probe supporting local slope hazard mapping, microclimate monitoring, and water/erosion baseline tracking.',
    dataLineage: lineage,
    citations: [
      'NASA POWER 20-yr Climatology API',
      'AWS Mapzen Terrarium Elevation Tiles (3×3 Cross-Tile Stitched)',
      'Macrostrat v2 Geologic API & OpenStreetMap Overpass',
    ],
  };

  const powerLive = !powerRes.fallbackUsed;
  const demLive = terrariumRes.source !== 'prior_fallback';
  const macroLive = macro.available;
  const osmLive = includeOsm && osm.available;

  const verifiedSources: string[] = [];
  if (powerLive) verifiedSources.push('NASA POWER Climatology');
  if (terrariumRes.source === 'terrarium') verifiedSources.push('AWS Terrarium DEM');
  else if (terrariumRes.source === 'open_meteo_fallback') verifiedSources.push('Open-Meteo Elevation Only');
  if (macroLive) verifiedSources.push('Macrostrat v2 Geology');
  if (osmLive) verifiedSources.push('OpenStreetMap Overpass');

  const patch: LiveTelemetryPatch = {
    coordKey,
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
    powerLive,
    demLive,
    demSource: terrariumRes.source,
    macroLive,
    osmLive,
    elevationM: demLive ? terrariumRes.elevationM : null,
    medianSlopeDeg: demLive ? terrariumRes.medianSlopeDeg : null,
    p95SlopeDeg: demLive ? terrariumRes.p95SlopeDeg : null,
    dtmResolutionM: demLive ? terrariumRes.dtmResolutionM : null,
    elevationOnly: terrariumRes.elevationOnly,
    monthly: powerLive ? powerRes.monthly : null,
    meanAlbedo: powerLive ? powerRes.meanAlbedo : null,
    thermalInertia: demLive || powerLive ? thermalInertia : null,
    wind50Ms: powerLive ? powerRes.wind50Ms : null,
    wind95Ms: powerLive ? powerRes.wind95Ms : null,
    geologyPatch: macroLive
      ? {
          maficIndex: macro.maficIndex,
          silicaWtPct: macro.silicaWtPct,
          tiO2WtPct: macro.tiO2WtPct,
          clayIndex: macro.clayIndex,
          sulfateIndex: macro.sulfateIndex,
          carbonateIndex: macro.carbonateIndex,
          simulantNearest: macro.simulantNearest,
          macrostratLithology: macro.lithologyDesc,
        }
      : null,
    voidHint: null,
    roadDistanceKm: osmLive ? osm.roadDistanceKm : null,
    rfQuietnessScore: osmLive ? osm.rfQuietnessScore : null,
    permitTier: osmLive ? osm.permitTier : null,
    verifiedSources,
    warnings,
  };

  setCache({
    key: cacheKey,
    cachedAt: new Date().toISOString(),
    site,
    patch,
    warnings,
  });

  return {
    site,
    patch,
    latencyMs: Math.round(performance.now() - t0),
    cacheHit: false,
    warnings,
  };
}

export async function probeEarthBatch(
  points: Array<{ lat: number; lon: number; featureFootprintKm?: number }>
): Promise<LiveVerificationBatchResponse> {
  if (points.length > MAX_BATCH_POINTS) {
    throw new Error(`Batch size (${points.length}) exceeds maximum of ${MAX_BATCH_POINTS} points.`);
  }
  const t0 = performance.now();
  await ensureDiskLoaded();

  const deduped = new Map<string, { lat: number; lon: number; featureFootprintKm: number }>();
  for (const pt of points) {
    const lat = Math.max(-89.9, Math.min(89.9, pt.lat));
    const lon = ((((pt.lon + 180) % 360) + 360) % 360) - 180;
    const coordKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
    if (!deduped.has(coordKey)) {
      deduped.set(coordKey, {
        lat,
        lon,
        featureFootprintKm: Math.max(0.2, Math.min(100, pt.featureFootprintKm ?? 5)),
      });
    }
  }

  const queue = Array.from(deduped.values());
  const patches: LiveTelemetryPatch[] = new Array(queue.length);
  let cacheHits = 0;
  let cursor = 0;
  const CONCURRENCY = 4;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) break;
      const item = queue[idx];
      try {
        const res = await probeEarthPoint({
          lat: item.lat,
          lon: item.lon,
          featureFootprintKm: item.featureFootprintKm,
          includeOsm: false,
        });
        if (res.cacheHit) cacheHits++;
        if (res.patch) {
          patches[idx] = res.patch;
        }
      } catch {
        // Skip failed point cleanly; grid baseline stays intact
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, Math.max(1, queue.length)) }, () => worker())
  );

  return {
    patches: patches.filter((p): p is LiveTelemetryPatch => Boolean(p)),
    latencyMs: Math.round(performance.now() - t0),
    cacheHits,
  };
}
