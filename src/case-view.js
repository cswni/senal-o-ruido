// The case file for an event or place: an impact chain across three time
// horizons. Every card loads independently and carries its evidence level.

import { POWER_START_DATE, fetchPowerDaily, dayBefore } from './power.js';
import { withHeatIndex } from './heat.js';
import { fetchAirDaily, eventWindow, summarizeAir } from './air.js';
import { fetchFaunaExposure } from './fauna.js';
import { fetchCountry, fetchIndicators } from './context.js';
import { eventUrl } from './eonet.js';
import { EVIDENCE, HORIZONS } from './impact-narrative.js';
import { WINDOW_DAYS, heatCard, airCard, airUnavailable, waterCard, faunaCard, trendsCard, contextCard } from './impact-cards.js';
import { formatNumber } from './narrative.js';
import { node, link, fmtCoord, skeleton } from './dom.js';

const PLACE_AIR_DAYS = 14;
// EONET magnitude units in readable Spanish.
const UNIT_LABELS = Object.freeze({ hectare: 'ha', acres: 'acres', kts: 'nudos', 'NM^2': 'mn²' });
const DAY_MS = 86400000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

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
    if (e.m != null) meta.append(node('span', null, `Magnitud máx.: ${formatNumber(e.m, e.m < 10 ? 1 : 0)} ${UNIT_LABELS[e.u] ?? e.u ?? ''}`));
    meta.append(link('Ver en EONET', eventUrl(e.i)));
    frag.append(meta);
  } else {
    frag.append(node('p', 'case-kicker', 'Lugar'), node('h3', null, target.name ?? fmtCoord(target.lat, target.lon)));
    frag.append(node('p', 'case-meta', `${fmtCoord(target.lat, target.lon)} · condiciones recientes frente a 45 años`));
  }
  return frag;
}

function evidenceLegend() {
  const details = node('details', 'evidence-legend');
  details.append(node('summary', null, '¿Qué significan las etiquetas de evidencia?'));
  const list = node('dl');
  for (const [key, level] of Object.entries(EVIDENCE)) {
    const term = node('dt');
    const badge = node('span', 'evidence-badge', level.label);
    badge.dataset.evidence = key;
    term.append(badge);
    list.append(term, node('dd', null, level.explain));
  }
  details.append(list);
  return details;
}

function card(evidence, source) {
  const article = node('article', 'impact-card');
  article.dataset.evidence = evidence;
  const top = node('header', 'card-top');
  const badge = node('span', 'evidence-badge', EVIDENCE[evidence].label);
  badge.dataset.evidence = evidence;
  badge.title = EVIDENCE[evidence].explain;
  top.append(badge, node('span', 'card-source', source));
  const body = node('div', 'card-body');
  body.append(skeleton(3));
  article.append(top, body);
  return { article, body };
}

function horizon(key, cards) {
  const section = node('section', 'horizon');
  section.dataset.horizon = key;
  const head = node('h3', 'horizon-head', HORIZONS[key].label);
  head.append(node('span', 'horizon-span', ` · ${HORIZONS[key].span}`));
  section.append(head, ...cards.map((c) => c.article));
  return section;
}

// Runs one card's work; failures stay inside the card, aborts are silent.
async function fill(c, work) {
  try {
    c.body.replaceChildren(await work());
  } catch (err) {
    if (err.name === 'AbortError') return;
    c.body.replaceChildren(node('p', 'error', err.message));
  }
}

const lastValidDate = (rows, param) => [...rows].reverse().find((r) => r[param] != null)?.date;

function airTask(target, lat, lon, today, signal) {
  const window =
    target.kind === 'event'
      ? eventWindow(target.event.d, today)
      : { start: addDays(today, -PLACE_AIR_DAYS), end: addDays(today, -1) };
  if (!window) return async () => airUnavailable('La serie global de calidad del aire empieza en agosto de 2022; este evento es anterior.');
  const lead =
    target.kind === 'event'
      ? `Del ${window.start} al ${window.end} (3 días antes a 10 días después del inicio).`
      : `Últimos ${PLACE_AIR_DAYS} días.`;
  return async () => airCard(summarizeAir(await fetchAirDaily({ lat, lon, today, signal }), window), { lead });
}

async function contextTask(lat, lon, eventYear, signal) {
  const country = await fetchCountry(lat, lon, signal);
  if (!country) return node('p', 'trend-note', 'Este punto no está dentro de un país (por ejemplo, en el océano).');
  return contextCard(country, await fetchIndicators(country.iso2, signal), eventYear);
}

/** Fills `container` with the impact chain for an event or a place. */
export async function renderCase(container, target, { categoryName, sources, signal, lastCompleteYear }) {
  const lat = target.kind === 'event' ? target.event.y : target.lat;
  const lon = target.kind === 'event' ? target.event.x : target.lon;
  const today = new Date().toISOString().slice(0, 10);
  const eventYear = target.kind === 'event' ? Number(target.event.d.slice(0, 4)) : null;

  const cards = {
    heat: card('measured', 'NASA POWER (reanálisis ~50 km) · índice de calor NOAA'),
    air: card('model', 'CAMS (Copernicus) vía Open-Meteo · guía OMS 2021'),
    water: card('measured', 'NASA POWER'),
    fauna: card('exposure', 'GBIF · Lista Roja de la UICN'),
    trends: card('measured', 'NASA POWER, 1981–hoy'),
    context: card('context', 'Banco Mundial · país según OpenStreetMap'),
  };
  container.replaceChildren(
    header(target, categoryName, sources),
    evidenceLegend(),
    horizon('immediate', [cards.heat, cards.air]),
    horizon('short', [cards.water, cards.fauna]),
    horizon('long', [cards.trends, cards.context]),
    node('p', 'health-note', 'Los indicadores de salud son de riesgo a nivel población, basados en umbrales de NOAA y la OMS. No son un diagnóstico ni un consejo médico individual.'),
  );

  const power = fetchPowerDaily({ lat, lon, start: POWER_START_DATE, end: today, signal }).then(withHeatIndex);
  const powerContext = power.then((rows) => {
    const windowEnd = target.kind === 'event' ? dayBefore(target.event.d) : lastValidDate(rows, 'T2M_MAX');
    if (!windowEnd || windowEnd < '1981-04-01') throw new Error('No hay datos de NASA POWER para este lugar y fecha.');
    const lead =
      target.kind === 'event'
        ? `En los ${WINDOW_DAYS} días previos al evento`
        : `En los últimos ${WINDOW_DAYS} días con datos (hasta el ${windowEnd})`;
    const when = target.kind === 'event' ? 'antes del evento' : 'en este periodo';
    return { rows, windowEnd, lead, when };
  });
  // Avoid an unhandled rejection when every consumer is aborted at once.
  powerContext.catch(() => {});

  await Promise.all([
    fill(cards.heat, async () => {
      const { rows, ...ctx } = await powerContext;
      return heatCard(rows, ctx);
    }),
    fill(cards.water, async () => {
      const { rows, ...ctx } = await powerContext;
      return waterCard(rows, ctx);
    }),
    fill(cards.trends, async () => trendsCard((await powerContext).rows, { eventYear })),
    fill(cards.air, airTask(target, lat, lon, today, signal)),
    fill(cards.fauna, async () => faunaCard(await fetchFaunaExposure({ lat, lon, lastCompleteYear, signal }))),
    fill(cards.context, () => contextTask(lat, lon, eventYear, signal)),
  ]);
}
