import 'dotenv/config';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { designMissionWithGemini } from './missionArchitect.js';
import { MAX_BATCH_POINTS, probeEarthBatch, probeEarthPoint } from './probeService.js';

const app = new Hono();

const ALLOWED_STATIC_ORIGINS = new Set<string>([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
if (process.env.APP_URL) {
  try {
    ALLOWED_STATIC_ORIGINS.add(new URL(process.env.APP_URL).origin);
  } catch {
    // Ignore malformed APP_URL
  }
}

function resolveAllowedOrigin(origin: string | undefined, hostHeader: string | undefined): string {
  if (!origin) return '';
  if (ALLOWED_STATIC_ORIGINS.has(origin)) return origin;
  try {
    const parsed = new URL(origin);
    if (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    ) {
      return origin;
    }
    if (hostHeader && parsed.host === hostHeader) {
      return origin;
    }
  } catch {
    return '';
  }
  return '';
}

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => resolveAllowedOrigin(origin, c.req.header('host')),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 600,
  })
);

// Payload size limit (64 KB) on JSON API endpoints
const MAX_JSON_BYTES = 64 * 1024;
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'POST') {
    const cl = Number(c.req.header('content-length') ?? 0);
    if (Number.isFinite(cl) && cl > MAX_JSON_BYTES) {
      return c.json({ error: 'Request payload exceeds 64 KB limit.' }, 413);
    }
  }
  await next();
});

// Per-IP sliding-window rate limiter on upstream-heavy endpoints
const RATE_BUCKETS = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
function checkRateLimit(ip: string, bucket: string, maxRequests: number): boolean {
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  const prev = (RATE_BUCKETS.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (prev.length >= maxRequests) {
    RATE_BUCKETS.set(key, prev);
    return false;
  }
  prev.push(now);
  RATE_BUCKETS.set(key, prev);
  if (RATE_BUCKETS.size > 2000) {
    const firstKey = RATE_BUCKETS.keys().next().value;
    if (firstKey) RATE_BUCKETS.delete(firstKey);
  }
  return true;
}

function getClientIp(c: import('hono').Context): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return c.req.header('x-real-ip') || 'local';
}

app.use('/api/v1/ai/*', async (c, next) => {
  if (!checkRateLimit(getClientIp(c), 'ai', 20)) {
    return c.json({ error: 'Rate limit exceeded for AI Mission Architect. Please retry shortly.' }, 429);
  }
  await next();
});

app.use('/api/v1/probe/*', async (c, next) => {
  if (!checkRateLimit(getClientIp(c), 'probe', 60)) {
    return c.json({ error: 'Rate limit exceeded for live telemetry probes. Please retry shortly.' }, 429);
  }
  await next();
});

app.use('/api/v1/search/*', async (c, next) => {
  if (!checkRateLimit(getClientIp(c), 'search', 60)) {
    return c.json({ error: 'Rate limit exceeded for global geocoder search. Please retry shortly.' }, 429);
  }
  await next();
});

// Bounded in-memory LRU cache for proxied NASA Trek planetary tiles
const TILE_CACHE = new Map<string, { buf: Buffer; contentType: string }>();
const MAX_TILE_CACHE = 400;

export const TREK_LAYER_ALIASES: Record<string, string> = {
  mola_color: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
  themis_ir: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018',
  lro_wac: 'LRO_WAC_Mosaic_Global_303ppd_v02',
  south_pole: 'WAC_POLE_ILL_PCT_SOUTH_100M',
};

const ALLOWED_TREK_LAYERS_BY_BODY: Record<'Mars' | 'Moon', Set<string>> = {
  Mars: new Set([
    TREK_LAYER_ALIASES.mola_color,
    TREK_LAYER_ALIASES.themis_ir,
  ]),
  Moon: new Set([
    TREK_LAYER_ALIASES.lro_wac,
    TREK_LAYER_ALIASES.south_pole,
  ]),
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

app.get('/api/v1/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'WeywotEngine',
    version: '7.0.0-LEAN-PRODUCTION',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/v1/probe/earth-point', async (c) => {
  try {
    const body = (await c.req.json()) as {
      lat?: unknown;
      lon?: unknown;
      featureFootprintKm?: unknown;
    };
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const featureFootprintKm =
      body.featureFootprintKm !== undefined ? Number(body.featureFootprintKm) : 5;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return c.json({ error: 'Invalid latitude; expected [-90, 90].' }, 400);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return c.json({ error: 'Invalid longitude; expected [-180, 180].' }, 400);
    }

    const result = await probeEarthPoint({
      lat,
      lon,
      featureFootprintKm: Number.isFinite(featureFootprintKm) ? featureFootprintKm : 5,
    });
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Probe service error';
    return c.json({ error: msg }, 500);
  }
});

