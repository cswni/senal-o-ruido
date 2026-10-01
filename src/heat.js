// Heat stress for human health, from NASA POWER daily data.
// Heat index: NOAA/NWS Rothfusz regression with its official adjustments.
// Humidity at the hottest hour is derived from specific humidity (QV2M) and
// surface pressure (PS), which barely change during the day, rather than the
// daily-mean RH, which overstates moisture at Tmax.

const isValid = (v) => typeof v === 'number' && Number.isFinite(v);
const toF = (c) => c * 1.8 + 32;
const toC = (f) => (f - 32) / 1.8;

// NOAA heat index categories (°F thresholds, converted to °C).
const CATEGORY_THRESHOLDS = Object.freeze([
  ['extreme-danger', toC(125)],
  ['danger', toC(103)],
  ['extreme-caution', toC(90)],
  ['caution', toC(80)],
]);

/** "Hot day" for health purposes: heat index at NOAA extreme caution or worse (≥ 32.2 °C). */
export const HOT_THRESHOLD_C = toC(90);
/** "Dangerous day": heat index at NOAA danger or worse (≥ 39.4 °C). */
export const DANGER_THRESHOLD_C = toC(103);

export const HEAT_CATEGORY_LABELS = Object.freeze({
  none: 'Sin riesgo térmico',
  caution: 'Precaución',
  'extreme-caution': 'Precaución extrema',
  danger: 'Peligro',
  'extreme-danger': 'Peligro extremo',
});

// Saturation vapour pressure over water in kPa (Tetens).
const saturationPressure = (tC) => 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));

/** Relative humidity (%) at temperature tC given specific humidity (g/kg) and pressure (kPa). */
export function relativeHumidityAt(tC, qGkg, pKpa) {
  if (![tC, qGkg, pKpa].every(isValid)) return null;
  const q = qGkg / 1000;
  const vapour = (q * pKpa) / (0.622 + 0.378 * q);
  return Math.min(100, Math.max(0, (100 * vapour) / saturationPressure(tC)));
}

/** NWS heat index in °F. */
export function heatIndexF(tF, rh) {
  const simple = 0.5 * (tF + 61 + (tF - 68) * 1.2 + rh * 0.094);
  if ((simple + tF) / 2 < 80) return simple;
  let hi =
    -42.379 +
    2.04901523 * tF +
    10.14333127 * rh -
    0.22475541 * tF * rh -
    0.00683783 * tF * tF -
    0.05481717 * rh * rh +
    0.00122874 * tF * tF * rh +
    0.00085282 * tF * rh * rh -
    0.00000199 * tF * tF * rh * rh;
  if (rh < 13 && tF >= 80 && tF <= 112) {
    hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(tF - 95)) / 17);
  } else if (rh > 85 && tF >= 80 && tF <= 87) {
    hi += ((rh - 85) / 10) * ((87 - tF) / 5);
  }
  return hi;
}

export const heatIndexC = (tC, rh) => toC(heatIndexF(toF(tC), rh));

export function heatCategory(hiC) {
  if (!isValid(hiC)) return null;
  const match = CATEGORY_THRESHOLDS.find(([, threshold]) => hiC >= threshold);
  return match ? match[0] : 'none';
}

/**
 * Adds HI (°C, at Tmax), HOT (1/0 at extreme caution or worse) and
 * DANGER (1/0 at danger or worse) to each daily row.
 */
export function withHeatIndex(rows) {
  return rows.map((row) => {
    const rh = relativeHumidityAt(row.T2M_MAX, row.QV2M, row.PS);
    if (rh == null) return { ...row, HI: null, HOT: null, DANGER: null };
    const hi = heatIndexC(row.T2M_MAX, rh);
    return {
      ...row,
      HI: hi,
      HOT: hi >= HOT_THRESHOLD_C ? 1 : 0,
      DANGER: hi >= DANGER_THRESHOLD_C ? 1 : 0,
    };
  });
}
