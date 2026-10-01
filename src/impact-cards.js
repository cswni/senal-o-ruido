// Body renderers for each impact card. Each takes already-fetched data and
// returns a DOM fragment; fetching, loading and errors live in case-view.js.

import { PARAMETERS, windowSeries, anomalyOf, annualSeries, trendOf } from './power.js';
import { HEAT_CATEGORY_LABELS, heatCategory } from './heat.js';
import { WHO_PM25_24H, airBand } from './air.js';
import { FAUNA_RADIUS_KM, RED_LIST_LABELS } from './fauna.js';
import { deviationFromBaseline, revisionJump } from './context.js';
import { strip, trendLine, dailyBars } from './charts.js';
import { anomalySentence, trendSentence, formatNumber, formatSigned } from './narrative.js';
import {
  HEAT_HEALTH_EFFECTS,
  heatWindowSentence,
  heatTrendSentence,
  airSentence,
  faunaSentence,
  samplingSentence,
  contextSentence,
  groupName,
  revisionSentence,
} from './impact-narrative.js';
import { median } from './stats.js';
import { node, link, bandTag, chartBox } from './dom.js';

export const WINDOW_DAYS = 90;
const POWER_LATENCY_DAYS = 14;
const MIN_TREND_YEARS = 8;
const CONTEXT_YEARS_SHOWN = 35;
const DAY_MS = 86400000;

export const BAND_LABELS = Object.freeze({
  'very-high': 'Muy por encima',
  high: 'Por encima',
  normal: 'Habitual',
  low: 'Por debajo',
  'very-low': 'Muy por debajo',
});

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function fragment(...children) {
  const frag = document.createDocumentFragment();
  frag.append(...children.filter(Boolean));
  return frag;
}

// Explains why there is no anomaly instead of always blaming publication lag.
function missingAnomalyMessage(anomaly, eventYear, rows) {
  if (anomaly && !anomaly.reliable) {
    return `Hay menos de 10 años de datos antes de ${eventYear}; no alcanza para decir si fue anómalo.`;
  }
  const lastDate = rows.at(-1)?.date ?? '';
  const recent = Date.parse(lastDate) - Date.parse(`${eventYear}-01-01`) < 400 * DAY_MS;
  return recent
    ? `NASA POWER publica con unos ${POWER_LATENCY_DAYS} días de retraso; esta ventana aún no tiene datos completos.`
    : 'NASA POWER no tiene datos suficientes de esta variable para este punto (p. ej. océano o hielo).';
}

function anomalyBlock(title, series, eventYear, decimals, unit, sentence) {
  const anomaly = anomalyOf(series, eventYear);
  const head = node('h4', null, title);
  if (!anomaly?.reliable) return { anomaly, el: fragment(head) };
  head.append(bandTag(BAND_LABELS[anomaly.band], anomaly.band));
  const chart = chartBox();
  strip(chart, { values: series.filter((r) => r.year < eventYear), event: { year: eventYear, value: anomaly.value }, decimals, unit });
  return { anomaly, el: fragment(head, node('p', null, sentence(anomaly)), chart) };
}

// Danger days when the place ever reaches them; otherwise extreme-caution days.
function pickHeatMetric(rows, monthDay, eventYear) {
  const danger = windowSeries(rows, 'DANGER', monthDay, WINDOW_DAYS, 'sum');
  const dangerAnomaly = anomalyOf(danger, eventYear);
  if (dangerAnomaly && (dangerAnomaly.value > 0 || median(dangerAnomaly.baseline) >= 1)) return { metric: 'DANGER', series: danger };
  return { metric: 'HOT', series: windowSeries(rows, 'HOT', monthDay, WINDOW_DAYS, 'sum') };
}

