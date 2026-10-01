// EONET access: the prebuilt snapshot (fast, full history) plus a live feed
// for the most recent days. Shared by the browser app and the snapshot script.

export const EONET_API = 'https://eonet.gsfc.nasa.gov/api/v3';
const COORD_DECIMALS = 3;
const LIVE_DAYS = 30;

const round = (n) => Number(n.toFixed(COORD_DECIMALS));

// Representative point: the point itself, or the vertex average of a polygon's outer ring.
function firstCoordinate(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type !== 'Polygon') return null;
  const ring = geometry.coordinates[0] ?? [];
  const [first, last] = [ring[0], ring.at(-1)];
  const isClosed = ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  const vertices = isClosed ? ring.slice(0, -1) : ring;
  if (vertices.length === 0) return null;
  const avg = (k) => vertices.reduce((acc, v) => acc + v[k], 0) / vertices.length;
  return [avg(0), avg(1)];
}

/** Raw EONET event -> compact record { i, t, c, s, d, x, y, n, m, u, o } (or null). */
export function compactEvent(event) {
  const geometries = [...(event.geometry ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const first = geometries[0];
  const coord = first ? firstCoordinate(first) : null;
  if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
  const peak = geometries
    .filter((g) => g.magnitudeValue != null)
    .reduce((best, g) => (best == null || g.magnitudeValue > best.magnitudeValue ? g : best), null);
  return {
    i: event.id,
    t: event.title,
    c: event.categories.map((c) => c.id),
    s: event.sources.map((s) => s.id),
    d: first.date.slice(0, 10),
    x: round(coord[0]),
    y: round(coord[1]),
    n: geometries.length,
    m: peak ? peak.magnitudeValue : null,
    u: peak ? peak.magnitudeUnit : null,
    o: event.closed == null,
  };
}

async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`No se pudo descargar ${url}`);
  }
  if (!res.ok) throw new Error(`Error ${res.status} al descargar ${url}`);
  return res.json();
}

export const loadSummary = () => getJson('data/summary.json');

const eventCache = new Map();

/** Snapshot events of one year (cached per session). */
export function loadEvents(year) {
  if (!eventCache.has(year)) {
    const pending = getJson(`data/events/${year}.json`).catch((err) => {
      eventCache.delete(year);
      throw err;
    });
    eventCache.set(year, pending);
  }
  return eventCache.get(year);
}

/** Live events of the last days straight from EONET (for "what is happening now"). */
export async function fetchLiveEvents(category, signal) {
  const params = new URLSearchParams({ status: 'all', days: String(LIVE_DAYS), category });
  const { events } = await getJson(`${EONET_API}/events?${params}`, signal);
  return events.map(compactEvent).filter(Boolean);
}

export const eventUrl = (id) => `${EONET_API}/events/${encodeURIComponent(id)}`;
