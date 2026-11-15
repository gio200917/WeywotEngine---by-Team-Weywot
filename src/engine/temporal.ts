import type { MonthlyClimatologyBin } from '../types/planetary.js';

const MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349] as const;

export interface WindowIntegrationResult {
  bestStartDayOfYear: number;
  finalScorePct: number;
  windowMeanPct: number;
  downsideSemiDev: number;
  driftPenalty: number;
  rainExceedanceProb: number;
  rainCliffPenalty: number;
  dailyScores: number[];
}

/**
 * Linearly interpolates 12 monthly values into 365 daily values (index 0 = Jan 1, day 1).
 */
export function interpolate12MonthsTo365Days(monthlyValues: number[]): number[] {
  if (monthlyValues.length !== 12) {
    throw new Error(`Expected 12 monthly values, received ${monthlyValues.length}`);
  }
  const daily = new Array<number>(365);

  for (let day = 1; day <= 365; day++) {
    let idxPrev = 11;
    let idxNext = 0;
    let dPrev: number = MID_MONTH_DOY[11] - 365; // -16
    let dNext: number = MID_MONTH_DOY[0]; // 15

    for (let m = 0; m < 12; m++) {
      if (day <= MID_MONTH_DOY[m]) {
        idxNext = m;
        dNext = MID_MONTH_DOY[m];
        if (m === 0) {
          idxPrev = 11;
          dPrev = MID_MONTH_DOY[11] - 365;
        } else {
          idxPrev = m - 1;
          dPrev = MID_MONTH_DOY[m - 1];
        }
        break;
      }
      if (m === 11) {
        idxPrev = 11;
        dPrev = MID_MONTH_DOY[11];
        idxNext = 0;
        dNext = MID_MONTH_DOY[0] + 365;
      }
    }

    const span = Math.max(1, dNext - dPrev);
    const t = Math.max(0, Math.min(1, (day - dPrev) / span));
    daily[day - 1] = monthlyValues[idxPrev] * (1 - t) + monthlyValues[idxNext] * t;
  }

  return daily;
}

/**
 * Evaluates a single [d0, d0 + durationDays - 1] campaign window.
 */
export function evaluateWindowAtStartDay(
  dailyScores: number[],
  dailyWetProb: number[],
  startDayOfYear: number,
  durationDays: number,
  hydroWeight: number
): {
  finalScorePct: number;
  windowMeanPct: number;
  downsideSemiDev: number;
  driftPenalty: number;
  rainExceedanceProb: number;
  rainCliffPenalty: number;
} {
  const dt = Math.max(3, Math.min(90, Math.round(durationDays)));
  const startIdx = (((startDayOfYear - 1) % 365) + 365) % 365;

  let sumScore = 0;
  let survivalProd = 1;
  for (let k = 0; k < dt; k++) {
    const idx = (startIdx + k) % 365;
    sumScore += dailyScores[idx];
    const pWet = Math.max(0, Math.min(0.9999, dailyWetProb[idx]));
    survivalProd *= Math.pow(1 - pWet, 1 / 3.0);
  }

  const windowMeanPct = sumScore / dt;

  let downSqSum = 0;
  for (let k = 0; k < dt; k++) {
    const idx = (startIdx + k) % 365;
    const deficit = Math.max(0, windowMeanPct - dailyScores[idx]);
    downSqSum += deficit * deficit;
  }

  const downsideSemiDev = Math.sqrt(downSqSum / dt);
  const driftPenalty = downsideSemiDev * (1 - Math.exp(-dt / 14.0));
  const rainExceedanceProb = Math.max(0, Math.min(1, 1 - survivalProd));
  const rainCliffPenalty =
    20.0 * Math.max(0, (rainExceedanceProb - 0.1) / 0.9) * Math.max(0, hydroWeight);

  const finalScorePct = Math.max(
    0,
    Math.min(100, windowMeanPct - driftPenalty - rainCliffPenalty)
  );

  return {
    finalScorePct,
    windowMeanPct,
    downsideSemiDev,
    driftPenalty,
    rainExceedanceProb,
    rainCliffPenalty,
  };
}

