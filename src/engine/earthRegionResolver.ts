import type { PermitTier } from '../types/planetary.js';

export interface ResolvedEarthRegion {
  name: string;
  region: string;
  country: string;
  permitTier: PermitTier;
  roadDistanceKm: number;
  rfQuietnessScore: number;
  lithologyNote: string;
}

interface PhysiographicBox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  name: string;
  region: string;
  country: string;
  permitTier?: PermitTier;
  roadDistanceKm?: number;
  rfQuietness?: number;
  lithologyNote?: string;
}

const PHYSIOGRAPHIC_PROVINCES: PhysiographicBox[] = [
  // South America
  { latMin: -27.5, latMax: -17.5, lonMin: -71.0, lonMax: -66.0, name: 'Atacama / Puna Altiplano', region: 'Central Andes', country: 'Chile / Argentina', permitTier: 'regulated_research', roadDistanceKm: 14, rfQuietness: 0.90, lithologyNote: 'Andean evaporite salars & volcanic ignimbrites' },
  { latMin: -52.0, latMax: -39.0, lonMin: -74.0, lonMax: -65.0, name: 'Patagonian Steppe', region: 'Southern Patagonia', country: 'Argentina / Chile', permitTier: 'open_public', roadDistanceKm: 22, rfQuietness: 0.92, lithologyNote: 'Basaltic plateaus & glaciofluvial gravels' },
  { latMin: -22.0, latMax: -13.0, lonMin: -69.5, lonMax: -64.5, name: 'Uyuni / Bolivian Altiplano', region: 'Altiplano Basin', country: 'Bolivia', permitTier: 'open_public', roadDistanceKm: 18, rfQuietness: 0.89, lithologyNote: 'Evaporite salt crusts & volcanic tuffs' },
  { latMin: -17.5, latMax: -4.0, lonMin: -78.0, lonMax: -69.0, name: 'Peruvian Andes / Coastal Desert', region: 'Western Cordillera', country: 'Peru', permitTier: 'open_public', roadDistanceKm: 15, rfQuietness: 0.85 },

  // North America
  { latMin: 32.0, latMax: 37.5, lonMin: -118.5, lonMax: -113.5, name: 'Mojave / Great Basin Sector', region: 'Basin and Range', country: 'United States', permitTier: 'open_public', roadDistanceKm: 9, rfQuietness: 0.86, lithologyNote: 'Alluvial fans, playas & Cenozoic basalts' },
  { latMin: 37.5, latMax: 42.5, lonMin: -115.5, lonMax: -109.0, name: 'Colorado Plateau / Bonneville', region: 'Intermountain West', country: 'United States', permitTier: 'open_public', roadDistanceKm: 11, rfQuietness: 0.88, lithologyNote: 'Mesozoic sandstones, evaporites & basalts' },
  { latMin: 42.5, latMax: 45.0, lonMin: -122.5, lonMax: -112.0, name: 'Snake River / Modoc Volcanic Plain', region: 'Columbia-Snake Province', country: 'United States', permitTier: 'open_public', roadDistanceKm: 12, rfQuietness: 0.88, lithologyNote: 'Quaternary flood basalts & lava tubes' },
  { latMin: 34.0, latMax: 36.2, lonMin: -112.2, lonMax: -106.5, name: 'San Francisco / El Malpais Field', region: 'Colorado Plateau Margin', country: 'United States', permitTier: 'open_public', roadDistanceKm: 10, rfQuietness: 0.87, lithologyNote: 'Cinder cones, basaltic flows & lava caves' },
  { latMin: 73.0, latMax: 83.0, lonMin: -105.0, lonMax: -62.0, name: 'Canadian High Arctic Archipelago', region: 'Nunavut', country: 'Canada', permitTier: 'polar_expedition', roadDistanceKm: 180, rfQuietness: 0.99, lithologyNote: 'Polar permafrost, impact breccias & dolostones' },
  { latMin: 46.0, latMax: 52.0, lonMin: -85.0, lonMax: -78.0, name: 'Canadian Shield Anorthosite Belt', region: 'Superior Province', country: 'Canada', permitTier: 'open_public', roadDistanceKm: 18, rfQuietness: 0.89, lithologyNote: 'Archean anorthosite & gabbroic plutons' },
  { latMin: 24.0, latMax: 32.0, lonMin: -115.0, lonMax: -103.0, name: 'Sonoran / Chihuahuan Desert', region: 'Northern Mexico', country: 'Mexico', permitTier: 'open_public', roadDistanceKm: 14, rfQuietness: 0.86 },
  { latMin: 18.5, latMax: 22.0, lonMin: -91.0, lonMax: -86.5, name: 'Yucatan Karst Platform', region: 'Yucatan Peninsula', country: 'Mexico', permitTier: 'regulated_research', roadDistanceKm: 12, rfQuietness: 0.78, lithologyNote: 'Carbonate cenotes & dissolution cave networks' },

  // Europe & North Atlantic
  { latMin: 63.2, latMax: 66.8, lonMin: -25.0, lonMax: -13.0, name: 'Icelandic Volcanic Rift', region: 'North Atlantic Rift', country: 'Iceland', permitTier: 'regulated_research', roadDistanceKm: 16, rfQuietness: 0.93, lithologyNote: 'Holocene tholeiitic basalts, palagonite & lava tubes' },
  { latMin: 27.5, latMax: 29.6, lonMin: -18.3, lonMax: -13.3, name: 'Canary Volcanic Archipelago', region: 'Macaronesia', country: 'Spain', permitTier: 'regulated_research', roadDistanceKm: 6, rfQuietness: 0.80, lithologyNote: 'Oceanic alkali basalts & volcanic tubes' },
  { latMin: 36.5, latMax: 39.5, lonMin: -8.0, lonMax: -1.5, name: 'Iberian Pyrite / Betic Arid Belt', region: 'Southern Iberia', country: 'Spain / Portugal', permitTier: 'regulated_research', roadDistanceKm: 7, rfQuietness: 0.76 },
  { latMin: 42.5, latMax: 46.5, lonMin: 13.0, lonMax: 20.0, name: 'Dinaric Karst Escarpment', region: 'Western Balkans', country: 'Slovenia / Croatia / Bosnia', permitTier: 'regulated_research', roadDistanceKm: 8, rfQuietness: 0.79, lithologyNote: 'Deep carbonate karst caverns & dolines' },
  { latMin: 76.0, latMax: 81.0, lonMin: 10.0, lonMax: 34.0, name: 'Svalbard High Arctic Plateau', region: 'Svalbard', country: 'Norway', permitTier: 'polar_expedition', roadDistanceKm: 45, rfQuietness: 0.97, lithologyNote: 'Cryogenic permafrost & glacial-basaltic ridges' },

  // Middle East & North Africa
  { latMin: 18.0, latMax: 32.0, lonMin: -16.0, lonMax: 12.0, name: 'Western Sahara / Erg Basin', region: 'Sahara Desert', country: 'Morocco / Mauritania / Algeria', permitTier: 'open_public', roadDistanceKm: 45, rfQuietness: 0.96, lithologyNote: 'Aeolian erg sand seas, hammadas & regolith' },
  { latMin: 16.0, latMax: 30.0, lonMin: 12.0, lonMax: 34.0, name: 'Eastern Sahara / Tibesti-Libyan Basin', region: 'Central Sahara', country: 'Libya / Chad / Egypt', permitTier: 'open_public', roadDistanceKm: 65, rfQuietness: 0.97, lithologyNote: 'Hyper-arid silicate plains & volcanic massifs' },
  { latMin: 21.5, latMax: 27.5, lonMin: 37.5, lonMax: 43.0, name: 'Harrat Volcanic Field', region: 'Hejaz / Western Arabia', country: 'Saudi Arabia', permitTier: 'open_public', roadDistanceKm: 28, rfQuietness: 0.94, lithologyNote: 'Cenozoic basalt lava flows & extensive lava tubes' },
  { latMin: 17.0, latMax: 24.5, lonMin: 43.0, lonMax: 59.8, name: 'Rub al-Khali / Al Hajar Sector', region: 'Arabian Peninsula', country: 'Saudi Arabia / Oman', permitTier: 'open_public', roadDistanceKm: 38, rfQuietness: 0.95, lithologyNote: 'Hyper-arid dunes, ophiolite mafic ridges & karst' },
  { latMin: 29.0, latMax: 35.0, lonMin: 34.0, lonMax: 40.0, name: 'Levantine / Syrian Steppe & Karst', region: 'Levant', country: 'Jordan / Lebanon / Syria', permitTier: 'open_public', roadDistanceKm: 12, rfQuietness: 0.84 },
  { latMin: 36.2, latMax: 40.5, lonMin: 28.0, lonMax: 44.0, name: 'Anatolian Volcanic & Evaporite Plateau', region: 'Anatolia', country: 'Turkey', permitTier: 'regulated_research', roadDistanceKm: 10, rfQuietness: 0.82 },
  { latMin: 27.0, latMax: 36.0, lonMin: 46.0, lonMax: 61.0, name: 'Lut / Dasht-e Kavir Plateau', region: 'Iranian Plateau', country: 'Iran', permitTier: 'open_public', roadDistanceKm: 32, rfQuietness: 0.94, lithologyNote: 'Hyper-arid salt playas, yardangs & Zagros karst' },

  // Sub-Saharan Africa
  { latMin: 11.0, latMax: 16.0, lonMin: 38.0, lonMax: 44.0, name: 'Afar / Danakil Rift Depression', region: 'East African Rift', country: 'Ethiopia / Djibouti', permitTier: 'regulated_research', roadDistanceKm: 26, rfQuietness: 0.92, lithologyNote: 'Active rift basalts, evaporites & hydrothermal brines' },
  { latMin: -4.0, latMax: 11.0, lonMin: 34.0, lonMax: 43.0, name: 'East African Rift Basalt Belt', region: 'Gregory / Ethiopian Rift', country: 'Kenya / Ethiopia', permitTier: 'open_public', roadDistanceKm: 20, rfQuietness: 0.89, lithologyNote: 'Flood basalts, caldera scarps & lava tubes' },
  { latMin: -28.0, latMax: -17.0, lonMin: 11.5, lonMax: 21.0, name: 'Namib / Kaokoveld Escarpment', region: 'Namib Desert', country: 'Namibia', permitTier: 'protected_park', roadDistanceKm: 30, rfQuietness: 0.95, lithologyNote: 'Hyper-arid coastal sand sea, gravel plains & basalts' },
  { latMin: -20.5, latMax: -16.5, lonMin: 43.5, lonMax: 46.5, name: 'Tsingy Carbonate Plateau', region: 'Western Madagascar', country: 'Madagascar', permitTier: 'protected_park', roadDistanceKm: 35, rfQuietness: 0.92 },

  // Central, East & South Asia
  { latMin: 36.0, latMax: 44.0, lonMin: 75.0, lonMax: 99.0, name: 'Tarim / Qaidam / Gobi West Basin', region: 'Central Asian Arid Belt', country: 'China', permitTier: 'open_public', roadDistanceKm: 42, rfQuietness: 0.95, lithologyNote: 'High-altitude evaporite playas, yardangs & gravel fans' },
  { latMin: 40.0, latMax: 47.0, lonMin: 99.0, lonMax: 115.0, name: 'Gobi Steppe & Volcanic Plateau', region: 'Mongolian Plateau', country: 'Mongolia / China', permitTier: 'open_public', roadDistanceKm: 48, rfQuietness: 0.96, lithologyNote: 'Cold arid Gobi regolith & basalt mesas' },
  { latMin: 29.0, latMax: 36.5, lonMin: 77.0, lonMax: 99.0, name: 'Tibetan / Ladakh High Plateau', region: 'Trans-Himalaya', country: 'China / India', permitTier: 'regulated_research', roadDistanceKm: 36, rfQuietness: 0.95, lithologyNote: 'Cold high-UV alpine permafrost & salars' },
  { latMin: 24.0, latMax: 30.0, lonMin: 66.0, lonMax: 74.0, name: 'Thar / Balochistan Arid Zone', region: 'Indus-Makran', country: 'Pakistan / India', permitTier: 'open_public', roadDistanceKm: 20, rfQuietness: 0.86 },
  { latMin: 22.0, latMax: 27.5, lonMin: 102.0, lonMax: 112.5, name: 'South China Karst Belt', region: 'Yunnan-Guizhou', country: 'China', permitTier: 'regulated_research', roadDistanceKm: 12, rfQuietness: 0.78 },
  { latMin: 60.0, latMax: 75.0, lonMin: 65.0, lonMax: 170.0, name: 'Siberian Permafrost / Highland Sector', region: 'Siberia / Yakutia', country: 'Russia', permitTier: 'polar_expedition', roadDistanceKm: 120, rfQuietness: 0.98, lithologyNote: 'Deep continuous permafrost & basaltic traps' },

  // Oceania & Pacific
  { latMin: 18.7, latMax: 20.5, lonMin: -156.5, lonMax: -154.5, name: 'Mauna Kea / Kilauea Basalt Shield', region: 'Hawaii', country: 'United States', permitTier: 'protected_park', roadDistanceKm: 8, rfQuietness: 0.90, lithologyNote: 'Basaltic tephra, olivine flows & lava tubes' },
  { latMin: -33.0, latMax: -17.0, lonMin: 114.0, lonMax: 141.0, name: 'Australian Outback / Nullarbor', region: 'Central & Western Australia', country: 'Australia', permitTier: 'open_public', roadDistanceKm: 40, rfQuietness: 0.96, lithologyNote: 'Ferruginous regolith, laterites & Nullarbor karst' },
  { latMin: -20.0, latMax: -16.5, lonMin: 142.5, lonMax: 146.5, name: 'Undara Basalt Province', region: 'North Queensland', country: 'Australia', permitTier: 'protected_park', roadDistanceKm: 24, rfQuietness: 0.94, lithologyNote: 'Cenozoic basalt plains & intact lava tubes' },
  { latMin: -46.0, latMax: -37.0, lonMin: 167.0, lonMax: 178.5, name: 'Taupo / Southern Alps Volcanic Zone', region: 'New Zealand', country: 'New Zealand', permitTier: 'regulated_research', roadDistanceKm: 14, rfQuietness: 0.86 },

  // Antarctica
  { latMin: -79.0, latMax: -75.0, lonMin: 156.0, lonMax: 168.0, name: 'McMurdo Dry Valleys Sector', region: 'Victoria Land', country: 'Antarctica', permitTier: 'polar_expedition', roadDistanceKm: 220, rfQuietness: 0.99, lithologyNote: 'Hyper-arid polar permafrost & dolerite sills' },
];

