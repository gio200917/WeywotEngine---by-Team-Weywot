import type { BodyType, CelestialTarget, EphemerisState } from '../types/planetary.js';

export const EARTH_GRAVITY_MS2 = 9.80665;
export const MARS_GRAVITY_MS2 = 3.721;
export const MOON_GRAVITY_MS2 = 1.622;

const MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349] as const;

export interface EllipsoidParams {
  a: number;
  e2: number;
}

export const BODY_ELLIPSOIDS: Record<BodyType, EllipsoidParams> = {
  earth: {
    a: 6378137.0,
    e2: (1 / 298.257223563) * (2 - 1 / 298.257223563),
  },
  mars: {
    a: 3396190.0,
    e2: 1 - (3376200.0 * 3376200.0) / (3396190.0 * 3396190.0),
  },
  moon: {
    a: 1737400.0,
    e2: 0.0,
  },
};

export interface Cartesian3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Right-handed Three.js planetocentric / geodetic coordinates.
 * Positive East longitude maps to -Z:
 *   X = (N + h) * cos(lat) * cos(lon)
 *   Y = (N * (1 - e^2) + h) * sin(lat)
 *   Z = -(N + h) * cos(lat) * sin(lon)
 */
export function latLonToThreeCartesian(
  latDeg: number,
  lonDeg: number,
  elevationM: number,
  body: BodyType,
  radiusOverride?: number
): Cartesian3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const { a, e2 } = BODY_ELLIPSOIDS[body];
  const scale = radiusOverride !== undefined ? radiusOverride / a : 1;
  const aScaled = a * scale;
  const hScaled = elevationM * scale;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const denom = Math.sqrt(Math.max(1e-12, 1 - e2 * sinLat * sinLat));
  const n = aScaled / denom;

  const x = (n + hScaled) * cosLat * Math.cos(lon);
  const y = (n * (1 - e2) + hScaled) * sinLat;
  const z = -(n + hScaled) * cosLat * Math.sin(lon);

  return {
    x: Math.abs(x) < 1e-12 ? 0 : x,
    y: Math.abs(y) < 1e-12 ? 0 : y,
    z: Math.abs(z) < 1e-12 ? 0 : z,
  };
}

/**
 * Inverse of latLonToThreeCartesian: maps right-handed Three.js (X, Y, Z)
 * where +X = 0 deg lon and -Z = +90E back to (latDeg, lonDeg).
 */
export function threeCartesianToLatLon(
  x: number,
  y: number,
  z: number,
  body: BodyType
): { latDeg: number; lonDeg: number } {
  const { e2 } = BODY_ELLIPSOIDS[body];
  const lonRad = Math.atan2(-z, x);
  const p = Math.hypot(x, z);
  const geocentricLat = Math.atan2(y, Math.max(1e-12, p) * (1 - e2));
  const latDeg = (geocentricLat * 180) / Math.PI;
  const lonDeg = (lonRad * 180) / Math.PI;
  return {
    latDeg: Math.max(-90, Math.min(90, latDeg)),
    lonDeg,
  };
}

export function getDayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86400000) + 1;
}

