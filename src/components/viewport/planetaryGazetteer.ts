import type { BodyType, CelestialBody } from '../../types/planetary.js';

export interface GazetteerLabel {
  id: string;
  body: BodyType;
  name: string;
  lat: number;
  lon: number;
  tier: 1 | 2; // 1 = major/global landform, 2 = regional landmark/crater/city
  kind: 'landform' | 'region' | 'city';
}

export interface SearchablePlanetaryFeature {
  id: string;
  body: CelestialBody;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
}

export const PLANETARY_GAZETTEER: GazetteerLabel[] = [
  // EARTH — Tier 1 (Continents, Major Deserts, Basins & Tectonic Belts)
  { id: 'e_atacama', body: 'earth', name: 'Atacama Desert', lat: -23.8, lon: -69.5, tier: 1, kind: 'region' },
  { id: 'e_sahara', body: 'earth', name: 'Sahara', lat: 23.4, lon: 11.5, tier: 1, kind: 'region' },
  { id: 'e_arabia', body: 'earth', name: 'Arabian Peninsula', lat: 23.8, lon: 45.1, tier: 1, kind: 'region' },
  { id: 'e_antarctica', body: 'earth', name: 'Antarctica', lat: -80.5, lon: 25.0, tier: 1, kind: 'region' },
  { id: 'e_iceland', body: 'earth', name: 'Iceland Volcanic Zone', lat: 64.9, lon: -18.5, tier: 1, kind: 'region' },
  { id: 'e_colorado', body: 'earth', name: 'Colorado Plateau', lat: 36.8, lon: -110.2, tier: 1, kind: 'region' },
  { id: 'e_pilbara', body: 'earth', name: 'Pilbara Craton', lat: -21.8, lon: 118.5, tier: 1, kind: 'region' },
  { id: 'e_andes', body: 'earth', name: 'Central Andes', lat: -19.5, lon: -67.8, tier: 1, kind: 'landform' },
  { id: 'e_med', body: 'earth', name: 'Mediterranean Basin', lat: 35.2, lon: 18.0, tier: 1, kind: 'region' },
  { id: 'e_canada_arctic', body: 'earth', name: 'Canadian High Arctic', lat: 75.5, lon: -88.0, tier: 1, kind: 'region' },
  { id: 'e_hawaii', body: 'earth', name: 'Hawaiian Hotspot', lat: 19.8, lon: -155.5, tier: 1, kind: 'landform' },
  { id: 'e_anatolia', body: 'earth', name: 'Anatolian Plateau', lat: 38.6, lon: 33.4, tier: 1, kind: 'region' },
  { id: 'e_tibetan', body: 'earth', name: 'Tibetan Plateau', lat: 32.5, lon: 88.0, tier: 1, kind: 'region' },
  { id: 'e_namib', body: 'earth', name: 'Namib Desert', lat: -24.5, lon: 15.3, tier: 1, kind: 'region' },

  // EARTH — Tier 2 (Regional Cities, Landmarks & Analog Context)
  { id: 'e_antofagasta', body: 'earth', name: 'Antofagasta', lat: -23.65, lon: -70.4, tier: 2, kind: 'city' },
  { id: 'e_beirut', body: 'earth', name: 'Beirut / Mount Lebanon', lat: 34.0, lon: 35.75, tier: 2, kind: 'city' },
  { id: 'e_reykjavik', body: 'earth', name: 'Reykjavik', lat: 64.14, lon: -21.94, tier: 2, kind: 'city' },
  { id: 'e_seville', body: 'earth', name: 'Seville / Andalucia', lat: 37.39, lon: -5.98, tier: 2, kind: 'city' },
  { id: 'e_flagstaff', body: 'earth', name: 'Flagstaff / San Francisco Field', lat: 35.2, lon: -111.65, tier: 2, kind: 'city' },
  { id: 'e_hilo', body: 'earth', name: 'Hilo', lat: 19.72, lon: -155.08, tier: 2, kind: 'city' },
  { id: 'e_saltlake', body: 'earth', name: 'Great Salt Lake Basin', lat: 40.95, lon: -113.2, tier: 2, kind: 'landform' },
  { id: 'e_antalya', body: 'earth', name: 'Antalya / Taurus Karst', lat: 37.2, lon: 30.1, tier: 2, kind: 'city' },
  { id: 'e_mcmurdo', body: 'earth', name: 'McMurdo Dry Valleys', lat: -77.6, lon: 162.5, tier: 2, kind: 'landform' },
  { id: 'e_erfoud', body: 'earth', name: 'Erfoud / Tafilalt', lat: 31.43, lon: -4.23, tier: 2, kind: 'city' },
  { id: 'e_cairns', body: 'earth', name: 'Undara Volcanic Province', lat: -18.2, lon: 144.6, tier: 2, kind: 'landform' },
  { id: 'e_sudbury', body: 'earth', name: 'Kapuskasing / Shawmere', lat: 48.2, lon: -82.5, tier: 2, kind: 'landform' },

  // MARS — IAU Gazetteer Tier 1 (Major Shield Volcanoes, Canyons, Basins)
  { id: 'm_olympus', body: 'mars', name: 'Olympus Mons', lat: 18.65, lon: -133.8, tier: 1, kind: 'landform' },
  { id: 'm_valles', body: 'mars', name: 'Valles Marineris', lat: -13.9, lon: -59.2, tier: 1, kind: 'landform' },
  { id: 'm_tharsis', body: 'mars', name: 'Tharsis Bulge', lat: 2.0, lon: -112.0, tier: 1, kind: 'region' },
  { id: 'm_hellas', body: 'mars', name: 'Hellas Planitia', lat: -42.4, lon: 70.5, tier: 1, kind: 'landform' },
  { id: 'm_utopia', body: 'mars', name: 'Utopia Planitia', lat: 46.7, lon: 117.5, tier: 1, kind: 'region' },
  { id: 'm_syrtis', body: 'mars', name: 'Syrtis Major Planum', lat: 8.4, lon: 69.5, tier: 1, kind: 'region' },
  { id: 'm_elysium', body: 'mars', name: 'Elysium Mons', lat: 25.0, lon: 147.2, tier: 1, kind: 'landform' },
  { id: 'm_acidalia', body: 'mars', name: 'Acidalia Planitia', lat: 49.8, lon: -20.7, tier: 1, kind: 'region' },
  { id: 'm_noachis', body: 'mars', name: 'Noachis Terra', lat: -45.0, lon: -10.0, tier: 1, kind: 'region' },
  { id: 'm_arcadia', body: 'mars', name: 'Arcadia Planitia', lat: 46.7, lon: -172.0, tier: 1, kind: 'region' },
  { id: 'm_boreum', body: 'mars', name: 'Planum Boreum', lat: 86.0, lon: 15.0, tier: 1, kind: 'region' },
  { id: 'm_australe', body: 'mars', name: 'Planum Australe', lat: -84.0, lon: -15.0, tier: 1, kind: 'region' },

  // MARS — IAU Gazetteer Tier 2 (Craters, Valles, Landing Regions)
  { id: 'm_isidis', body: 'mars', name: 'Isidis Planitia', lat: 12.9, lon: 87.0, tier: 2, kind: 'landform' },
  { id: 'm_chryse', body: 'mars', name: 'Chryse Planitia', lat: 28.4, lon: -40.0, tier: 2, kind: 'region' },
  { id: 'm_kasei', body: 'mars', name: 'Kasei Valles', lat: 21.9, lon: -67.5, tier: 2, kind: 'landform' },
  { id: 'm_mawrth', body: 'mars', name: 'Mawrth Vallis', lat: 22.3, lon: -16.5, tier: 2, kind: 'landform' },
  { id: 'm_arsia', body: 'mars', name: 'Arsia Mons Caldera', lat: -8.35, lon: -120.1, tier: 2, kind: 'landform' },
  { id: 'm_pavonis', body: 'mars', name: 'Pavonis Mons', lat: 1.48, lon: -112.96, tier: 2, kind: 'landform' },
  { id: 'm_ascraeus', body: 'mars', name: 'Ascraeus Mons', lat: 11.9, lon: -104.1, tier: 2, kind: 'landform' },
  { id: 'm_alba', body: 'mars', name: 'Alba Mons', lat: 40.5, lon: -109.6, tier: 2, kind: 'landform' },
  { id: 'm_argyre', body: 'mars', name: 'Argyre Planitia', lat: -49.7, lon: -43.0, tier: 2, kind: 'landform' },
  { id: 'm_cerberus', body: 'mars', name: 'Cerberus Fossae', lat: 11.3, lon: 166.4, tier: 2, kind: 'landform' },

  // MOON — IAU Gazetteer Tier 1 (Maria & Major Basins)
  { id: 'l_tranq', body: 'moon', name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, tier: 1, kind: 'region' },
  { id: 'l_procellarum', body: 'moon', name: 'Oceanus Procellarum', lat: 18.4, lon: -57.4, tier: 1, kind: 'region' },
  { id: 'l_imbrium', body: 'moon', name: 'Mare Imbrium', lat: 32.8, lon: -15.6, tier: 1, kind: 'region' },
  { id: 'l_serenitatis', body: 'moon', name: 'Mare Serenitatis', lat: 28.0, lon: 17.5, tier: 1, kind: 'region' },
  { id: 'l_crisium', body: 'moon', name: 'Mare Crisium', lat: 17.0, lon: 59.1, tier: 1, kind: 'region' },
  { id: 'l_spa', body: 'moon', name: 'South Pole–Aitken Basin', lat: -53.0, lon: -169.0, tier: 1, kind: 'landform' },
  { id: 'l_orientale', body: 'moon', name: 'Mare Orientale', lat: -19.4, lon: -92.8, tier: 1, kind: 'landform' },
  { id: 'l_tycho', body: 'moon', name: 'Tycho Crater', lat: -43.3, lon: -11.4, tier: 1, kind: 'landform' },
  { id: 'l_copernicus', body: 'moon', name: 'Copernicus Crater', lat: 9.6, lon: -20.1, tier: 1, kind: 'landform' },
  { id: 'l_south_pole', body: 'moon', name: 'Lunar South Pole', lat: -88.5, lon: 0.0, tier: 1, kind: 'region' },

  // MOON — IAU Gazetteer Tier 2 (Craters, Montes, Landing Sites)
  { id: 'l_apennines', body: 'moon', name: 'Montes Apenninus', lat: 18.9, lon: -3.7, tier: 2, kind: 'landform' },
  { id: 'l_plato', body: 'moon', name: 'Plato Crater', lat: 51.6, lon: -9.3, tier: 2, kind: 'landform' },
  { id: 'l_clavius', body: 'moon', name: 'Clavius Crater', lat: -58.4, lon: -14.4, tier: 2, kind: 'landform' },
  { id: 'l_kepler', body: 'moon', name: 'Kepler Crater', lat: 8.1, lon: -38.0, tier: 2, kind: 'landform' },
  { id: 'l_fecunditatis', body: 'moon', name: 'Mare Fecunditatis', lat: -7.8, lon: 51.3, tier: 2, kind: 'region' },
  { id: 'l_nectaris', body: 'moon', name: 'Mare Nectaris', lat: -15.2, lon: 35.5, tier: 2, kind: 'region' },
  { id: 'l_apollo11', body: 'moon', name: 'Statio Tranquillitatis (A11)', lat: 0.67, lon: 23.47, tier: 2, kind: 'landform' },
  { id: 'l_cabeus', body: 'moon', name: 'Cabeus Crater', lat: -84.9, lon: -35.5, tier: 2, kind: 'landform' },
  { id: 'l_schroter', body: 'moon', name: 'Vallis Schröteri', lat: 26.2, lon: -50.8, tier: 2, kind: 'landform' },
];

