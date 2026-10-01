// Entry point: loads the snapshot and wires both chapters together.

import { loadSummary, loadEvents } from './eonet.js';
import { catalogBreakYears } from './audit.js';
import { renderAudit, sourcePalette, categoryLabel } from './audit-view.js';
import { createMap, renderCase, geocode } from './measure-view.js';
import { formatNumber } from './narrative.js';

const DEFAULT_CATEGORY = 'wildfires';
const MAP_DEFAULT_CATEGORY = 'wildfires';
const MAP_DEFAULT_YEAR = 2024;
// Categories with too few events to be worth a chip of their own are still listed, just last.
const MIN_EVENTS_FOR_PROMINENCE = 100;

const dom = Object.fromEntries(
  [...document.querySelectorAll('[data-bind]')].map((n) => [n.dataset.bind, n]),
);

let caseController = null;
let mapRequest = 0;
let searchController = null;

function totalEvents(category) {
  return category.years.reduce((acc, r) => acc + r.total, 0);
}

function renderChips(summary, onSelect, selected) {
  const ids = Object.keys(summary.categories).sort(
    (a, b) => totalEvents(summary.categories[b]) - totalEvents(summary.categories[a]),
  );
  dom.categories.replaceChildren(
    ...ids.map((id) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(id === selected));
      chip.dataset.category = id;
      chip.textContent = categoryLabel(id, summary);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = formatNumber(totalEvents(summary.categories[id]));
      chip.append(count);
      if (totalEvents(summary.categories[id]) < MIN_EVENTS_FOR_PROMINENCE) chip.classList.add('minor');
      chip.addEventListener('click', () => onSelect(id));
      return chip;
    }),
  );
}

function fillSelect(select, options, selected) {
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = label;
      opt.selected = String(value) === String(selected);
      return opt;
    }),
  );
}

async function openCase(target, summary, mapApi) {
  caseController?.abort();
  caseController = new AbortController();
  if (target.kind === 'place') mapApi.showPlace(target.lat, target.lon);
  const categoryId = target.kind === 'event' ? target.event.c[0] : null;
  try {
    await renderCase(dom.case, target, {
      categoryName: categoryId ? categoryLabel(categoryId, summary) : '',
      sources: summary.sources,
      signal: caseController.signal,
    });
  } catch (err) {
    if (err.name !== 'AbortError') {
      dom.case.textContent = `No se pudo abrir el expediente: ${err.message}`;
    }
  }
}

async function refreshMap(summary, mapApi) {
  const year = Number(dom['map-year'].value);
  const category = dom['map-category'].value;
  const request = ++mapRequest;
  dom['map-status'].textContent = `Cargando eventos de ${year}…`;
  try {
    const events = (await loadEvents(year)).filter((e) => e.c.includes(category));
    // A newer selection started while this one loaded: let it win.
    if (request !== mapRequest) return;
    mapApi.showEvents(events);
    const partial = year > summary.lastCompleteYear ? ' (año en curso)' : '';
    dom['map-status'].textContent =
      `${formatNumber(events.length)} eventos de ${categoryLabel(category, summary).toLowerCase()} en ${year}${partial}.`;
  } catch (err) {
    if (request !== mapRequest) return;
    mapApi.clear();
    dom['map-status'].textContent = `No se pudieron cargar los eventos: ${err.message}`;
  }
}

function setupSearch(summary, mapApi) {
  dom['place-form'].addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const query = new FormData(dom['place-form']).get('q') ?? '';
    searchController?.abort();
    searchController = new AbortController();
    try {
      const results = await geocode(String(query), searchController.signal);
      if (results.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Sin resultados';
        li.style.padding = '0.5rem 0.65rem';
        dom['place-results'].replaceChildren(li);
        return;
      }
      dom['place-results'].replaceChildren(
        ...results.map((place) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = place.name;
          btn.addEventListener('click', () => {
            dom['place-results'].replaceChildren();
            mapApi.flyTo(place.lat, place.lon);
            openCase({ kind: 'place', ...place }, summary, mapApi);
          });
          li.append(btn);
          return li;
        }),
      );
    } catch (err) {
      if (err.name !== 'AbortError') dom['map-status'].textContent = err.message;
    }
  });
}

async function main() {
  let summary;
  try {
    summary = await loadSummary();
  } catch (err) {
    dom.naive.textContent = 'No se pudo cargar el snapshot de EONET. Ejecuta "npm run snapshot".';
    return;
  }
  const catalogBreaks = catalogBreakYears(summary.categories, { lastCompleteYear: summary.lastCompleteYear });
  const palette = sourcePalette(summary);

  dom.range.textContent = `${summary.firstYear}–${summary.lastYear}`;
  dom.snapshot.textContent =
    `Snapshot de EONET generado el ${summary.generatedAt.slice(0, 10)}. ` +
    `El año ${summary.lastYear} está incompleto y se excluye de las pruebas de tendencia.`;

  const selectCategory = (id) => {
    renderChips(summary, selectCategory, id);
    renderAudit(dom, { summary, categoryId: id, catalogBreaks, palette });
  };
  selectCategory(DEFAULT_CATEGORY);

  const mapApi = createMap(document.getElementById('map'), (target) => openCase(target, summary, mapApi));
  const mapCategories = Object.keys(summary.categories)
    .filter((id) => totalEvents(summary.categories[id]) > 0)
    .map((id) => [id, categoryLabel(id, summary)]);
  fillSelect(dom['map-category'], mapCategories, MAP_DEFAULT_CATEGORY);
  fillSelect(
    dom['map-year'],
    [...summary.eventYears].reverse().map((y) => [y, String(y)]),
    MAP_DEFAULT_YEAR,
  );
  dom['map-category'].addEventListener('change', () => refreshMap(summary, mapApi));
  dom['map-year'].addEventListener('change', () => refreshMap(summary, mapApi));
  setupSearch(summary, mapApi);
  refreshMap(summary, mapApi);
}

main();