/** Immediate · health: heat index days in the window and the hottest day. */
export function heatCard(rows, { windowEnd, lead }) {
  const eventYear = Number(windowEnd.slice(0, 4));
  const { metric, series } = pickHeatMetric(rows, windowEnd.slice(5), eventYear);
  const block = anomalyBlock('Días de calor peligroso', series, eventYear, 0, 'días', (a) => heatWindowSentence({ metric, anomaly: a, lead }));
  if (!block.anomaly?.reliable) return fragment(block.el, node('p', 'trend-note', missingAnomalyMessage(block.anomaly, eventYear, rows)));
  const neverHot = metric === 'HOT' && block.anomaly.value === 0 && block.anomaly.baseline.every((v) => v === 0);

  const start = addDays(windowEnd, -(WINDOW_DAYS - 1));
  const hottest = rows
    .filter((r) => r.date >= start && r.date <= windowEnd && r.HI != null)
    .reduce((best, r) => (best == null || r.HI > best.HI ? r : best), null);
  const category = hottest ? heatCategory(hottest.HI) : null;
  const effect = HEAT_HEALTH_EFFECTS[category] ? ` Según NOAA: ${HEAT_HEALTH_EFFECTS[category].toLowerCase()}` : '';
  const peakText = hottest ? `Índice de calor máximo: ${formatNumber(hottest.HI, 1)} °C el ${hottest.date} (${HEAT_CATEGORY_LABELS[category]}).${effect}` : null;
  if (neverHot) {
    return fragment(
      node('h4', null, 'Días de calor peligroso'),
      node('p', null, `Este lugar no alcanza niveles de calor de riesgo en esta época del año: ningún día con índice de calor ≥ 32,2 °C en esta ventana ni en los años anteriores.${hottest ? ` Máximo: ${formatNumber(hottest.HI, 1)} °C.` : ''}`),
    );
  }
  return fragment(block.el, peakText ? node('p', 'impact-callout', peakText) : null);
}

/** Immediate · health: smoke / PM2.5 around the event. */
export function airCard(summary, { lead }) {
  if (!summary) return fragment(node('p', 'trend-note', 'No hay datos de PM2.5 para esa ventana.'));
  const chart = chartBox();
  dailyBars(chart, { days: summary.inside, threshold: WHO_PM25_24H, thresholdLabel: 'Guía OMS 24 h', unit: 'µg/m³' });
  const head = node('h4', null, 'Humo y calidad del aire');
  const band = airBand(summary);
  head.append(bandTag(BAND_LABELS[band], band));
  return fragment(head, node('p', 'trend-note', lead), node('p', null, airSentence(summary)), chart);
}

export function airUnavailable(reason) {
  return fragment(node('h4', null, 'Humo y calidad del aire'), node('p', 'trend-note', reason));
}

/** Short term · water and soil: rain, soil moisture and max temperature before the event. */
export function waterCard(rows, { windowEnd, lead, when }) {
  const eventYear = Number(windowEnd.slice(0, 4));
  const blocks = ['PRECTOTCORR', 'GWETROOT', 'T2M_MAX'].map((param) => {
    const meta = PARAMETERS[param];
    const series = windowSeries(rows, param, windowEnd.slice(5), WINDOW_DAYS, meta.window);
    const block = anomalyBlock(meta.label, series, eventYear, meta.decimals, meta.unit, (a) => anomalySentence(meta, a, lead));
    return block.anomaly?.reliable ? { ...block, param } : { ...block, param, el: fragment(block.el, node('p', 'trend-note', missingAnomalyMessage(block.anomaly, eventYear, rows))) };
  });
  const dry = blocks.filter((b) => ['PRECTOTCORR', 'GWETROOT'].includes(b.param) && ['low', 'very-low'].includes(b.anomaly?.band));
  const stress = dry.length
    ? node('p', 'impact-callout', `Señal de estrés hídrico: lluvia o humedad del suelo por debajo de lo habitual ${when}. Eso suele afectar cultivos y vegetación y aumenta el combustible disponible para incendios.`)
    : null;
  return fragment(stress, ...blocks.map((b) => b.el));
}

/** Short term · biodiversity exposed (GBIF). */
export function faunaCard(f) {
  const list = node('ul', 'species-list');
  for (const s of f.species) {
    const li = node('li');
    const name = node('span', 'species-name');
    name.append(link(s.common ?? s.scientific, s.url));
    const sci = node('em', 'species-sci', s.common ? s.scientific : '');
    const meta = node('span', 'species-meta', [groupName(s.group), s.redList ? RED_LIST_LABELS[s.redList] : null, `${formatNumber(s.records)} registros`].filter(Boolean).join(' · '));
    li.append(name, sci, meta);
    list.append(li);
  }
  return fragment(
    node('h4', null, 'Biodiversidad expuesta (fauna y flora)'),
    node('p', null, faunaSentence(f, FAUNA_RADIUS_KM)),
    f.species.length ? node('p', 'mini-head', 'Especies amenazadas con más registros') : null,
    f.species.length ? list : null,
    node('p', 'trend-note', samplingSentence(f.audit)),
  );
}