// Expanded searchable IAU Mars & Moon features (craters, canyons, landing sites, domes)
export const IAU_SEARCH_FEATURES: SearchablePlanetaryFeature[] = [
  ...PLANETARY_GAZETTEER.filter(
    (g): g is GazetteerLabel & { body: CelestialBody } => g.body === 'mars' || g.body === 'moon'
  ).map((g) => ({
    id: g.id,
    body: g.body,
    name: g.name,
    subtitle: `${g.body === 'mars' ? 'Mars' : 'Moon'} IAU ${g.kind === 'region' ? 'Region' : 'Landform'}`,
    lat: g.lat,
    lon: g.lon,
  })),
  // Additional iconic Mars features
  { id: 'm_gusev', body: 'mars', name: 'Gusev Crater (Spirit)', subtitle: 'Mars Impact Crater & Columbia Hills', lat: -14.57, lon: 175.47 },
  { id: 'm_meridiani', body: 'mars', name: 'Meridiani Planum (Opportunity)', subtitle: 'Mars Hematite Plain', lat: -1.95, lon: 354.47 - 360 },
  { id: 'm_eberswalde', body: 'mars', name: 'Eberswalde Crater Delta', subtitle: 'Mars Paleolake Delta', lat: -23.86, lon: -33.3 },
  { id: 'm_holden', body: 'mars', name: 'Holden Crater', subtitle: 'Mars Noachian Paleolake', lat: -26.04, lon: -34.02 },
  { id: 'm_korolev', body: 'mars', name: 'Korolev Crater', subtitle: 'Mars North Polar Ice Crater', lat: 72.77, lon: 164.58 },
  { id: 'm_hale', body: 'mars', name: 'Hale Crater', subtitle: 'Mars RSL & Impact Melt Basin', lat: -35.7, lon: -36.5 },
  { id: 'm_antoniadi', body: 'mars', name: 'Antoniadi Crater', subtitle: 'Mars Syrtis Phyllosilicate Basin', lat: 21.5, lon: 60.8 },
  { id: 'm_coprates', body: 'mars', name: 'Coprates Chasma', subtitle: 'Mars Valles Marineris Trough', lat: -13.4, lon: -61.4 },
  { id: 'm_candor', body: 'mars', name: 'Candor Chasma', subtitle: 'Mars Layered Sulfate Canyon', lat: -6.5, lon: -70.9 },
  { id: 'm_ares', body: 'mars', name: 'Ares Vallis (Pathfinder)', subtitle: 'Mars Outflow Channel', lat: 19.33, lon: -33.55 },
  { id: 'm_phoenix', body: 'mars', name: 'Vastitas Borealis (Phoenix)', subtitle: 'Mars Subarctic Permafrost Plain', lat: 68.22, lon: -125.75 },
  { id: 'm_insight', body: 'mars', name: 'Elysium Planitia (InSight)', subtitle: 'Mars Equatorial Volcanic Plain', lat: 4.5, lon: 135.62 },
  // Additional iconic Moon features
  { id: 'l_malapert', body: 'moon', name: 'Malapert Massif', subtitle: 'Moon Artemis III Candidate Ridge', lat: -86.0, lon: -2.0 },
  { id: 'l_de_gerlache', body: 'moon', name: 'de Gerlache Rim', subtitle: 'Moon South Polar Illuminated Rim', lat: -88.5, lon: -87.1 },
  { id: 'l_nobile', body: 'moon', name: 'Nobile Crater Rim', subtitle: 'Moon VIPER / South Polar Region', lat: -85.2, lon: 53.5 },
  { id: 'l_faustini', body: 'moon', name: 'Faustini Crater PSR', subtitle: 'Moon Permanently Shadowed Crater', lat: -87.18, lon: 84.3 },
  { id: 'l_haworth', body: 'moon', name: 'Haworth Crater PSR', subtitle: 'Moon South Polar Cold Trap', lat: -87.45, lon: -5.17 },
  { id: 'l_shoemaker', body: 'moon', name: 'Shoemaker Crater PSR', subtitle: 'Moon LCROSS Polar Basin', lat: -88.1, lon: 44.9 },
  { id: 'l_schrodinger', body: 'moon', name: 'Schrödinger Basin', subtitle: 'Moon Far-Side Peak-Ring Basin', lat: -75.0, lon: 132.4 },
  { id: 'l_von_karman', body: 'moon', name: 'Von Kármán Crater (CE-4)', subtitle: 'Moon SPA Basin Landing Site', lat: -44.45, lon: 176.2 },
  { id: 'l_reiner_gamma', body: 'moon', name: 'Reiner Gamma Swirl', subtitle: 'Moon Magnetic Anomaly Swirl', lat: 7.5, lon: -59.0 },
  { id: 'l_taurus_littrow', body: 'moon', name: 'Taurus–Littrow (Apollo 17)', subtitle: 'Moon Highland-Mare Valley', lat: 20.19, lon: 30.77 },
  { id: 'l_hadley', body: 'moon', name: 'Hadley Rille (Apollo 15)', subtitle: 'Moon Sinuous Volcanic Channel', lat: 26.13, lon: 3.63 },
  { id: 'l_alphonsus', body: 'moon', name: 'Alphonsus Crater', subtitle: 'Moon Dark-Halo Pyroclastic Vent', lat: -13.4, lon: -2.8 },
  { id: 'l_aristillus', body: 'moon', name: 'Aristillus Crater', subtitle: 'Moon Imbrium Impact Crater', lat: 33.9, lon: 1.2 },
  { id: 'l_grimaldi', body: 'moon', name: 'Grimaldi Basin', subtitle: 'Moon Western Limb Mascon Basin', lat: -5.5, lon: -68.3 },
];

export function findNearestGazetteerFeature(
  body: BodyType,
  lat: number,
  lon: number,
  maxDistDeg = 3.2
): { name: string; distDeg: number } | null {
  const pool =
    body === 'earth'
      ? PLANETARY_GAZETTEER.filter((g) => g.body === 'earth')
      : IAU_SEARCH_FEATURES.filter((f) => f.body === body);

  let best: { name: string; distDeg: number } | null = null;
  for (const item of pool) {
    const dLat = item.lat - lat;
    let dLon = Math.abs(item.lon - lon);
    if (dLon > 180) dLon = 360 - dLon;
    const dist = Math.hypot(dLat, dLon * Math.cos((lat * Math.PI) / 180));
    if (dist <= maxDistDeg && (!best || dist < best.distDeg)) {
      best = { name: item.name, distDeg: dist };
    }
  }
  return best;
}