app.get('/api/v1/probe/earth-point', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lon = Number(c.req.query('lon'));
  const footprintKm = Number(c.req.query('footprintKm') ?? 5);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return c.json({ error: 'Invalid lat query parameter.' }, 400);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return c.json({ error: 'Invalid lon query parameter.' }, 400);
  }

  const result = await probeEarthPoint({
    lat,
    lon,
    featureFootprintKm: Number.isFinite(footprintKm) ? footprintKm : 5,
  });
  return c.json(result);
});

app.post('/api/v1/probe/batch', async (c) => {
  try {
    const body = (await c.req.json()) as {
      points?: unknown;
    };
    if (!Array.isArray(body.points)) {
      return c.json({ error: 'Expected points array in request body.' }, 400);
    }
    if (body.points.length > MAX_BATCH_POINTS) {
      return c.json(
        { error: `Batch size exceeds maximum of ${MAX_BATCH_POINTS} points.` },
        400
      );
    }
    const points = body.points
      .map((p) => {
        const obj = p as { lat?: unknown; lon?: unknown; featureFootprintKm?: unknown };
        const lat = Number(obj?.lat);
        const lon = Number(obj?.lon);
        const featureFootprintKm =
          obj?.featureFootprintKm !== undefined ? Number(obj.featureFootprintKm) : 5;
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
        if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
        return {
          lat,
          lon,
          featureFootprintKm: Number.isFinite(featureFootprintKm) ? featureFootprintKm : 5,
        };
      })
      .filter((x): x is { lat: number; lon: number; featureFootprintKm: number } => x !== null);

    if (points.length === 0) {
      return c.json({ patches: [], latencyMs: 0, cacheHits: 0 });
    }

    const result = await probeEarthBatch(points);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Batch live verification failed.';
    return c.json({ error: msg }, 500);
  }
});

app.post('/api/v1/ai/design-mission', async (c) => {
  try {
    const body = (await c.req.json()) as {
      prompt?: unknown;
      clarificationAnswers?: unknown;
      activeTargets?: unknown;
    };
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return c.json({ error: 'Mission description prompt is required.' }, 400);
    }
    if (prompt.length > 4000) {
      return c.json({ error: 'Mission description prompt exceeds 4000 characters.' }, 400);
    }
    const clarificationAnswers = Array.isArray(body.clarificationAnswers)
      ? body.clarificationAnswers.filter(
          (qa): qa is { question: string; answer: string } =>
            Boolean(qa) &&
            typeof (qa as { question?: unknown }).question === 'string' &&
            typeof (qa as { answer?: unknown }).answer === 'string'
        )
      : [];
    const activeTargets = Array.isArray(body.activeTargets)
      ? (body.activeTargets as import('../src/types/planetary.js').CelestialTarget[])
      : [];

    const design = await designMissionWithGemini({
      prompt,
      clarificationAnswers,
      activeTargets,
    });
    return c.json(design);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI Mission Architect failed.';
    return c.json({ error: msg }, 500);
  }
});

const SEARCH_CACHE = new Map<
  string,
  Array<{
    id: string;
    name: string;
    subtitle: string;
    body: 'earth';
    lat: number;
    lon: number;
    source: 'geocoder';
  }>
>();
const MAX_SEARCH_CACHE = 200;

