// Chapter 02: map of EONET events on NASA GIBS imagery, and the per-place case file
// built from 45 years of NASA POWER measurements.

import {
  PARAMETERS,
  POWER_START_DATE,
  fetchPowerDaily,
  annualSeries,
  windowSeries,
  anomalyOf,
  trendOf,
  dayBefore,
} from './power.js';
import { strip, trendLine } from './charts.js';
import { anomalySentence, trendSentence, formatNumber } from './narrative.js';
import { eventUrl } from './eonet.js';

const WINDOW_DAYS = 90;
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search';
const BAND_LABELS = Object.freeze({
  'very-high': 'Muy por encima',
  high: 'Por encima',
  normal: 'Habitual',
  low: 'Por debajo',
  'very-low': 'Muy por debajo',
});
const MARKER = Object.freeze({ radius: 5, weight: 1, color: '#fff', fillColor: '#eb6834', fillOpacity: 0.85 });
const MARKER_SELECTED = Object.freeze({ radius: 9, weight: 3, color: '#fff', fillColor: '#1c3faa', fillOpacity: 1 });

export function createMap(node, onPick) {
  const map = L.map(node, { preferCanvas: true, worldCopyJump: true, minZoom: 1, maxZoom: 10 }).setView([20, -20], 2);
  L.tileLayer(`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, {
    maxNativeZoom: 8,
    attribution: 'Imágenes: NASA GIBS / Blue Marble',
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  // Leaflet only measures its container once; keep it in sync with layout changes.
  new ResizeObserver(() => map.invalidateSize()).observe(node);
  let selected = null;
  let pin = null;

  const deselect = () => {
    selected?.setStyle(MARKER);
    selected = null;
  };

  map.on('click', (e) => {
    deselect();
    onPick({ kind: 'place', lat: e.latlng.lat, lon: L.Util.wrapNum(e.latlng.lng, [-180, 180], true) });
  });

  return {
    showEvents(events) {
      layer.clearLayers();
      selected = null;
      for (const event of events) {
        const marker = L.circleMarker([event.y, event.x], { ...MARKER, bubblingMouseEvents: false });
        // Leaflet writes string tooltips with innerHTML; feed titles are untrusted, so pass a text node.
        marker.bindTooltip(document.createTextNode(`${event.t} · ${event.d}`));
        marker.on('click', () => {
          deselect();
          pin?.remove();
          marker.setStyle(MARKER_SELECTED).bringToFront();
          selected = marker;
          onPick({ kind: 'event', event });
        });
        layer.addLayer(marker);
      }
    },
    clear() {
      layer.clearLayers();
      selected = null;
    },
    showPlace(lat, lon) {
      deselect();
      pin?.remove();
      pin = L.circleMarker([lat, lon], { ...MARKER_SELECTED, bubblingMouseEvents: false }).addTo(map);
    },
    flyTo(lat, lon) {
      map.flyTo([lat, lon], Math.max(map.getZoom(), 6), { duration: 0.8 });
    },
  };
}

/** Place search through the Open-Meteo geocoder (no key, CORS enabled). */
export async function geocode(query, signal) {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const params = new URLSearchParams({ name: q, count: '5', language: 'es', format: 'json' });
  const res = await fetch(`${GEOCODER}?${params}`, { signal });
  if (!res.ok) throw new Error('El buscador de lugares no respondió');
  const { results = [] } = await res.json();
  return results
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
    }));
}

const node = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
};

const fmtCoord = (lat, lon) =>
  `${formatNumber(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}, ${formatNumber(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'O'}`;

function header(target, categoryName, sources) {
  const frag = document.createDocumentFragment();
  if (target.kind === 'event') {
    const e = target.event;
    frag.append(node('p', 'case-kicker', `Evento EONET · ${categoryName}`), node('h3', null, e.t));
    const meta = node('p', 'case-meta');
    meta.append(
      node('span', null, `Inicio: ${e.d}`),
      node('span', null, fmtCoord(e.y, e.x)),
      node('span', null, `Fuentes: ${e.s.map((id) => sources[id]?.title ?? id).join(', ')}`),
    );
    if (e.m != null) meta.append(node('span', null, `Magnitud máx.: ${formatNumber(e.m, 0)} ${e.u ?? ''}`));
    const link = node('a', null, 'Ver en EONET');
    link.href = eventUrl(e.i);
    link.rel = 'noopener';
    link.target = '_blank';
    meta.append(link);
    frag.append(meta);
  } else {
    frag.append(node('p', 'case-kicker', 'Lugar'), node('h3', null, target.name ?? fmtCoord(target.lat, target.lon)));
    frag.append(node('p', 'case-meta', `${fmtCoord(target.lat, target.lon)} · últimos ${WINDOW_DAYS} días disponibles frente a 45 años`));
  }
  return frag;
}

function loading() {
  const wrap = node('div');
  wrap.append(node('p', 'case-kicker', 'Consultando NASA POWER (1981–hoy)…'));
  for (let k = 0; k < 6; k += 1) wrap.append(node('div', 'skeleton'));
  return wrap;
}

const lastValidDate = (rows, param) => [...rows].reverse().find((r) => r[param] != null)?.date;

const POWER_LATENCY_DAYS = 14;

// Explains why there is no anomaly instead of always blaming publication lag.
function missingAnomalyMessage(anomaly, eventYear, rows) {
  if (anomaly && !anomaly.reliable) {
    return `Hay menos de 10 años de datos antes de ${eventYear}; no alcanza para decir si fue anómalo.`;
  }
  const lastDate = rows.at(-1)?.date ?? '';
  const recent = Date.parse(lastDate) - Date.parse(`${eventYear}-01-01`) < 400 * 86400000;
  return recent
    ? `NASA POWER publica con unos ${POWER_LATENCY_DAYS} días de retraso; esta ventana aún no tiene datos completos.`
    : 'NASA POWER no tiene datos suficientes de esta variable para este punto (p. ej. océano o hielo).';
}

function paramBlock(param, rows, windowEnd, lead) {
  const meta = PARAMETERS[param];
  const block = node('section', 'measure-block');
  const title = node('h4', null, meta.label);
  block.append(title);

  const eventYear = Number(windowEnd.slice(0, 4));
  const series = windowSeries(rows, param, windowEnd.slice(5), WINDOW_DAYS, meta.window);
  const anomaly = anomalyOf(series, eventYear);
  if (anomaly && anomaly.reliable) {
    const tag = node('span', 'band-tag', BAND_LABELS[anomaly.band]);
    tag.dataset.band = anomaly.band;
    title.append(tag);
    block.append(node('p', null, anomalySentence(meta, anomaly, lead)));
    const chart = node('div', 'chart-box');
    block.append(chart);
    strip(chart, {
      values: series.filter((r) => r.year < eventYear),
      event: { year: eventYear, value: anomaly.value },
      decimals: meta.decimals,
      unit: meta.unit,
    });
  } else {
    block.append(node('p', 'trend-note', missingAnomalyMessage(anomaly, eventYear, rows)));
  }

  const annual = annualSeries(rows, param, meta.annual);
  if (annual.length >= 8) {
    const trend = trendOf(annual);
    block.append(node('p', 'trend-note', trendSentence(meta, trend)));
    const chart = node('div', 'chart-box');
    block.append(chart);
    trendLine(chart, {
      points: annual.map((r) => ({ x: r.year, y: r.value })),
      fit: trend.sen,
      decimals: meta.decimals,
      unit: meta.unit,
      eventX: eventYear,
    });
  }
  return { block, anomaly };
}

/** Fetches POWER for the target and fills the case file. Throws AbortError if superseded. */
export async function renderCase(container, target, { categoryName, sources, signal }) {
  const lat = target.kind === 'event' ? target.event.y : target.lat;
  const lon = target.kind === 'event' ? target.event.x : target.lon;
  container.replaceChildren(header(target, categoryName, sources), loading());

  let rows;
  try {
    rows = await fetchPowerDaily({ lat, lon, start: POWER_START_DATE, end: new Date().toISOString().slice(0, 10), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    container.replaceChildren(header(target, categoryName, sources), node('p', 'error', err.message));
    return;
  }

  const windowEnd = target.kind === 'event' ? dayBefore(target.event.d) : lastValidDate(rows, 'T2M_MAX');
  if (!windowEnd || windowEnd < '1981-04-01') {
    container.replaceChildren(header(target, categoryName, sources), node('p', 'error', 'No hay datos de NASA POWER para este lugar y fecha.'));
    return;
  }
  const lead =
    target.kind === 'event'
      ? `En los ${WINDOW_DAYS} días previos al evento`
      : `En los últimos ${WINDOW_DAYS} días con datos (hasta el ${windowEnd})`;
  const blocks = Object.keys(PARAMETERS).map((param) => paramBlock(param, rows, windowEnd, lead));
  container.replaceChildren(header(target, categoryName, sources), ...blocks.map((b) => b.block));
}
