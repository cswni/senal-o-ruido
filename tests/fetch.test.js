// Network wrappers, tested against a fake fetch (no real requests).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCountry, fetchIndicators, INDICATORS } from '../src/context.js';
import { fetchFaunaExposure } from '../src/fauna.js';
import { fetchAirDaily } from '../src/air.js';
import { fetchPowerDaily } from '../src/power.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** Routes requests by the first matching URL substring; `delay` simulates a slow server. */
function mockFetch(routes, { delay = 0 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (delay) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
    const route = routes.find(([match]) => String(url).includes(match));
    if (!route) throw new TypeError(`unexpected URL ${url}`);
    return typeof route[1] === 'function' ? route[1](String(url)) : route[1];
  };
  return calls;
}

test('fetchCountry: an aborted first click does not poison the cache for the next one', async () => {
  const calls = mockFetch([['nominatim', json({ address: { country: 'Canadá', country_code: 'ca' } })]], { delay: 30 });
  const first = new AbortController();
  const pendingA = fetchCountry(59.52, -122.37, first.signal);
  first.abort();
  await assert.rejects(pendingA, { name: 'AbortError' });
  const country = await fetchCountry(59.52, -122.37, new AbortController().signal);
  assert.deepEqual(country, { name: 'Canadá', iso2: 'CA' });
  assert.equal(calls.length, 1, 'the shared request is reused, not repeated');
});

test('fetchCountry returns null over the ocean and surfaces service errors', async () => {
  mockFetch([['lat=0.5', json({ error: 'Unable to geocode' })], ['lat=1.5', json({}, 503)]]);
  assert.equal(await fetchCountry(0.5, -30.5), null);
  await assert.rejects(fetchCountry(1.5, -30.5), /503/);
});

test('fetchIndicators keeps going when one indicator fails', async () => {
  mockFetch([
    ['NY.GDP', json({}, 500)],
    ['worldbank', json([{ page: 1 }, [{ date: '2020', value: 1.5 }, { date: '2019', value: 2 }]])],
  ]);
  const results = await fetchIndicators('MX');
  assert.equal(results.length, INDICATORS.length);
  const gdp = results.find((r) => r.indicator.code === 'NY.GDP.MKTP.KD.ZG');
  assert.match(gdp.error, /500/);
  const life = results.find((r) => r.indicator.code === 'SP.DYN.LE00.IN');
  assert.deepEqual(life.series, [{ year: 2019, value: 2 }, { year: 2020, value: 1.5 }]);
});

const overview = json({
  count: 500,
  facets: [
    { field: 'YEAR', counts: [{ name: '2024', count: 300 }, { name: '2023', count: 150 }, { name: '2022', count: 50 }, { name: '2021', count: 10 }] },
    { field: 'IUCN_RED_LIST_CATEGORY', counts: [{ name: 'EN', count: 4 }, { name: 'VU', count: 6 }] },
  ],
});
const threatened = json({ count: 10, facets: [{ field: 'SPECIES_KEY', counts: [{ name: '1', count: 6 }, { name: '2', count: 3 }, { name: '3', count: 1 }] }] });

test('fetchFaunaExposure survives a failing species lookup and drops contradicted statuses', async () => {
  mockFetch([
    ['iucnRedListCategory=CR', threatened],
    ['occurrence/search', overview],
    ['species/1/vernacularNames', json({ results: [{ language: 'spa', vernacularName: 'tortuga' }] })],
    ['species/1/iucnRedListCategory', json({ code: 'VU' })],
    ['species/1', json({ canonicalName: 'Actinemys marmorata', class: 'Testudines' })],
    ['species/2', json({}, 500)],
    ['species/3/iucnRedListCategory', json({ code: 'LC' })],
    ['species/3', json({ canonicalName: 'Hibiscus rosa-sinensis' })],
  ]);
  const f = await fetchFaunaExposure({ lat: 20, lon: -89, lastCompleteYear: 2025 });
  assert.equal(f.total, 500);
  assert.equal(f.redList.threatened, 10);
  assert.deepEqual(f.species.map((s) => s.common), ['Tortuga']);
  assert.equal(f.species[0].redList, 'VU');
  assert.equal(f.series.length, 4);
  assert.ok(f.audit);
});

test('fetchFaunaExposure propagates an abort', async () => {
  mockFetch([['gbif', overview]], { delay: 30 });
  const controller = new AbortController();
  const pending = fetchFaunaExposure({ lat: 20, lon: -89, lastCompleteYear: 2025, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('fetchAirDaily turns hourly PM2.5 into daily means', async () => {
  const time = Array.from({ length: 24 }, (_, h) => `2023-06-07T${String(h).padStart(2, '0')}:00`);
  mockFetch([['air-quality', json({ hourly: { time, pm2_5: Array(24).fill(40) } })]]);
  assert.deepEqual(await fetchAirDaily({ lat: 40.7, lon: -74, today: '2026-09-30' }), [{ date: '2023-06-07', value: 40 }]);
});

test('fetchAirDaily reports HTTP and network errors in Spanish', async () => {
  mockFetch([['air-quality', json({}, 429)]]);
  await assert.rejects(fetchAirDaily({ lat: 1, lon: 1, today: '2026-09-30' }), /429/);
  globalThis.fetch = async () => {
    throw new TypeError('network down');
  };
  await assert.rejects(fetchAirDaily({ lat: 1, lon: 1, today: '2026-09-30' }), /No se pudo contactar/);
});

test('fetchPowerDaily parses the response and reports errors', async () => {
  mockFetch([['power.larc', json({ properties: { parameter: { T2M_MAX: { 20240101: 20 }, QV2M: { 20240101: 5 } } } })]]);
  const rows = await fetchPowerDaily({ lat: 1, lon: 1, start: '2024-01-01', end: '2024-01-01' });
  assert.deepEqual(rows, [{ date: '2024-01-01', T2M_MAX: 20, QV2M: 5 }]);
  mockFetch([['power.larc', json({}, 500)]]);
  await assert.rejects(fetchPowerDaily({ lat: 1, lon: 1, start: '2024-01-01', end: '2024-01-01' }), /500/);
});