/**
 * Slides across all start days d0 in {1..365} for [3, 90]-day campaign durations
 * to compute optimal window score S_final = max_{d0} max(0, S_win - P_drift - Omega_cliff).
 */
export function optimizeCampaignWindow(
  monthlyScores: number[],
  monthlyBins: MonthlyClimatologyBin[],
  durationDays: number,
  hydroWeight: number
): WindowIntegrationResult {
  const dailyScores = interpolate12MonthsTo365Days(monthlyScores);
  const monthlyWet = new Array<number>(12);
  for (let m = 0; m < 12; m++) {
    const p = monthlyBins[m].pPrecipGt5Mm;
    monthlyWet[m] = p < 0 ? 0 : p > 1 ? 1 : p;
  }
  const dailyWetProb = interpolate12MonthsTo365Days(monthlyWet);

  const dt = Math.max(3, Math.min(90, Math.round(durationDays)));
  const dailySurvival = new Array<number>(365);
  for (let i = 0; i < 365; i++) {
    const pWet = dailyWetProb[i] < 0 ? 0 : dailyWetProb[i] > 0.9999 ? 0.9999 : dailyWetProb[i];
    dailySurvival[i] = Math.pow(1 - pWet, 1 / 3.0);
  }
  const driftFactor = 1 - Math.exp(-dt / 14.0);
  const rainSlope = 20.0 * Math.max(0, hydroWeight);

  let bestStartDayOfYear = 1;
  let bestFinalScore = -1;
  let bestWindowMean = 0;
  let bestDownsideSemiDev = 0;
  let bestDriftPenalty = 0;
  let bestRainProb = 0;
  let bestRainCliff = 0;

  for (let startIdx = 0; startIdx < 365; startIdx++) {
    let sumScore = 0;
    let survivalProd = 1;
    for (let k = 0; k < dt; k++) {
      const idx = (startIdx + k) % 365;
      sumScore += dailyScores[idx];
      survivalProd *= dailySurvival[idx];
    }

    const windowMeanPct = sumScore / dt;

    let downSqSum = 0;
    for (let k = 0; k < dt; k++) {
      const idx = (startIdx + k) % 365;
      const deficit = windowMeanPct - dailyScores[idx];
      if (deficit > 0) downSqSum += deficit * deficit;
    }

    const downsideSemiDev = Math.sqrt(downSqSum / dt);
    const driftPenalty = downsideSemiDev * driftFactor;
    const rainExceedanceProb = survivalProd >= 1 ? 0 : survivalProd <= 0 ? 1 : 1 - survivalProd;
    const rainCliffPenalty =
      rainExceedanceProb > 0.1
        ? rainSlope * ((rainExceedanceProb - 0.1) / 0.9)
        : 0;

    const rawFinal = windowMeanPct - driftPenalty - rainCliffPenalty;
    const finalScorePct = rawFinal < 0 ? 0 : rawFinal > 100 ? 100 : rawFinal;

    if (finalScorePct > bestFinalScore) {
      bestFinalScore = finalScorePct;
      bestStartDayOfYear = startIdx + 1;
      bestWindowMean = windowMeanPct;
      bestDownsideSemiDev = downsideSemiDev;
      bestDriftPenalty = driftPenalty;
      bestRainProb = rainExceedanceProb;
      bestRainCliff = rainCliffPenalty;
    }
  }

  return {
    bestStartDayOfYear,
    finalScorePct: bestFinalScore < 0 ? 0 : bestFinalScore,
    windowMeanPct: bestWindowMean,
    downsideSemiDev: bestDownsideSemiDev,
    driftPenalty: bestDriftPenalty,
    rainExceedanceProb: bestRainProb,
    rainCliffPenalty: bestRainCliff,
    dailyScores,
  };
}