function fallbackContinent(lat: number, lon: number): ResolvedEarthRegion {
  const absLat = Math.abs(lat);
  const latStr = `${absLat.toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

  if (lat < -60) {
    return {
      name: `Antarctic Sector (${latStr}, ${lonStr})`,
      region: 'Antarctic Margin',
      country: 'Antarctica',
      permitTier: 'polar_expedition',
      roadDistanceKm: 240,
      rfQuietnessScore: 0.99,
      lithologyNote: 'Polar ice-margin regolith & exposed nunatak bedrock',
    };
  }
  if (lat > 66) {
    return {
      name: `High Arctic Sector (${latStr}, ${lonStr})`,
      region: 'Circumpolar Arctic',
      country: lon < -15 ? 'Canada / Greenland' : 'Eurasia Arctic',
      permitTier: 'polar_expedition',
      roadDistanceKm: 130,
      rfQuietnessScore: 0.98,
      lithologyNote: 'Permafrost tundra & cryo-fractured bedrock',
    };
  }
  if (lon >= -170 && lon <= -50) {
    return {
      name: lat >= 12 ? `North American Sector (${latStr}, ${lonStr})` : `South American Sector (${latStr}, ${lonStr})`,
      region: lat >= 12 ? 'North America' : 'South America',
      country: lat >= 12 ? 'North America' : 'South America',
      permitTier: 'open_public',
      roadDistanceKm: 20,
      rfQuietnessScore: 0.86,
      lithologyNote: 'Regional silicate/volcanic terrain unit',
    };
  }
  if (lon > -25 && lon <= 52) {
    const isAfrica = lat < 35;
    return {
      name: `${isAfrica ? 'African' : 'European'} Sector (${latStr}, ${lonStr})`,
      region: isAfrica ? 'Africa' : 'Europe',
      country: isAfrica ? 'Africa' : 'Europe',
      permitTier: 'open_public',
      roadDistanceKm: isAfrica ? 28 : 10,
      rfQuietnessScore: isAfrica ? 0.88 : 0.78,
      lithologyNote: 'Regional sedimentary/basement terrain unit',
    };
  }
  if (lon > 105 && lat < -10) {
    return {
      name: `Australasian Sector (${latStr}, ${lonStr})`,
      region: 'Oceania',
      country: 'Australia / Oceania',
      permitTier: 'open_public',
      roadDistanceKm: 34,
      rfQuietnessScore: 0.92,
      lithologyNote: 'Australian cratonic / regolith unit',
    };
  }
  return {
    name: `Eurasian Sector (${latStr}, ${lonStr})`,
    region: 'Asia / Eurasia',
    country: 'Eurasia',
    permitTier: 'open_public',
    roadDistanceKm: 24,
    rfQuietnessScore: 0.85,
    lithologyNote: 'Continental bedrock & regolith unit',
  };
}

export function resolveEarthRegion(
  lat: number,
  lon: number,
  voidCode = 0
): ResolvedEarthRegion {
  const absLat = Math.abs(lat);
  const coordTag = `${absLat.toFixed(0)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;
  for (const box of PHYSIOGRAPHIC_PROVINCES) {
    if (
      lat >= box.latMin &&
      lat <= box.latMax &&
      lon >= box.lonMin &&
      lon <= box.lonMax
    ) {
      const suffix =
        voidCode === 1
          ? ' · Lava Tube Belt'
          : voidCode === 2
            ? ' · Karst Zone'
            : '';
      return {
        name: `${box.name}${suffix} (${coordTag})`,
        region: box.region,
        country: box.country,
        permitTier: box.permitTier ?? (absLat > 66 ? 'polar_expedition' : 'open_public'),
        roadDistanceKm: box.roadDistanceKm ?? 22,
        rfQuietnessScore: box.rfQuietness ?? 0.88,
        lithologyNote: box.lithologyNote ?? `${box.region} terrain & regolith unit`,
      };
    }
  }
  return fallbackContinent(lat, lon);
}