export function parseEpochDate(epochDateIso: string): Date {
  const parsed = new Date(`${epochDateIso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date('2026-06-15T12:00:00Z');
  }
  return parsed;
}

/**
 * Mars solar longitude Ls (degrees, [0, 360)) from Keplerian ephemeris:
 * Solve E - 0.0934 * sin(E) = M(t_epoch),
 * get true anomaly nu_rad, convert to degrees + 250.99 deg mod 360.
 */
export function computeMarsLsDeg(date: Date): number {
  const jdUtc = date.getTime() / 86400000 + 2440587.5;
  const jdTt = jdUtc + 69.184 / 86400.0;
  const dtJ2000 = jdTt - 2451545.0;

  const meanAnomalyDeg = (((19.3871 + 0.52402073 * dtJ2000) % 360) + 360) % 360;
  const mRad = (meanAnomalyDeg * Math.PI) / 180;
  const e = 0.0934;

  let E = mRad;
  for (let i = 0; i < 10; i++) {
    const f = E - e * Math.sin(E) - mRad;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }

  const nuRad =
    2 *
    Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2)
    );
  const nuDeg = (nuRad * 180) / Math.PI;
  return (((nuDeg + 250.99) % 360) + 360) % 360;
}

/**
 * Shao & Lu (2000) cohesive saltation threshold friction velocity u*t (m/s).
 * Returns null when isVacuumRegime is true (e.g., Moon).
 */
export function computeShaoLuThresholdFrictionVel(
  particleDensityKgM3: number,
  ambientDensityKgM3: number,
  gravityMs2: number,
  diameterUm: number,
  isVacuumRegime = false
): number | null {
  if (isVacuumRegime || ambientDensityKgM3 <= 0 || diameterUm <= 0 || gravityMs2 <= 0) {
    return null;
  }
  const dP = diameterUm * 1e-6;
  const buoyantTerm = ((particleDensityKgM3 - ambientDensityKgM3) / ambientDensityKgM3) * gravityMs2 * dP;
  const cohesiveTerm = 1.65e-4 / (ambientDensityKgM3 * dP);
  const val = 0.0123 * (buoyantTerm + cohesiveTerm);
  return Math.sqrt(Math.max(0, val));
}

/**
 * Analytical Earth clear-sky grazing-sunlight hours/day (0 < beta_sun < 10 deg)
 * over 96 quarter-hour steps at mid-month day * clearSkyFraction.
 */
export function computeEarthGrazingSunHoursPerDay(
  latDeg: number,
  month: number,
  clearSkyFraction: number
): number {
  const mIdx = Math.max(0, Math.min(11, Math.round(month) - 1));
  const doy = MID_MONTH_DOY[mIdx];
  const declRad = (23.44 * Math.PI) / 180 * Math.sin((2 * Math.PI * (doy - 81)) / 365.25);
  const latRad = (latDeg * Math.PI) / 180;

  let grazingSteps = 0;
  for (let i = 0; i < 96; i++) {
    const hour = i * 0.25;
    const hourAngleRad = (((hour - 12) * 15) * Math.PI) / 180;
    const sinBeta =
      Math.sin(latRad) * Math.sin(declRad) +
      Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
    const clamped = Math.max(-1, Math.min(1, sinBeta));
    const betaDeg = (Math.asin(clamped) * 180) / Math.PI;
    if (betaDeg > 0 && betaDeg < 10) {
      grazingSteps += 1;
    }
  }

  const clampedClear = Math.max(0, Math.min(1, clearSkyFraction));
  return grazingSteps * 0.25 * clampedClear;
}

export function computeLunarSolarGeometry(
  latDeg: number,
  date: Date,
  horizonMaskMaxDeg: number,
  elevationM = 0
): {
  subsolarLatDeg: number;
  maxSolarElevDeg: number;
  isPermanentlyShadowed: boolean;
} {
  const doy = getDayOfYear(date);
  const subsolarLatDeg = 1.543 * Math.sin((2 * Math.PI * (doy - 80)) / 346.62);
  const rMoon = BODY_ELLIPSOIDS.moon.a;
  const horizonDipDeg =
    elevationM > 0
      ? (Math.acos(rMoon / (rMoon + elevationM)) * 180) / Math.PI
      : 0;
  const maxSolarElevDeg = Math.max(
    -90,
    Math.min(90, 90 - Math.abs(latDeg - subsolarLatDeg) + horizonDipDeg)
  );
  const isPermanentlyShadowed = maxSolarElevDeg <= horizonMaskMaxDeg;
  return { subsolarLatDeg, maxSolarElevDeg, isPermanentlyShadowed };
}

/**
 * Visual alienation index [0, 1] accounting for open water, unrequested snow,
 * and vegetation NDVI penalties.
 */
export function computeVisualAlienation(
  ndvi: number,
  ndwi: number,
  ndsi: number,
  snowDepthCm: number,
  requiresCryogenicIce: boolean
): number {
  if (ndwi >= 0) return 0;
  if (!requiresCryogenicIce && (snowDepthCm > 2 || ndsi >= 0.4)) return 0;
  if (ndvi <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - ndvi / 0.25));
}

export function computeEphemerisState(
  target: CelestialTarget,
  epochDateIso: string
): EphemerisState {
  const date = parseEpochDate(epochDateIso);
  const dayOfYear = getDayOfYear(date);
  const marsLsDeg = computeMarsLsDeg(date);
  const lunar = computeLunarSolarGeometry(
    target.lat,
    date,
    target.horizonMaskMaxDeg,
    target.elevationM
  );

  let targetEffectiveTempK = target.thermalBase.tMeanK;
  let targetEffectiveDensityKgM3 = target.atmosphericBase.ambientDensityKgM3;

  if (target.body === 'mars') {
    const lsRad = (marsLsDeg * Math.PI) / 180;
    const latSign = target.lat >= 0 ? 1 : -1;
    // Northern summer peaks around Ls=90; perihelion heating peaks around Ls=251
    const seasonalWave =
      latSign * Math.sin(lsRad) * 0.7 + 0.3 * Math.cos(lsRad - (250.99 * Math.PI) / 180);
    targetEffectiveTempK = Math.max(
      130,
      target.thermalBase.tMeanK + target.thermalBase.tSeasonalAmpK * seasonalWave
    );
    // Mars atmospheric pressure/density seasonal CO2 condensation cycle (~+-14%)
    const pressureWave = 0.14 * Math.cos(lsRad - (250.99 * Math.PI) / 180);
    targetEffectiveDensityKgM3 = Math.max(
      0.002,
      target.atmosphericBase.ambientDensityKgM3 * (1 + pressureWave)
    );
  } else {
    // Moon: if permanently shadowed, thermal regime stays cryogenic PSR baseline;
    // if sunlit ridge/equator, mild subsolar-angle seasonal modulation
    const lunarMod = lunar.isPermanentlyShadowed
      ? 0
      : 4.0 * Math.cos(((lunar.subsolarLatDeg * Math.PI) / 180) * 6);
    targetEffectiveTempK = Math.max(30, target.thermalBase.tMeanK + lunarMod);
    targetEffectiveDensityKgM3 = 0;
  }

  const targetEffectiveThresholdVelMs = computeShaoLuThresholdFrictionVel(
    target.atmosphericBase.particleDensityKgM3,
    targetEffectiveDensityKgM3,
    target.gravityMs2,
    target.atmosphericBase.medianGrainDiameterUm,
    target.isVacuumRegime
  );

  return {
    epochDateIso,
    dayOfYear,
    marsLsDeg,
    lunarSubsolarLatDeg: lunar.subsolarLatDeg,
    lunarMaxSolarElevDeg: lunar.maxSolarElevDeg,
    lunarIsPermanentlyShadowed: lunar.isPermanentlyShadowed,
    targetEffectiveTempK,
    targetEffectiveDensityKgM3,
    targetEffectiveThresholdVelMs,
  };
}