function trendChart(series, fit, decimals, unit, eventYear) {
  const chart = chartBox();
  trendLine(chart, { points: series.map((r) => ({ x: r.year, y: r.value })), fit, decimals, unit, eventX: eventYear, height: 120 });
  return chart;
}

/** Long term · trends at the point (heat days and the three climate variables). */
export function trendsCard(rows, { eventYear }) {
  const parts = [];
  const danger = annualSeries(rows, 'DANGER', 'sum');
  const metric = danger.some((r) => r.value > 0) ? 'DANGER' : 'HOT';
  const heat = metric === 'DANGER' ? danger : annualSeries(rows, 'HOT', 'sum');
  if (heat.length >= MIN_TREND_YEARS && heat.every((r) => r.value === 0)) {
    parts.push(node('h4', null, 'Calor peligroso para la salud'), node('p', 'trend-note', 'Sin días de calor de riesgo (índice ≥ 32,2 °C) en todo el registro desde 1981.'));
  } else if (heat.length >= MIN_TREND_YEARS) {
    const trend = trendOf(heat);
    parts.push(node('h4', null, 'Calor peligroso para la salud'), node('p', null, heatTrendSentence(metric, trend)), trendChart(heat, trend.sen, 0, 'días', eventYear));
  }
  for (const param of ['T2M_MAX', 'PRECTOTCORR', 'GWETROOT']) {
    const meta = PARAMETERS[param];
    const annual = annualSeries(rows, param, meta.annual);
    if (annual.length < MIN_TREND_YEARS) continue;
    const trend = trendOf(annual);
    parts.push(node('h4', null, meta.label), node('p', 'trend-note', trendSentence(meta, trend)), trendChart(annual, trend.sen, meta.decimals, meta.unit, eventYear));
  }
  return parts.length ? fragment(...parts) : fragment(node('p', 'trend-note', 'No hay suficientes años completos para medir tendencias.'));
}

function contextRow({ indicator, series, error }, eventYear) {
  const row = node('section', 'context-row');
  const head = node('h4', null, indicator.label);
  head.append(node('span', 'theme-tag', indicator.theme));
  row.append(head);
  if (error || series.length === 0) {
    row.append(node('p', 'trend-note', error ?? 'Sin datos del Banco Mundial para este país.'));
    return row;
  }
  const year = eventYear ?? series.at(-1).year;
  const dev = deviationFromBaseline(series, year, indicator.baseline);
  if (dev.status === 'ok') head.append(bandTag(dev.unusual ? 'Fuera de lo habitual' : 'Habitual', dev.unusual ? 'very-high' : 'normal'));
  row.append(node('p', null, contextSentence(indicator, year, dev)));
  const jump = revisionJump(series);
  if (jump) row.append(node('p', 'impact-callout', revisionSentence(indicator, jump)));
  const recent = series.slice(-CONTEXT_YEARS_SHOWN);
  if (recent.length >= MIN_TREND_YEARS) {
    const trend = trendOf(recent);
    row.append(
      node('p', 'trend-note', `Tendencia ${trend.start}–${trend.end}: ${formatSigned(trend.perDecade, indicator.decimals)} ${indicator.unit} por década (${trend.mk.significant ? 'significativa' : 'no significativa'}).`),
      trendChart(recent, trend.sen, indicator.decimals, indicator.unit, year),
    );
  }
  return row;
}

/** Long term · national context (World Bank). */
export function contextCard(country, results, eventYear) {
  return fragment(
    node('h4', null, `${country.name}: economía, alimentación, calidad de vida y naturaleza`),
    node('p', 'impact-callout', 'Coincidencia, no causalidad: un solo evento casi nunca mueve un indicador nacional. Si un año sale fuera de lo habitual, puede deberse a otras causas que coinciden (en 2020, por ejemplo, la pandemia).'),
    ...results.map((r) => contextRow(r, eventYear)),
  );
}
