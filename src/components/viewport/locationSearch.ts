import type {
  BodyType,
  CelestialTarget,
  EarthAnalogSite,
} from '../../types/planetary.js';
import {
  IAU_SEARCH_FEATURES,
  PLANETARY_GAZETTEER,
} from './planetaryGazetteer.js';

export type SearchResultGroup =
  | 'coordinates'
  | 'mars'
  | 'moon'
  | 'earth';

export interface UnifiedSearchResult {
  id: string;
  group: SearchResultGroup;
  body: BodyType;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  targetId?: string;
  siteId?: string;
  source: 'coordinate' | 'target' | 'gazetteer' | 'catalog' | 'geocoder';
}

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Parses coordinate expressions such as:
 * - "18.38, 77.58"
 * - "-13.9 -59.2"
 * - "18.38N, 77.58E" / "13.9° S, 59.2° W"
 * - "mars: -13.9, -59.2" / "moon -43.3, -11.4" / "earth: 34.0, 35.75"
 */
export function parseCoordinateQuery(
  rawQuery: string,
  activeBody: BodyType
): UnifiedSearchResult[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  let explicitBody: BodyType | null = null;
  let rest = trimmed;

  const prefixMatch = trimmed.match(/^(earth|mars|moon)\s*[:,\s]\s*(.+)$/i);
  if (prefixMatch) {
    explicitBody = prefixMatch[1].toLowerCase() as BodyType;
    rest = prefixMatch[2].trim();
  }

  // Match two numbers with optional degree symbols and optional N/S/E/W hemispheres
  const coordRegex =
    /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i;
  const m = rest.match(coordRegex);
  if (!m) return [];

  let lat = Number(m[1]);
  const latHem = m[2]?.toUpperCase();
  let lon = Number(m[3]);
  const lonHem = m[4]?.toUpperCase();

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (latHem === 'S' && lat > 0) lat = -lat;
  if (latHem === 'N' && lat < 0) lat = Math.abs(lat);
  if (lonHem === 'W' && lon > 0) lon = -lon;
  if (lonHem === 'E' && lon < 0) lon = Math.abs(lon);

  if (lat < -90 || lat > 90 || lon < -360 || lon > 360) return [];
  const normLon = normalizeLon(lon);

  const bodies: BodyType[] = explicitBody
    ? [explicitBody]
    : [activeBody, ...(['earth', 'mars', 'moon'] as BodyType[]).filter((b) => b !== activeBody)];

  return bodies.map((b) => ({
    id: `coord:${b}:${lat.toFixed(3)}:${normLon.toFixed(3)}`,
    group: 'coordinates',
    body: b,
    name: `${lat.toFixed(2)}°, ${normLon.toFixed(2)}° on ${b.toUpperCase()}`,
    subtitle:
      b === 'earth'
        ? 'Jump to Earth coordinate & probe live NASA/DEM'
        : `Inspect ${b.toUpperCase()} coordinate & evaluate analogs`,
    lat,
    lon: normLon,
    source: 'coordinate',
  }));
}

export function searchLocalThreeBodies(
  query: string,
  targets: CelestialTarget[],
  earthSites: EarthAnalogSite[],
  activeBody: BodyType
): UnifiedSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const coords = parseCoordinateQuery(query, activeBody);
  const results: UnifiedSearchResult[] = [...coords];
  const seenKeys = new Set<string>();

  const pushUnique = (item: UnifiedSearchResult, key: string) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push(item);
  };

  // 1. Literature & custom Mars/Moon targets
  for (const t of targets) {
    if (
      t.name.toLowerCase().includes(q) ||
      t.missionArchetype.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    ) {
      pushUnique(
        {
          id: `tgt:${t.id}`,
          group: t.body,
          body: t.body,
          name: t.name,
          subtitle: `${t.body.toUpperCase()} Target · ${t.lat.toFixed(2)}°, ${t.lon.toFixed(2)}°`,
          lat: t.lat,
          lon: t.lon,
          targetId: t.id,
          source: 'target',
        },
        `${t.body}:${t.name.toLowerCase()}`
      );
    }
  }

  // 2. Expanded IAU Mars & Moon features
  for (const f of IAU_SEARCH_FEATURES) {
    if (f.name.toLowerCase().includes(q) || f.subtitle.toLowerCase().includes(q)) {
      pushUnique(
        {
          id: `iau:${f.id}`,
          group: f.body,
          body: f.body,
          name: f.name,
          subtitle: `${f.subtitle} · ${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°`,
          lat: f.lat,
          lon: f.lon,
          source: 'gazetteer',
        },
        `${f.body}:${f.name.toLowerCase()}`
      );
    }
  }

  // 3. Earth analog sites (catalog + probed)
  for (const s of earthSites) {
    const cleanName = s.name.replace(/\s*\(Visual Anti-Analog\)/i, '');
    if (
      cleanName.toLowerCase().includes(q) ||
      s.region.toLowerCase().includes(q) ||
      s.country.toLowerCase().includes(q)
    ) {
      pushUnique(
        {
          id: `site:${s.id}`,
          group: 'earth',
          body: 'earth',
          name: cleanName,
          subtitle: `${s.region}, ${s.country} · Earth Analog Site`,
          lat: s.lat,
          lon: s.lon,
          siteId: s.id,
          source: 'catalog',
        },
        `earth:${cleanName.toLowerCase()}`
      );
    }
  }

  // 4. Local Earth gazetteer places
  for (const g of PLANETARY_GAZETTEER) {
    if (g.body !== 'earth') continue;
    if (g.name.toLowerCase().includes(q)) {
      pushUnique(
        {
          id: `egaz:${g.id}`,
          group: 'earth',
          body: 'earth',
          name: g.name,
          subtitle: `Earth ${g.kind === 'city' ? 'Place' : 'Region'} · ${g.lat.toFixed(2)}°, ${g.lon.toFixed(2)}°`,
          lat: g.lat,
          lon: g.lon,
          source: 'gazetteer',
        },
        `earth:${g.name.toLowerCase()}`
      );
    }
  }

  return results;
}
