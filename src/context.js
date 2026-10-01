// National context from the World Bank: economy, food, quality of life, nature.
// These numbers describe the country in the event year. A single event almost
// never moves a national indicator measurably, so the app reports whether the
// year was unusual and always labels it "coincidence, not causation".

import { senSlope, median } from './stats.js';

const WORLD_BANK = 'https://api.worldbank.org/v2';
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const BASELINE_YEARS = 15;
const MIN_BASELINE_POINTS = 10;
// |deviation| above this many robust standard deviations counts as unusual.
const UNUSUAL_SIGMAS = 3;
const MAD_TO_SIGMA = 1.4826;
// Floor for the spread, as a share of the expected value, so near-perfect series
// do not flag trivial deviations as unusual.
const MIN_SPREAD_SHARE = 0.005;

/**
 * baseline 'trend': indicators that drift steadily (extrapolate the prior Sen trend).
 * baseline 'level': indicators that fluctuate around a level (compare with the prior median).
 */
export const INDICATORS = Object.freeze([
  { code: 'SP.DYN.LE00.IN', label: 'Esperanza de vida al nacer', unit: 'años', decimals: 1, theme: 'Calidad de vida', baseline: 'trend' },
  { code: 'AG.YLD.CREL.KG', label: 'Rendimiento de cereales', unit: 'kg/ha', decimals: 0, theme: 'Alimentación', baseline: 'trend' },
  { code: 'NY.GDP.MKTP.KD.ZG', label: 'Crecimiento del PIB', unit: '%', decimals: 1, theme: 'Economía', baseline: 'level' },
  { code: 'AG.LND.FRST.ZS', label: 'Superficie forestal', unit: '% del territorio', decimals: 1, theme: 'Naturaleza', baseline: 'trend' },
  { code: 'EN.ATM.PM25.MC.M3', label: 'Exposición media anual a PM2.5', unit: 'µg/m³', decimals: 1, theme: 'Salud', baseline: 'trend' },
]);

export function buildWorldBankUrl(iso2, code) {
  if (!/^[A-Za-z]{2}$/.test(iso2)) throw new RangeError(`Código de país inválido: ${iso2}`);
  if (!/^[A-Z0-9.]+$/.test(code)) throw new RangeError(`Indicador inválido: ${code}`);
  const params = new URLSearchParams({ format: 'json', per_page: '100', date: '1960:2030' });
  return `${WORLD_BANK}/country/${iso2.toUpperCase()}/indicator/${code}?${params}`;
}

export function parseWorldBank(json) {
  const rows = Array.isArray(json) ? json[1] : null;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => typeof r.value === 'number' && Number.isFinite(r.value))
    .map((r) => ({ year: Number(r.date), value: r.value }))
    .sort((a, b) => a.year - b.year);
}

export function parseCountry(json) {
  const code = json?.address?.country_code;
  if (!code || !/^[a-z]{2}$/i.test(code)) return null;
  return { name: json.address.country ?? code.toUpperCase(), iso2: code.toUpperCase() };
}

/**
 * Compares the event-year value with what the previous 15 years predicted.
 * status: 'ok' | 'missing' (year not published yet) | 'short' (baseline too thin).
 */
export function deviationFromBaseline(series, year, mode) {
  const event = series.find((r) => r.year === year);
  if (!event) return { status: 'missing', latestYear: series.at(-1)?.year ?? null };
  const prior = series.filter((r) => r.year >= year - BASELINE_YEARS && r.year < year);
  if (prior.length < MIN_BASELINE_POINTS) return { status: 'short' };

  let predict;
  if (mode === 'trend') {
    const fit = senSlope(prior.map((r) => r.year), prior.map((r) => r.value));
    predict = (y) => fit.intercept + fit.slope * y;
  } else {
    const level = median(prior.map((r) => r.value));
    predict = () => level;
  }
  const residuals = prior.map((r) => r.value - predict(r.year));
  const center = median(residuals);
  const expected = predict(year);
  // In-sample spread understates the error of an extrapolation: inflate it and floor it.
  const inSample = MAD_TO_SIGMA * median(residuals.map((r) => Math.abs(r - center)));
  const spread = Math.max(inSample * Math.sqrt(1 + 1 / prior.length), MIN_SPREAD_SHARE * Math.abs(expected));
  const deviation = event.value - expected;
  return {
    status: 'ok',
    actual: event.value,
    expected,
    deviation,
    deviationPct: expected !== 0 ? (deviation / Math.abs(expected)) * 100 : null,
    unusual: Math.abs(deviation) > UNUSUAL_SIGMAS * spread,
  };
}

// A one-year change this many times larger than the median change is suspicious.
const REVISION_FACTOR = 10;
// ...and it must also be at least this share of the level, to ignore near-flat noise.
const REVISION_MIN_SHARE = 0.01;

/**
 * Detects a single abrupt step typical of a methodological revision of the series
 * (the same "catalog bias" idea used for EONET). Returns the first such year or null.
 */
export function revisionJump(series) {
  if (series.length < MIN_BASELINE_POINTS) return null;
  // Only consecutive years: a change across a data gap is not "in one year".
  const diffs = series
    .slice(1)
    .map((r, k) => ({ year: r.year, change: r.value - series[k].value, gap: r.year - series[k].year }))
    .filter((d) => d.gap === 1)
    .map(({ year, change }) => ({ year, change }));
  if (diffs.length < MIN_BASELINE_POINTS - 1) return null;
  const level = Math.abs(median(series.map((r) => r.value)));
  // A perfectly flat series has typical = 0; floor it so float noise never counts.
  const typical = Math.max(median(diffs.map((d) => Math.abs(d.change))), 1e-3 * level);
  const jump = diffs.find(
    (d) =>
      Math.abs(d.change) > REVISION_FACTOR * typical &&
      Math.abs(d.change) > REVISION_MIN_SHARE * Math.abs(series.find((r) => r.year === d.year).value),
  );
  return jump ?? null;
}

async function getJson(url, signal, service) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`No se pudo contactar ${service}.`);
  }
  if (!res.ok) throw new Error(`${service} respondió con error ${res.status}`);
  return res.json();
}

const countryCache = new Map();
// Nominatim usage policy: at most one request per second.
const NOMINATIM_GAP_MS = 1100;
let nominatimQueue = Promise.resolve();

function throttledNominatim(url) {
  const run = nominatimQueue.then(() => getJson(url, undefined, 'el servicio de países'));
  nominatimQueue = run.catch(() => null).then(() => new Promise((r) => setTimeout(r, NOMINATIM_GAP_MS)));
  return run;
}

// Resolves with the shared promise unless this caller's own signal aborts first.
function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Country at a point (OpenStreetMap Nominatim; cached per ~1 km cell).
 * The shared request never inherits one caller's signal, so an aborted click
 * cannot poison the cache for the next one.
 */
export function fetchCountry(lat, lon, signal) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (!countryCache.has(key)) {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '3', 'accept-language': 'es' });
    const pending = throttledNominatim(`${NOMINATIM}?${params}`).then(parseCountry);
    pending.catch(() => countryCache.delete(key));
    countryCache.set(key, pending);
  }
  return withSignal(countryCache.get(key), signal);
}

export async function fetchIndicators(iso2, signal) {
  return Promise.all(
    INDICATORS.map(async (indicator) => {
      try {
        const series = parseWorldBank(await getJson(buildWorldBankUrl(iso2, indicator.code), signal, 'el Banco Mundial'));
        return { indicator, series, error: null };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        return { indicator, series: [], error: err.message };
      }
    }),
  );
}
