import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAUNA_RADIUS_KM,
  THREATENED,
  buildGbifUrl,
  parseFacet,
  yearSeries,
  redListCounts,
  samplingAudit,
  spanishName,
} from '../src/fauna.js';

test('buildGbifUrl searches a radius around the point with quality filters', () => {
  const url = new URL(buildGbifUrl({ lat: 39.8, lon: -121.5, params: { facet: 'year' } }));
  assert.equal(url.hostname, 'api.gbif.org');
  assert.equal(url.searchParams.get('geoDistance'), `39.8,-121.5,${FAUNA_RADIUS_KM}km`);
  assert.equal(url.searchParams.get('hasCoordinate'), 'true');
  assert.equal(url.searchParams.get('hasGeospatialIssue'), 'false');
  assert.equal(url.searchParams.get('occurrenceStatus'), 'PRESENT');
  assert.equal(url.searchParams.get('limit'), '0');
  assert.equal(url.searchParams.get('facet'), 'year');
});

test('buildGbifUrl repeats array parameters', () => {
  const url = new URL(buildGbifUrl({ lat: 0, lon: 0, params: { iucnRedListCategory: THREATENED } }));
  assert.deepEqual(url.searchParams.getAll('iucnRedListCategory'), ['CR', 'EN', 'VU']);
});

test('buildGbifUrl rejects invalid coordinates', () => {
  assert.throws(() => buildGbifUrl({ lat: 0, lon: 190, params: {} }));
});

const sample = {
  count: 1000,
  facets: [
    { field: 'YEAR', counts: [{ name: '2021', count: 300 }, { name: '2019', count: 100 }, { name: '2026', count: 50 }] },
    { field: 'IUCN_RED_LIST_CATEGORY', counts: [{ name: 'LC', count: 800 }, { name: 'VU', count: 12 }, { name: 'EN', count: 3 }] },
  ],
};

test('parseFacet reads a facet by field name', () => {
  assert.deepEqual(parseFacet(sample, 'year').map((c) => c.name), ['2021', '2019', '2026']);
  assert.deepEqual(parseFacet(sample, 'speciesKey'), []);
});

test('yearSeries sorts years, fills gaps with zero and drops incomplete years', () => {
  assert.deepEqual(yearSeries(sample, 2025), [
    { year: 2019, value: 100 },
    { year: 2020, value: 0 },
    { year: 2021, value: 300 },
  ]);
});

test('redListCounts maps categories and totals the threatened ones', () => {
  const counts = redListCounts(sample);
  assert.equal(counts.VU, 12);
  assert.equal(counts.EN, 3);
  assert.equal(counts.CR, 0);
  assert.equal(counts.threatened, 15);
});

test('samplingAudit flags growing observation effort', () => {
  const series = Array.from({ length: 20 }, (_, k) => ({ year: 2006 + k, value: 100 + 50 * k }));
  const audit = samplingAudit(series);
  assert.equal(audit.effortGrowing, true);
  assert.ok(audit.recentShare > 0.5);
});

test('samplingAudit does not flag a flat record', () => {
  const values = [100, 90, 110, 95, 105, 100, 98, 102, 97, 103, 99, 101];
  const audit = samplingAudit(values.map((value, k) => ({ year: 2014 + k, value })));
  assert.equal(audit.effortGrowing, false);
  assert.equal(audit.effortDeclining, false);
});

test('samplingAudit flags falling observation effort', () => {
  const audit = samplingAudit(Array.from({ length: 15 }, (_, k) => ({ year: 2010 + k, value: 900 - 50 * k })));
  assert.equal(audit.effortDeclining, true);
});

test('spanishName prefers a Spanish vernacular name', () => {
  const names = { results: [{ vernacularName: 'California Bay', language: 'eng' }, { vernacularName: 'laurel de California', language: 'spa' }] };
  assert.equal(spanishName(names), 'Laurel de California');
  assert.equal(spanishName({ results: [] }), null);
});

test('spanishName strips quotes and keeps the first of several names', () => {
  const names = { results: [{ vernacularName: '"Patiamarillo Menor, Chorlo Chico"', language: 'spa' }] };
  assert.equal(spanishName(names), 'Patiamarillo Menor');
});
