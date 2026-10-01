// Smoke and air quality: hourly PM2.5 from the CAMS global model (Copernicus),
// served by Open-Meteo without a key. Global coverage starts in August 2022.

export const AIR_START_DATE = '2022-08-04';
/** WHO Air Quality Guideline 2021: 24-hour mean PM2.5 should not exceed 15 µg/m³. */
export const WHO_PM25_24H = 15;

const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MIN_HOURS_PER_DAY = 18;
const DAYS_BEFORE = 3;
const DAYS_AFTER = 10;
const DAY_MS = 86400000;

const isValid = (v) => typeof v === 'number' && Number.isFinite(v);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

export function buildAirUrl({ lat, lon, start, end }) {
  if (!isValid(lat) || lat < -90 || lat > 90) throw new RangeError(`Latitud inválida: ${lat}`);
  if (!isValid(lon) || lon < -180 || lon > 180) throw new RangeError(`Longitud inválida: ${lon}`);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'pm2_5',
    start_date: start,
    end_date: end,
    timezone: 'auto',
  });
  return `${AIR_URL}?${params}`;
}

export function parseAirHourly(json) {
  const times = json?.hourly?.time;
  const values = json?.hourly?.pm2_5;
  if (!Array.isArray(times) || !Array.isArray(values)) {
    throw new Error('Respuesta de calidad del aire sin datos horarios');
  }
  return times.map((time, k) => ({ time, value: isValid(values[k]) ? values[k] : null }));
}

/** Hourly -> daily means (local days), skipping days with fewer than 18 valid hours. */
export function dailyMeans(hourly) {
  const byDay = new Map();
  for (const { time, value } of hourly) {
    if (value == null) continue;
    const day = time.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), value]);
  }
  return [...byDay.entries()]
    .filter(([, values]) => values.length >= MIN_HOURS_PER_DAY)
    .map(([date, values]) => ({ date, value: values.reduce((a, b) => a + b, 0) / values.length }));
}

/** Days around the event start (3 before, 10 after), clipped to the data record. */
export function eventWindow(eventDate, today) {
  const end = minDate(addDays(eventDate, DAYS_AFTER), addDays(today, -1));
  const start = maxDate(addDays(eventDate, -DAYS_BEFORE), AIR_START_DATE);
  if (end < AIR_START_DATE || start > end) return null;
  return { start, end };
}

const medianOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Window vs WHO guideline and vs the place's usual (median) daily level outside the window. */
export function summarizeAir(days, window) {
  const inside = days.filter((d) => d.date >= window.start && d.date <= window.end);
  if (inside.length === 0) return null;
  const outside = days.filter((d) => d.date < window.start || d.date > window.end).map((d) => d.value);
  const peak = inside.reduce((best, d) => (d.value > best.value ? d : best));
  const usual = outside.length ? medianOf(outside) : null;
  return {
    windowDays: inside.length,
    exceedances: inside.filter((d) => d.value > WHO_PM25_24H).length,
    peak,
    usual,
    peakVsUsual: usual > 0 ? peak.value / usual : null,
    peakVsGuideline: peak.value / WHO_PM25_24H,
    // Without this, "exceeded the guideline" means little in already-polluted places.
    usualExceedanceShare: outside.length ? outside.filter((v) => v > WHO_PM25_24H).length / outside.length : null,
    inside,
  };
}

/**
 * How alarming the window is. A large jump over a very clean baseline that stays
 * within the WHO guideline is "high", never "very high".
 */
export function airBand(summary) {
  const { value } = summary.peak;
  const ratio = summary.peakVsUsual ?? 1;
  if (value > 2 * WHO_PM25_24H || (value > WHO_PM25_24H && ratio >= 3)) return 'very-high';
  if (value > WHO_PM25_24H || (ratio >= 2 && value > 0.5 * WHO_PM25_24H)) return 'high';
  return 'normal';
}

export async function fetchAirDaily({ lat, lon, today, signal }) {
  const url = buildAirUrl({ lat, lon, start: AIR_START_DATE, end: addDays(today, -1) });
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('No se pudo contactar el servicio de calidad del aire.');
  }
  if (!res.ok) throw new Error(`El servicio de calidad del aire respondió con error ${res.status}`);
  return dailyMeans(parseAirHourly(await res.json()));
}
