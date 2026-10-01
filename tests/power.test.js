import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPowerUrl,
  parsePowerDaily,
  annualSeries,
  windowSeries,
  anomalyOf,
  trendOf,
  dayBefore,
} from '../src/power.js';

// Daily rows from start to end (inclusive) with value = fn(date).
function dailyRows(start, end, fn) {
  const rows = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); ) {
    const date = d.toISOString().slice(0, 10);
    rows.push({ date, X: fn(date) });
    d = new Date(d.getTime() + 86400000);
  }
  return rows;
}

test('buildPowerUrl builds a daily point request', () => {
  const url = new URL(buildPowerUrl({ lat: 38.7, lon: -120.5, start: '1981-01-01', end: '2026-09-20' }));
  assert.equal(url.hostname, 'power.larc.nasa.gov');
  assert.equal(url.searchParams.get('latitude'), '38.7');
  assert.equal(url.searchParams.get('longitude'), '-120.5');
  assert.equal(url.searchParams.get('start'), '19810101');
  assert.equal(url.searchParams.get('end'), '20260920');
  assert.ok(url.searchParams.get('parameters').includes('GWETROOT'));
  assert.ok(url.searchParams.get('parameters').includes('QV2M'));
  assert.ok(url.searchParams.get('parameters').includes('PS'));
});

test('buildPowerUrl rejects coordinates out of range', () => {
  assert.throws(() => buildPowerUrl({ lat: 95, lon: 0, start: '2000-01-01', end: '2000-01-02' }));
  assert.throws(() => buildPowerUrl({ lat: 0, lon: 200, start: '2000-01-01', end: '2000-01-02' }));
  assert.throws(() => buildPowerUrl({ lat: NaN, lon: 0, start: '2000-01-01', end: '2000-01-02' }));
});

test('parsePowerDaily turns fill values into null and keys into ISO dates', () => {
  const json = {
    properties: {
      parameter: {
        T2M_MAX: { 20200101: 10.5, 20200102: -999 },
        PRECTOTCORR: { 20200101: 1.2, 20200102: 0 },
      },
    },
  };
  assert.deepEqual(parsePowerDaily(json), [
    { date: '2020-01-01', T2M_MAX: 10.5, PRECTOTCORR: 1.2 },
    { date: '2020-01-02', T2M_MAX: null, PRECTOTCORR: 0 },
  ]);
});

test('parsePowerDaily rejects a response without parameters', () => {
  assert.throws(() => parsePowerDaily({ detail: 'error' }), /POWER/);
});

test('annualSeries averages or sums complete years only', () => {
  const rows = dailyRows('2001-01-01', '2002-06-30', (d) => (d.startsWith('2001') ? 2 : 4));
  assert.deepEqual(annualSeries(rows, 'X', 'mean'), [{ year: 2001, value: 2, coverage: 1 }]);
  assert.equal(annualSeries(rows, 'X', 'sum')[0].value, 730);
});

test('annualSeries drops a year whose data stops before 31 December', () => {
  const rows = dailyRows('2001-01-01', '2002-12-10', () => 1);
  assert.deepEqual(annualSeries(rows, 'X', 'mean').map((r) => r.year), [2001]);
});

test('annualSeries scales sums when a few days are missing', () => {
  const rows = dailyRows('2001-01-01', '2001-12-31', (d) => (d.endsWith('-01') ? null : 1));
  const [row] = annualSeries(rows, 'X', 'sum');
  assert.ok(Math.abs(row.value - 365) < 1e-9);
  assert.ok(row.coverage < 1);
});

test('windowSeries aggregates the same calendar window in every year', () => {
  const rows = dailyRows('2001-01-01', '2003-12-31', (d) => Number(d.slice(0, 4)) - 2000);
  const series = windowSeries(rows, 'X', '03-15', 10, 'sum');
  assert.deepEqual(
    series.map((r) => [r.year, r.value]),
    [
      [2001, 10],
      [2002, 20],
      [2003, 30],
    ],
  );
});

test('windowSeries clamps Feb 29 to Feb 28 in non-leap years', () => {
  const rows = dailyRows('2003-01-01', '2004-12-31', () => 1);
  const series = windowSeries(rows, 'X', '02-29', 5, 'mean');
  assert.deepEqual(series.map((r) => r.year), [2003, 2004]);
  assert.equal(series[0].end, '2003-02-28');
});

test('windowSeries drops windows with too little data', () => {
  const rows = dailyRows('2001-01-01', '2001-12-31', (d) => (d >= '2001-03-10' ? null : 1));
  assert.deepEqual(windowSeries(rows, 'X', '03-15', 10, 'mean'), []);
});

test('anomalyOf ranks the event year only against earlier years', () => {
  const series = [2001, 2002, 2003, 2004, 2005, 2006].map((year, k) => ({ year, value: k + 1 }));
  const result = anomalyOf([...series, { year: 2007, value: 0 }, { year: 2008, value: 99 }], 2007);
  assert.equal(result.value, 0);
  assert.equal(result.baseline.length, 6);
  assert.equal(result.percentile, 0);
  assert.equal(result.band, 'very-low');
  assert.ok(result.z < -1);
});

test('anomalyOf returns null when the event year has no data', () => {
  assert.equal(anomalyOf([{ year: 2001, value: 1 }], 2005), null);
});

test('trendOf reports Sen slope per decade with significance', () => {
  const series = Array.from({ length: 30 }, (_, k) => ({ year: 1990 + k, value: 10 + 0.03 * k }));
  const trend = trendOf(series);
  assert.ok(Math.abs(trend.perDecade - 0.3) < 1e-9);
  assert.equal(trend.mk.trend, 'up');
  assert.equal(trend.start, 1990);
  assert.equal(trend.end, 2019);
});

test('dayBefore steps back across month and year boundaries', () => {
  assert.equal(dayBefore('2024-03-01'), '2024-02-29');
  assert.equal(dayBefore('2025-01-01'), '2024-12-31');
});
