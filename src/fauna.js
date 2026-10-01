// Wildlife exposure from GBIF (Global Biodiversity Information Facility).
// This measures what lives near the event (exposure), not what was lost.
// GBIF records are observations: they grow with observers and apps, so the
// same "catalog bias" check used for EONET is applied to them.

import { mannKendall } from './stats.js';

export const FAUNA_RADIUS_KM = 25;
export const THREATENED = Object.freeze(['CR', 'EN', 'VU']);
export const RED_LIST_LABELS = Object.freeze({
  CR: 'En peligro crítico',
  EN: 'En peligro',
  VU: 'Vulnerable',
});
const GBIF_API = 'https://api.gbif.org/v1';
const AUDIT_YEARS = 20;
const RECENT_YEARS = 10;
const TOP_SPECIES = 8;

const isValid = (v) => typeof v === 'number' && Number.isFinite(v);

export function buildGbifUrl({ lat, lon, params }) {
  if (!isValid(lat) || lat < -90 || lat > 90) throw new RangeError(`Latitud inválida: ${lat}`);
  if (!isValid(lon) || lon < -180 || lon > 180) throw new RangeError(`Longitud inválida: ${lon}`);
  const search = new URLSearchParams({
    geoDistance: `${lat},${lon},${FAUNA_RADIUS_KM}km`,
    hasCoordinate: 'true',
    hasGeospatialIssue: 'false',
    occurrenceStatus: 'PRESENT',
    limit: '0',
  });
  for (const [key, value] of Object.entries(params)) {
    for (const v of [value].flat()) search.append(key, String(v));
  }
  return `${GBIF_API}/occurrence/search?${search}`;
}

export function parseFacet(json, field) {
  const wanted = field.replace(/([A-Z])/g, '_$1').toUpperCase();
  return json?.facets?.find((f) => f.field === wanted)?.counts ?? [];
}

/** Records per year, gap-filled with zeros, up to the last complete year. */
export function yearSeries(json, lastCompleteYear) {
  const counts = new Map(parseFacet(json, 'year').map((c) => [Number(c.name), c.count]));
  const years = [...counts.keys()].filter((y) => y <= lastCompleteYear);
  if (years.length === 0) return [];
  const first = Math.min(...years);
  const last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, k) => ({
    year: first + k,
    value: counts.get(first + k) ?? 0,
  }));
}

export function redListCounts(json) {
  const counts = Object.fromEntries(parseFacet(json, 'iucnRedListCategory').map((c) => [c.name, c.count]));
  const result = Object.fromEntries(THREATENED.map((k) => [k, counts[k] ?? 0]));
  return { ...result, threatened: THREATENED.reduce((acc, k) => acc + result[k], 0) };
}

/** Is observation effort growing? (more records per year ≠ more wildlife) */
export function samplingAudit(series) {
  const recent = series.slice(-AUDIT_YEARS);
  const mk = mannKendall(recent.map((r) => r.value));
  const total = recent.reduce((acc, r) => acc + r.value, 0);
  const lastTen = recent.slice(-RECENT_YEARS).reduce((acc, r) => acc + r.value, 0);
  return {
    mk,
    effortGrowing: mk.significant && mk.trend === 'up',
    effortDeclining: mk.significant && mk.trend === 'down',
    recentShare: total ? lastTen / total : 0,
    recentYears: RECENT_YEARS,
  };
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function spanishName(vernacular) {
  const match = vernacular?.results?.find((r) => r.language === 'spa');
  if (!match) return null;
  // Some sources pack several quoted names into one string: keep the first.
  const first = match.vernacularName.replace(/^["'\s]+|["'\s]+$/g, '').split(',')[0].trim();
  return first ? capitalize(first) : null;
}

async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('No se pudo contactar GBIF.');
  }
  if (!res.ok) throw new Error(`GBIF respondió con error ${res.status}`);
  return res.json();
}

async function describeSpecies(key, records, signal) {
  const base = `${GBIF_API}/species/${encodeURIComponent(key)}`;
  // Names and red-list status are nice-to-have: a failure there must not drop the species.
  const optional = (url) => getJson(url, signal).catch((err) => (err.name === 'AbortError' ? Promise.reject(err) : null));
  const [species, vernacular, redList] = await Promise.all([
    getJson(base, signal),
    optional(`${base}/vernacularNames?limit=100`),
    optional(`${base}/iucnRedListCategory`),
  ]);
  return {
    key,
    records,
    scientific: species.canonicalName ?? species.scientificName ?? String(key),
    common: spanishName(vernacular),
    group: species.class ?? species.phylum ?? species.kingdom ?? '',
    redList: THREATENED.includes(redList?.code) ? redList.code : null,
    // false only when GBIF answered and the species' own status is not threatened.
    statusConfirmed: redList == null || THREATENED.includes(redList.code),
    url: `https://www.gbif.org/species/${encodeURIComponent(key)}`,
  };
}

/** Everything the wildlife card needs: totals, red list, sampling audit and top threatened species. */
export async function fetchFaunaExposure({ lat, lon, lastCompleteYear, signal }) {
  const [overview, threatened] = await Promise.all([
    getJson(buildGbifUrl({ lat, lon, params: { facet: ['year', 'iucnRedListCategory'], 'year.facetLimit': 200 } }), signal),
    getJson(
      buildGbifUrl({
        lat,
        lon,
        params: { iucnRedListCategory: THREATENED, facet: 'speciesKey', 'speciesKey.facetLimit': TOP_SPECIES },
      }),
      signal,
    ),
  ]);
  const top = parseFacet(threatened, 'speciesKey');
  // One failing species lookup must not sink the card; drop only species whose own
  // red-list record contradicts the occurrence filter.
  const settled = await Promise.allSettled(top.map((c) => describeSpecies(c.name, c.count, signal)));
  if (settled.some((r) => r.status === 'rejected' && r.reason?.name === 'AbortError')) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const species = settled.filter((r) => r.status === 'fulfilled' && r.value.statusConfirmed).map((r) => r.value);
  const series = yearSeries(overview, lastCompleteYear);
  return {
    total: overview.count ?? 0,
    redList: redListCounts(overview),
    series,
    audit: series.length >= 4 ? samplingAudit(series) : null,
    species,
  };
}
