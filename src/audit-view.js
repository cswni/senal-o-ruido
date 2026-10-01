// Chapter 01: the naive claim, the auditor's verdict and the catalog case file.

import { auditSeries } from './audit.js';
import { stackedBars, legend } from './charts.js';
import {
  verdictCopy,
  naiveHeadline,
  breakSentence,
  auditConclusion,
  formatNumber,
} from './narrative.js';

const SERIES_SLOTS = 7;
const OTHER = '__other';
const NEW_SHARE_TO_REPORT = 0.3;

export const CATEGORY_LABELS = Object.freeze({
  wildfires: 'Incendios',
  severeStorms: 'Tormentas severas',
  volcanoes: 'Volcanes',
  floods: 'Inundaciones',
  seaLakeIce: 'Hielo marino y lacustre',
  drought: 'Sequía',
  dustHaze: 'Polvo y bruma',
  earthquakes: 'Sismos',
  landslides: 'Deslizamientos',
  manmade: 'Origen humano',
  snow: 'Nieve',
  tempExtremes: 'Temperaturas extremas',
  waterColor: 'Color del agua',
});

export const categoryLabel = (id, summary) => CATEGORY_LABELS[id] ?? summary.categories[id]?.title ?? id;

/** Color follows the source everywhere: global top sources get fixed slots. */
export function sourcePalette(summary) {
  const totals = {};
  for (const category of Object.values(summary.categories)) {
    for (const row of category.years) {
      for (const [id, n] of Object.entries(row.bySource)) totals[id] = (totals[id] ?? 0) + n;
    }
  }
  const ranked = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  return Object.fromEntries(ranked.slice(0, SERIES_SLOTS).map((id, k) => [id, `var(--series-${k + 1})`]));
}

// Stack segments are each source's share of the year's events, so the bar height equals the event count.
function stackRows(rows, palette) {
  return rows.map((row) => {
    const sourceSum = Object.values(row.bySource).reduce((a, b) => a + b, 0) || 1;
    const folded = {};
    for (const [id, n] of Object.entries(row.bySource)) {
      const key = palette[id] ? id : OTHER;
      folded[key] = (folded[key] ?? 0) + n;
    }
    const order = [...Object.keys(palette), OTHER];
    return {
      year: row.year,
      total: row.total,
      parts: order.filter((k) => folded[k]).map((key) => ({ key, value: (folded[key] / sourceSum) * row.total })),
    };
  });
}

function legendKeys(rows, palette, sources) {
  const present = new Set(rows.flatMap((r) => r.parts.map((p) => p.key)));
  const keys = Object.keys(palette)
    .filter((id) => present.has(id))
    .map((id) => ({ key: id, label: sources[id]?.title ?? id, color: palette[id] }));
  return present.has(OTHER) ? [...keys, { key: OTHER, label: 'Otras fuentes', color: 'var(--series-other)' }] : keys;
}

function renderTable(container, rows, sources) {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const h of ['Año', 'Eventos', 'Fuentes']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    tr.insertCell().textContent = String(row.year);
    tr.insertCell().textContent = formatNumber(row.total);
    tr.insertCell().textContent = Object.entries(row.bySource)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${sources[id]?.title ?? id} (${n})`)
      .join(', ');
  }
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  container.replaceChildren(wrap);
}

function renderStamp(node, copy) {
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  const glyph = document.createElement('span');
  glyph.textContent = copy.icon;
  icon.append(glyph);
  const text = document.createElement('span');
  text.textContent = copy.label;
  node.dataset.tone = copy.tone;
  node.replaceChildren(icon, text);
  // Restart the stamp animation on every verdict change.
  node.style.animation = 'none';
  void node.offsetWidth;
  node.style.animation = '';
}

function renderBreaks(list, audit, sources) {
  if (audit.breaks.length === 0) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'Sin cambios de fuentes detectados: el registro es comparable de punta a punta.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...audit.breaks.map((b) => {
      const li = document.createElement('li');
      li.textContent = breakSentence(b, sources);
      return li;
    }),
  );
}

function renderNewShare(node, audit) {
  if (audit.newSourceShare < NEW_SHARE_TO_REPORT) {
    node.replaceChildren();
    return;
  }
  const strong = document.createElement('strong');
  strong.textContent = `${Math.round(audit.newSourceShare * 100)} %`;
  const last = audit.segments.at(-1);
  node.replaceChildren(
    strong,
    document.createTextNode(`de los eventos de ${last.start}–${last.end} vienen de fuentes que no existían antes en esta categoría.`),
  );
}

/** Renders the whole chapter for one category. `dom` maps data-bind names to nodes. */
export function renderAudit(dom, { summary, categoryId, catalogBreaks, palette }) {
  const category = summary.categories[categoryId];
  const sources = summary.sources;
  const audit = auditSeries(category.years, {
    lastCompleteYear: summary.lastCompleteYear,
    catalogBreaks,
  });
  const copy = verdictCopy(audit.verdict);
  const title = categoryLabel(categoryId, summary);

  dom.naive.textContent = `“${naiveHeadline(audit, title)}”`;
  dom.naive.closest('.claim').classList.toggle('debunked', audit.verdict === 'artifact');
  renderStamp(dom.stamp, copy);
  dom['verdict-lead'].textContent = copy.lead;

  const rows = stackRows(category.years, palette);
  legend(dom.legend, legendKeys(rows, palette, sources));
  stackedBars(dom.bars, {
    rows,
    keys: legendKeys(rows, palette, sources),
    markers: audit.breaks.map((b) => ({ year: b.year })),
    highlight: audit.segment && {
      start: audit.segment.start,
      end: audit.segment.end,
      label: 'tramo comparable',
    },
    partialYear: audit.partialYear?.year,
  });
  renderTable(dom.table, category.years, sources);
  renderBreaks(dom.breaks, audit, sources);
  dom.conclusion.textContent = auditConclusion(audit);
  renderNewShare(dom['new-share'], audit);
  return audit;
}
