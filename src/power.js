// NASA POWER: daily, gridded measurements (MERRA-2 / satellite derived) since 1981.
// Turns a point time series into annual trends and "how unusual was the run-up
// to this event?" anomalies.

import { mannKendall, senSlope, mean, standardDeviation, percentileRank } from './stats.js';

const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';
export const POWER_START_DATE = '1981-01-01';
const FILL_VALUE = -999;
const DAY_MS = 86400000;
const MIN_ANNUAL_COVERAGE = 0.9;
const MIN_WINDOW_COVERAGE = 0.8;
const MIN_BASELINE_YEARS = 10;

export const PARAMETERS = Object.freeze({
  T2M_MAX: {
    label: 'Temperatura máxima',
    short: 'T. máx.',
    unit: '°C',
    annual: 'mean',
    window: 'mean',
    decimals: 1,
  },
  PRECTOTCORR: {
    label: 'Precipitación',
    short: 'Lluvia',
    unit: 'mm',
    annual: 'sum',
    window: 'sum',
    decimals: 0,
  },
  GWETROOT: {
    label: 'Humedad del suelo (zona de raíces)',
    short: 'Humedad suelo',
    unit: '',
    annual: 'mean',
    window: 'mean',
    decimals: 2,
  },
});

// Extra inputs for the heat index (specific humidity g/kg, surface pressure kPa).
export const FETCH_PARAMETERS = Object.freeze([...Object.keys(PARAMETERS), 'QV2M', 'PS']);

const isValid = (v) => typeof v === 'number' && Number.isFinite(v);
const compact = (iso) => iso.replaceAll('-', '');
const toIso = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const dayBefore = (iso) => addDays(iso, -1);

export function buildPowerUrl({ lat, lon, start, end, parameters = FETCH_PARAMETERS }) {
  if (!isValid(lat) || lat < -90 || lat > 90) throw new RangeError(`Latitud inválida: ${lat}`);
  if (!isValid(lon) || lon < -180 || lon > 180) throw new RangeError(`Longitud inválida: ${lon}`);
  const params = new URLSearchParams({
    parameters: parameters.join(','),
    community: 'AG',
    latitude: String(lat),
    longitude: String(lon),
    start: compact(start),
    end: compact(end),
    format: 'JSON',
  });
  return `${POWER_URL}?${params}`;
}

/** POWER JSON -> [{ date: 'YYYY-MM-DD', <PARAM>: number|null }] sorted by date. */
export function parsePowerDaily(json) {
  const byParam = json?.properties?.parameter;
  if (!byParam || typeof byParam !== 'object') {
    throw new Error('Respuesta de NASA POWER sin parámetros');
  }
  const names = Object.keys(byParam);
  const dates = Object.keys(byParam[names[0]] ?? {}).sort();
  return dates.map((key) => {
    const row = { date: toIso(key) };
    for (const name of names) {
      const v = byParam[name][key];
      row[name] = isValid(v) && v !== FILL_VALUE ? v : null;
    }
    return row;
  });
}

export async function fetchPowerDaily({ lat, lon, start, end, signal }) {
  const url = buildPowerUrl({ lat, lon, start, end });
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('No se pudo contactar a NASA POWER. Revisa tu conexión.');
  }
  if (!res.ok) throw new Error(`NASA POWER respondió con error ${res.status}`);
  return parsePowerDaily(await res.json());
}

function aggregate(values, kind, expectedDays) {
  const m = mean(values);
  return kind === 'sum' ? m * expectedDays : m;
}

/**
 * One value per calendar year. Years the record does not reach to 31 December
 * (e.g. the current year) and years with less than 90% valid days are dropped.
 */
export function annualSeries(rows, param, kind) {
  const lastDate = rows.at(-1)?.date ?? '';
  const byYear = new Map();
  for (const row of rows) {
    const year = Number(row.date.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), row[param]]);
  }
  return [...byYear.entries()]
    .map(([year, values]) => {
      const days = isLeap(year) ? 366 : 365;
      const valid = values.filter(isValid);
      return { year, value: aggregate(valid, kind, days), coverage: valid.length / days };
    })
    .filter((r) => r.coverage >= MIN_ANNUAL_COVERAGE && lastDate >= `${r.year}-12-31`);
}

function windowEnd(year, monthDay) {
  const clamped = monthDay === '02-29' && !isLeap(year) ? '02-28' : monthDay;
  return `${year}-${clamped}`;
}

/** The same `days`-long calendar window (ending on `monthDay`) aggregated for every year. */
export function windowSeries(rows, param, monthDay, days, kind) {
  if (rows.length === 0) return [];
  const index = new Map(rows.map((r) => [r.date, r[param]]));
  const firstYear = Number(rows[0].date.slice(0, 4));
  const lastYear = Number(rows.at(-1).date.slice(0, 4));
  const series = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const end = windowEnd(year, monthDay);
    const values = Array.from({ length: days }, (_, k) => index.get(addDays(end, -k)));
    const valid = values.filter(isValid);
    const coverage = valid.length / days;
    if (coverage >= MIN_WINDOW_COVERAGE) {
      series.push({ year, end, value: aggregate(valid, kind, days), coverage });
    }
  }
  return series;
}

function bandOf(percentile) {
  if (percentile <= 10) return 'very-low';
  if (percentile <= 25) return 'low';
  if (percentile >= 90) return 'very-high';
  if (percentile >= 75) return 'high';
  return 'normal';
}

/** How the event year compares with all earlier years of the same window. */
export function anomalyOf(series, eventYear) {
  const event = series.find((r) => r.year === eventYear);
  if (!event) return null;
  const baseline = series.filter((r) => r.year < eventYear).map((r) => r.value);
  const percentile = percentileRank(event.value, baseline);
  const sd = standardDeviation(baseline);
  return {
    value: event.value,
    baseline,
    percentile,
    z: sd > 0 ? (event.value - mean(baseline)) / sd : NaN,
    band: bandOf(percentile),
    reliable: baseline.length >= MIN_BASELINE_YEARS,
  };
}

/** Mann-Kendall + Sen slope on a { year, value } series, slope expressed per decade. */
export function trendOf(series) {
  const years = series.map((r) => r.year);
  const values = series.map((r) => r.value);
  const sen = senSlope(years, values);
  return {
    start: years[0],
    end: years.at(-1),
    mk: mannKendall(values),
    sen,
    perDecade: sen.slope * 10,
  };
}
