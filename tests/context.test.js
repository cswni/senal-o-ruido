import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDICATORS,
  buildWorldBankUrl,
  parseWorldBank,
  parseCountry,
  deviationFromBaseline,
  revisionJump,
} from '../src/context.js';

test('every indicator declares how its baseline is built', () => {
  for (const ind of INDICATORS) {
    assert.ok(['trend', 'level'].includes(ind.baseline), ind.code);
    assert.ok(ind.label && ind.theme, ind.code);
  }
});

test('buildWorldBankUrl requests one indicator for one country as JSON', () => {
  const url = new URL(buildWorldBankUrl('mx', 'SP.DYN.LE00.IN'));
  assert.equal(url.hostname, 'api.worldbank.org');
  assert.equal(url.pathname, '/v2/country/MX/indicator/SP.DYN.LE00.IN');
  assert.equal(url.searchParams.get('format'), 'json');
});

test('buildWorldBankUrl rejects anything that is not an ISO2 code', () => {
  assert.throws(() => buildWorldBankUrl('mex', 'SP.DYN.LE00.IN'));
  assert.throws(() => buildWorldBankUrl('m/', 'SP.DYN.LE00.IN'));
});

test('parseWorldBank returns ascending years and skips nulls', () => {
  const json = [
    { page: 1 },
    [
      { date: '2022', value: 75.1 },
      { date: '2021', value: null },
      { date: '2020', value: 74.2 },
    ],
  ];
  assert.deepEqual(parseWorldBank(json), [
    { year: 2020, value: 74.2 },
    { year: 2022, value: 75.1 },
  ]);
  assert.deepEqual(parseWorldBank([{ message: [{ key: 'Invalid' }] }]), []);
});

test('parseCountry reads a Nominatim reverse response', () => {
  assert.deepEqual(parseCountry({ address: { country: 'México', country_code: 'mx' } }), { name: 'México', iso2: 'MX' });
  assert.equal(parseCountry({ error: 'Unable to geocode' }), null);
});

const linear = Array.from({ length: 20 }, (_, k) => ({ year: 2000 + k, value: 50 + k }));

test('deviationFromBaseline extrapolates the prior trend for trending indicators', () => {
  const series = [...linear.slice(0, 19), { year: 2019, value: 69 }];
  const result = deviationFromBaseline(series, 2019, 'trend');
  assert.equal(result.status, 'ok');
  assert.ok(Math.abs(result.expected - 69) < 1e-9);
  assert.ok(Math.abs(result.deviation) < 1e-9);
  assert.equal(result.unusual, false);
});

test('deviationFromBaseline marks a value far outside the usual spread as unusual', () => {
  const noisy = linear.map((r, k) => ({ ...r, value: r.value + (k % 2 ? 0.3 : -0.3) }));
  const series = [...noisy.slice(0, 19), { year: 2019, value: 60 }];
  const result = deviationFromBaseline(series, 2019, 'trend');
  assert.ok(result.deviation < -5);
  assert.equal(result.unusual, true);
});

test('deviationFromBaseline uses the prior median for level indicators', () => {
  const series = [2, 3, 2.5, 3.5, 2, 3, 2.5, 3, 2.5, 3, -6].map((value, k) => ({ year: 2010 + k, value }));
  const result = deviationFromBaseline(series, 2020, 'level');
  assert.equal(result.expected, 2.75);
  assert.equal(result.unusual, true);
});

test('deviationFromBaseline does not flag tiny deviations on very smooth series', () => {
  const series = [...linear.slice(0, 19), { year: 2019, value: 69.1 }];
  assert.equal(deviationFromBaseline(series, 2019, 'trend').unusual, false);
});

test('deviationFromBaseline needs at least 10 baseline years', () => {
  const series = linear.slice(0, 10);
  assert.equal(deviationFromBaseline(series, 2009, 'trend').status, 'short');
});

test('deviationFromBaseline reports a year that is not published yet', () => {
  const result = deviationFromBaseline(linear, 2024, 'trend');
  assert.equal(result.status, 'missing');
  assert.equal(result.latestYear, 2019);
});

test('revisionJump flags a one-year step far beyond the usual year-to-year change', () => {
  const smooth = Array.from({ length: 30 }, (_, k) => ({ year: 1990 + k, value: 38.7 - 0.01 * k }));
  const revised = smooth.map((r) => (r.year >= 2015 ? { ...r, value: r.value + 1.2 } : r));
  assert.deepEqual(revisionJump(revised), { year: 2015, change: revised[25].value - smooth[24].value });
});

test('revisionJump only compares consecutive years', () => {
  const gappy = Array.from({ length: 20 }, (_, k) => ({ year: 1990 + k, value: 50 + 0.1 * k })).filter((r) => r.year !== 2000);
  const withGap = gappy.map((r) => (r.year > 2000 ? { ...r, value: r.value + 0.05 } : r));
  assert.equal(revisionJump(withGap), null);
});

test('revisionJump ignores ordinary volatility', () => {
  const gdp = [2.1, 3.0, -0.5, 4.2, 2.8, 1.9, 3.5, -2.6, 2.2, 3.1, 2.4, 1.0].map((value, k) => ({ year: 2010 + k, value }));
  assert.equal(revisionJump(gdp), null);
  assert.equal(revisionJump([{ year: 2020, value: 1 }]), null);
});

test('deviationFromBaseline refuses a baseline that is too short', () => {
  const series = [{ year: 2018, value: 1 }, { year: 2019, value: 2 }, { year: 2020, value: 3 }];
  assert.equal(deviationFromBaseline(series, 2020, 'trend').status, 'short');
});
