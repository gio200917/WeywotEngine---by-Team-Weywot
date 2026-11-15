import type {
  CelestialTarget,
  EarthAnalogSite,
  EphemerisState,
  HardwareCompensationSpecs,
  UnreplicatedDeficit,
} from '../types/planetary.js';
import { EARTH_GRAVITY_MS2 } from './physics.js';

export function computeDeficitsAndHardwareSpecs(
  target: CelestialTarget,
  site: EarthAnalogSite,
  ephemeris: EphemerisState,
  bestStartDayOfYear: number
): {
  deficits: UnreplicatedDeficit[];
  hardwareSpecs: HardwareCompensationSpecs;
} {
  const gravityRatio = target.gravityMs2 / EARTH_GRAVITY_MS2;
  const offloadFractionPct = Math.max(0, (1 - gravityRatio) * 100);
  const offloadForcePer100KgN = Math.max(0, 100 * (EARTH_GRAVITY_MS2 - target.gravityMs2));

  const bestMonthIdx = Math.max(
    0,
    Math.min(11, Math.floor(((bestStartDayOfYear - 1) / 365) * 12))
  );
  const siteMonth = site.monthly[bestMonthIdx] ?? site.monthly[0];
  const thermalGapK = Math.abs(ephemeris.targetEffectiveTempK - siteMonth.tMeanK);
  const requiresThermalCryoChamber = thermalGapK > 45;

  const requiresUvCChamber = target.thermalBase.uvCFluxWm2 > 0.01;
  const requiresDustSealing =
    target.isVacuumRegime || target.atmosphericBase.dustOpacityTauBase >= 0.3;

  const maxGrazingHrs = Math.max(
    ...site.monthly.map((m) => m.grazingSunHoursPerDay)
  );
  const optimalGrazingSunHoursPerDay = Math.round(siteMonth.grazingSunHoursPerDay * 100) / 100;

  let optimalLocalWindowNote = `~${optimalGrazingSunHoursPerDay.toFixed(1)} h/day clear grazing sun (0-10 deg) in target campaign month (peak ${maxGrazingHrs.toFixed(1)} h/day).`;
  if (Math.abs(site.lat) > 65) {
    optimalLocalWindowNote = `High-latitude low solar angle yields ${optimalGrazingSunHoursPerDay.toFixed(1)} h/day sustained polar-horizon illumination testing.`;
  } else if (target.operationsIdeal.grazingSunHoursPerDay === 0) {
    optimalLocalWindowNote = `Target is permanently shadowed; conduct nighttime / shielded operations (${siteMonth.clearSkyFraction > 0.7 ? 'high clear-sky stability' : 'monitor cloud cover'}).`;
  }

  const deficits: UnreplicatedDeficit[] = [];

  // 1. Gravity Deficit (always present on Mars/Moon)
  deficits.push({
    id: 'gravity_offload',
    label: `Unreplicated ${target.body === 'moon' ? 'Lunar' : 'Martian'} Gravity (${target.gravityMs2.toFixed(2)} m/s^2)`,
    severity: target.body === 'moon' ? 'critical' : 'moderate',
    detail: `Earth gravity is ${(1 / gravityRatio).toFixed(2)}x stronger; wheel sinkage, regolith cohesion angle, and drill cuttings transport under-predict slip and plume lofting.`,
    compensationSpec: `Apply vertical gravity offload of ${offloadForcePer100KgN.toFixed(0)} N per 100 kg test mass (${offloadFractionPct.toFixed(1)}% weight relief) via gantry or passive suspension.`,
  });

  // 2. UV-C / Radiation Deficit
  if (requiresUvCChamber) {
    deficits.push({
      id: 'uvc_deficit',
      label: 'Unreplicated UV-C (200-280 nm) & Ionizing Radiation',
      severity: 'critical',
      detail: `Earth ozone blocks ${target.thermalBase.uvCFluxWm2.toFixed(1)} W/m^2 of solar UV-C that degrades polymers, sterilizes organics, and drives oxidant chemistry on ${target.body}.`,
      compensationSpec: `Supplement field tests with lab UV-C (254 nm) + vacuum solar-simulator chamber exposure matching ${target.thermalBase.uvCFluxWm2.toFixed(1)} W/m^2.`,
    });
  } else if (target.isVacuumRegime) {
    deficits.push({
      id: 'psr_radiation',
      label: 'Unreplicated Galactic Cosmic Ray & Lyman-Alpha Environment',
      severity: 'moderate',
      detail: 'Target PSR lacks solar UV-C but experiences unattenuated GCR/solar proton charging in hard vacuum.',
      compensationSpec: 'Qualify electronics and cryogenic seals in TVAC chamber with cold shroud and electrostatic discharge protection.',
    });
  }

  // 3. Atmospheric Pressure / Vacuum Deficit
  if (target.isVacuumRegime) {
    deficits.push({
      id: 'vacuum_deficit',
      label: 'Unreplicated Hard Vacuum & Electrostatic Regolith Adhesion',
      severity: 'critical',
      detail: `Terrestrial air (${siteMonth.pressureKpa.toFixed(1)} kPa) cushions fine dust and dissipates triboelectric charge absent in lunar vacuum.`,
      compensationSpec: 'Seal bearings/optical surfaces to IP6X+ and run vacuum-chamber abrasion verification with sieved <63 um simulant.',
    });
  } else {
    deficits.push({
      id: 'mars_low_pressure',
      label: `Low-Density CO2 Atmosphere (${(ephemeris.targetEffectiveDensityKgM3 * 1000).toFixed(1)} g/m^3)`,
      severity: 'moderate',
      detail: `Earth ambient density (${siteMonth.ambientDensityKgM3.toFixed(2)} kg/m^3) is ~${Math.round(siteMonth.ambientDensityKgM3 / Math.max(1e-4, ephemeris.targetEffectiveDensityKgM3))}x denser, altering convective cooling and aeolian saltation.`,
      compensationSpec: 'Scale thermal radiator margins and validate rotor/aeolian instrumentation inside a 6-10 mbar CO2 wind tunnel.',
    });
  }

  // 4. Thermal Cryogenic Deficit
  if (requiresThermalCryoChamber) {
    deficits.push({
      id: 'thermal_cryo_gap',
      label: `Thermal Regime Gap (${thermalGapK.toFixed(0)} K Offset)`,
      severity: thermalGapK > 120 ? 'critical' : 'moderate',
      detail: `Target effective temperature (${ephemeris.targetEffectiveTempK.toFixed(0)} K) is ${thermalGapK.toFixed(0)} K colder than ${site.name} (${siteMonth.tMeanK.toFixed(0)} K).`,
      compensationSpec: `Perform LN2 / LHe cryogenic chamber qualification down to ${ephemeris.targetEffectiveTempK.toFixed(0)} K for actuators, drill bits, and lubricants.`,
    });
  }

  // 5. Clay / Hydrological Contamination if applicable
  if (target.isAnhydrousRegolith && site.geology.clayIndex > 0.05) {
    deficits.push({
      id: 'clay_contamination',
      label: `Anhydrous Regolith Clay Breach (clayIndex=${site.geology.clayIndex.toFixed(2)})`,
      severity: 'critical',
      detail: 'Terrestrial phyllosilicates (swelling clays) alter cohesion, microwave sintering, and volatile extraction unlike anhydrous lunar regolith.',
      compensationSpec: 'Avoid clay-bearing strata for geotechnical/ISRU tests or blend with crushed basaltic/anorthositic simulant.',
    });
  }

  const hardwareSpecs: HardwareCompensationSpecs = {
    targetGravityMs2: target.gravityMs2,
    earthGravityMs2: EARTH_GRAVITY_MS2,
    gravityRatio: Math.round(gravityRatio * 1000) / 1000,
    offloadForcePer100KgN: Math.round(offloadForcePer100KgN * 10) / 10,
    offloadFractionPct: Math.round(offloadFractionPct * 10) / 10,
    requiresUvCChamber,
    targetUvCFluxWm2: target.thermalBase.uvCFluxWm2,
    optimalGrazingSunHoursPerDay,
    optimalLocalWindowNote,
    requiresThermalCryoChamber,
    thermalGapK: Math.round(thermalGapK * 10) / 10,
    requiresDustSealing,
  };

  return { deficits, hardwareSpecs };
}
