import { describe, expect, it } from 'vitest';
import {
  BODY_ELLIPSOIDS,
  computeEarthGrazingSunHoursPerDay,
  computeLunarSolarGeometry,
  computeMarsLsDeg,
  computeShaoLuThresholdFrictionVel,
  latLonToThreeCartesian,
  threeCartesianToLatLon,
} from '../engine/physics.js';

describe('physics.ts — Ephemeris, Three.js Coordinates & Shao-Lu Saltation', () => {
  it('computes Mars Ls within <1 deg of 2026 equinox/solstice dates', () => {
    // Mars Northern Vernal Equinox (Ls = 0 / 360) occurs on 2026-09-30
    const lsVernal2026 = computeMarsLsDeg(new Date('2026-09-30T12:00:00Z'));
    const distToZero = Math.min(lsVernal2026, 360 - lsVernal2026);
    expect(distToZero).toBeLessThan(1.0);

    // Mars Northern Winter Solstice (Ls = 270) occurs on 2026-04-25
    const lsWinter2026 = computeMarsLsDeg(new Date('2026-04-25T12:00:00Z'));
    expect(Math.abs(lsWinter2026 - 270)).toBeLessThan(1.0);
  });

  it('maps Three.js (lat=0, lon=+90E) to (0, 0, -a) with positive East longitude to -Z', () => {
    const aEarth = BODY_ELLIPSOIDS.earth.a;
    const pt = latLonToThreeCartesian(0, 90, 0, 'earth');
    expect(pt.x).toBeCloseTo(0, 5);
    expect(pt.y).toBeCloseTo(0, 5);
    expect(pt.z).toBeCloseTo(-aEarth, 3);

    const ptMars = latLonToThreeCartesian(0, -90, 0, 'mars');
    expect(ptMars.x).toBeCloseTo(0, 5);
    expect(ptMars.y).toBeCloseTo(0, 5);
    expect(ptMars.z).toBeCloseTo(BODY_ELLIPSOIDS.mars.a, 3);

    // Round-trip inverse check for Earth WGS84 and Moon
    const sample = latLonToThreeCartesian(-24.1, -69.9, 0, 'earth', 1.0);
    const inv = threeCartesianToLatLon(sample.x, sample.y, sample.z, 'earth');
    expect(inv.latDeg).toBeCloseTo(-24.1, 3);
    expect(inv.lonDeg).toBeCloseTo(-69.9, 3);

    const eqEastInv = threeCartesianToLatLon(0, 0, -1.0, 'moon');
    expect(eqEastInv.latDeg).toBeCloseTo(0, 5);
    expect(eqEastInv.lonDeg).toBeCloseTo(90, 5);
  });

  it('Shao-Lu u*t captures fine-dust cohesion minimum near 75-120 um and masks cleanly on Moon vacuum', () => {
    const diameters = [30, 60, 80, 100, 120, 200, 400];
    const earthU = diameters.map((d) =>
      computeShaoLuThresholdFrictionVel(2650, 1.225, 9.80665, d, false) as number
    );
    const minEarthIdx = earthU.indexOf(Math.min(...earthU));
    expect(diameters[minEarthIdx]).toBeGreaterThanOrEqual(75);
    expect(diameters[minEarthIdx]).toBeLessThanOrEqual(120);

    const marsU = diameters.map((d) =>
      computeShaoLuThresholdFrictionVel(2900, 0.0155, 3.721, d, false) as number
    );
    const minMarsIdx = marsU.indexOf(Math.min(...marsU));
    expect(diameters[minMarsIdx]).toBeGreaterThanOrEqual(75);
    expect(diameters[minMarsIdx]).toBeLessThanOrEqual(125);

    const moonMasked = computeShaoLuThresholdFrictionVel(2950, 0.0, 1.622, 75, true);
    expect(moonMasked).toBeNull();
  });

  it('distinguishes Lunar Shackleton PSR from Connecting Ridge PEL via horizon mask', () => {
    const epoch = new Date('2026-06-15T12:00:00Z');
    const psr = computeLunarSolarGeometry(-89.67, epoch, 12.0, -4200);
    const pel = computeLunarSolarGeometry(-89.45, epoch, 0.2, 1200);

    expect(psr.isPermanentlyShadowed).toBe(true);
    expect(pel.isPermanentlyShadowed).toBe(false);
  });

  it('computes positive Earth grazing sunlight hours (0 < beta < 10 deg) modulated by clear sky', () => {
    const hClear = computeEarthGrazingSunHoursPerDay(35.0, 6, 1.0);
    const hCloudy = computeEarthGrazingSunHoursPerDay(35.0, 6, 0.5);
    expect(hClear).toBeGreaterThan(0.5);
    expect(hCloudy).toBeCloseTo(hClear * 0.5, 4);
  });
});