app.get('/api/v1/search/earth', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2 || q.length > 120) {
    return c.json({ results: [] });
  }

  const cacheKey = q.toLowerCase();
  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached) {
    SEARCH_CACHE.delete(cacheKey);
    SEARCH_CACHE.set(cacheKey, cached);
    return c.json({ results: cached, cacheHit: true });
  }

  type GeoResult = {
    id: string;
    name: string;
    subtitle: string;
    body: 'earth';
    lat: number;
    lon: number;
    source: 'geocoder';
  };
  let results: GeoResult[] = [];

  // 1. Primary: Photon (Komoot OpenStreetMap geocoder, zero API key)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const resp = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`,
        {
          signal: controller.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'WeywotEngine/7.0' },
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as {
          features?: Array<{
            geometry?: { coordinates?: [number, number] };
            properties?: {
              osm_id?: number;
              name?: string;
              state?: string;
              country?: string;
              osm_value?: string;
            };
          }>;
        };
        const features = data.features ?? [];
        results = features
          .filter(
            (f) =>
              Array.isArray(f.geometry?.coordinates) &&
              Number.isFinite(f.geometry!.coordinates![0]) &&
              Number.isFinite(f.geometry!.coordinates![1]) &&
              Boolean(f.properties?.name)
          )
          .map((f, idx) => {
            const [lon, lat] = f.geometry!.coordinates!;
            const props = f.properties!;
            const locParts = [props.state, props.country].filter(Boolean).join(', ');
            return {
              id: `photon:${props.osm_id ?? idx}:${lat.toFixed(3)}:${lon.toFixed(3)}`,
              name: props.name!,
              subtitle: locParts
                ? `${locParts} · ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`
                : `Earth · ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
              body: 'earth' as const,
              lat,
              lon,
              source: 'geocoder' as const,
            };
          });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Fall through to Nominatim
  }

  // 2. Fallback: OSM Nominatim
  if (results.length === 0) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=6`,
          {
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
              'User-Agent': 'WeywotEngine/7.0 (planetary-analog-console)',
            },
          }
        );
        if (resp.ok) {
          const rows = (await resp.json()) as Array<{
            place_id?: number;
            display_name?: string;
            name?: string;
            lat?: string;
            lon?: string;
          }>;
          results = rows
            .map((r, idx) => {
              const lat = Number(r.lat);
              const lon = Number(r.lon);
              if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
              const full = r.display_name ?? r.name ?? q;
              const parts = full.split(',').map((s) => s.trim());
              const name = r.name || parts[0] || q;
              const regionSub = parts.slice(1, 3).join(', ');
              return {
                id: `nom:${r.place_id ?? idx}:${lat.toFixed(3)}:${lon.toFixed(3)}`,
                name,
                subtitle: regionSub
                  ? `${regionSub} · ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`
                  : `Earth · ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
                body: 'earth' as const,
                lat,
                lon,
                source: 'geocoder' as const,
              };
            })
            .filter((x): x is GeoResult => x !== null);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Graceful offline fallback
    }
  }

  if (results.length > 0) {
    SEARCH_CACHE.set(cacheKey, results);
    while (SEARCH_CACHE.size > MAX_SEARCH_CACHE) {
      const oldest = SEARCH_CACHE.keys().next().value;
      if (!oldest) break;
      SEARCH_CACHE.delete(oldest);
    }
  }

  return c.json({ results, cacheHit: false });
});

app.get('/api/v1/tiles/:body/:layer/:z/:y/:x', async (c) => {
  const rawBody = c.req.param('body').toLowerCase();
  const rawLayer = c.req.param('layer');
  const z = c.req.param('z').replace(/[^0-9]/g, '');
  const y = c.req.param('y').replace(/[^0-9]/g, '');
  const xClean = c.req.param('x').replace(/\.(jpg|jpeg|png)$/i, '').replace(/[^0-9]/g, '');

  const body = rawBody === 'mars' ? 'Mars' : rawBody === 'moon' ? 'Moon' : null;
  const layer = TREK_LAYER_ALIASES[rawLayer] ?? rawLayer;

  if (!body || !ALLOWED_TREK_LAYERS_BY_BODY[body].has(layer)) {
    return c.json({ error: 'Unsupported planetary body or tile layer.' }, 400);
  }

  const zNum = Number(z);
  const yNum = Number(y);
  const xNum = Number(xClean);
  if (
    z === '' ||
    y === '' ||
    xClean === '' ||
    !Number.isInteger(zNum) ||
    zNum < 0 ||
    zNum > 12 ||
    !Number.isInteger(yNum) ||
    !Number.isInteger(xNum)
  ) {
    return c.json({ error: 'Invalid planetary tile zoom or grid coordinates.' }, 400);
  }

  const isSouthPole = layer === 'WAC_POLE_ILL_PCT_SOUTH_100M';
  const isPngLayer = isSouthPole || layer === 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018';
  const ext = isPngLayer ? 'png' : 'jpg';
  const proj = isSouthPole ? 'SP' : 'EQ';
  const cacheKey = `${body}/${proj}/${layer}/${z}/${y}/${xClean}.${ext}`;

  const corsOrigin = resolveAllowedOrigin(c.req.header('origin'), c.req.header('host'));
  const tileHeaders: Record<string, string> = {
    'Cache-Control': 'public, max-age=86400',
  };
  if (corsOrigin) {
    tileHeaders['Access-Control-Allow-Origin'] = corsOrigin;
  }

  const cached = TILE_CACHE.get(cacheKey);
  if (cached) {
    TILE_CACHE.delete(cacheKey);
    TILE_CACHE.set(cacheKey, cached);
    return new Response(new Uint8Array(cached.buf), {
      status: 200,
      headers: {
        ...tileHeaders,
        'Content-Type': cached.contentType,
      },
    });
  }

  const upstreamUrl = `https://trek.nasa.gov/tiles/${body}/${proj}/${layer}/1.0.0/default/default028mm/${z}/${y}/${xClean}.${ext}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const upstream = await fetch(upstreamUrl, { signal: controller.signal });
    if (!upstream.ok) {
      return c.json({ error: `Upstream tile ${upstream.status}` }, 502);
    }
    const arr = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || (ext === 'png' ? 'image/png' : 'image/jpeg');

    TILE_CACHE.set(cacheKey, { buf: arr, contentType });
    while (TILE_CACHE.size > MAX_TILE_CACHE) {
      const oldest = TILE_CACHE.keys().next().value;
      if (!oldest) break;
      TILE_CACHE.delete(oldest);
    }

    return new Response(new Uint8Array(arr), {
      status: 200,
      headers: {
        ...tileHeaders,
        'Content-Type': contentType,
      },
    });
  } catch {
    return c.json({ error: 'Tile proxy upstream timeout' }, 504);
  } finally {
    clearTimeout(timer);
  }
});

async function serveStaticDist(urlPath: string): Promise<{ body: Buffer; contentType: string } | null> {
  const distRoot = path.resolve(process.cwd(), 'dist');
  const cleanRel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const candidate = path.resolve(distRoot, cleanRel || 'index.html');
  if (!candidate.startsWith(distRoot)) return null;

  try {
    const info = await stat(candidate);
    if (info.isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      return {
        body: await readFile(candidate),
        contentType: MIME_TYPES[ext] ?? 'application/octet-stream',
      };
    }
  } catch {
    // Fall back to index.html for SPA routes
  }

  try {
    return {
      body: await readFile(path.join(distRoot, 'index.html')),
      contentType: 'text/html; charset=utf-8',
    };
  } catch {
    return null;
  }
}

export async function startServer() {
  const port = Number(process.env.PORT ?? 3000);
  const isProd = process.env.NODE_ENV === 'production';
  const standaloneApi = process.env.STANDALONE_API === '1';
  const honoListener = getRequestListener(app.fetch);

  let viteMiddleware: ((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) | null =
    null;

  if (!isProd && !standaloneApi) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    viteMiddleware = (req, res) => {
      vite.middlewares(req, res, (err: unknown) => {
        if (err) {
          res.statusCode = 500;
          res.end('Vite middleware error');
        }
      });
    };
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      return honoListener(req, res);
    }

    if (viteMiddleware) {
      return viteMiddleware(req, res);
    }

    if (isProd) {
      const asset = await serveStaticDist(url);
      if (asset) {
        res.statusCode = 200;
        res.setHeader('Content-Type', asset.contentType);
        res.end(asset.body);
        return;
      }
    }

    return honoListener(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(
        `WeywotEngine server listening on http://0.0.0.0:${port} (${
          isProd ? 'production' : standaloneApi ? 'standalone-api' : 'dev+vite'
        })`
      );
      resolve();
    });
  });

  return server;
}

const isEntrypoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(path.resolve(process.argv[1])) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  void startServer();
}

export default app;
