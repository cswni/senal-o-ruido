import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeHumidityAt,
  heatIndexF,
  heatIndexC,
  heatCategory,
  withHeatIndex,
  HOT_THRESHOLD_C,
  DANGER_THRESHOLD_C,
} from '../src/heat.js';

const close = (actual, expected, tol) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);

test('heatIndexF matches the NWS heat index table', () => {
  close(heatIndexF(90, 50), 95, 1);
  close(heatIndexF(100, 40), 109, 1);
  close(heatIndexF(86, 90), 105, 1.5);
});

test('heatIndexF uses the simple formula below 80 °F', () => {
  close(heatIndexF(70, 50), 69.05, 0.01);
});

test('heatIndexF applies the low-humidity adjustment', () => {
  const adjusted = heatIndexF(100, 10);
  assert.ok(adjusted < 100, `expected below air temperature, got ${adjusted}`);
});

test('heatIndexC converts both ways', () => {
  close(heatIndexC(32.2222, 50), (95 - 32) / 1.8, 0.6);
});

test('relativeHumidityAt derives RH at Tmax from specific humidity and pressure', () => {
  close(relativeHumidityAt(41.5, 9.98, 95.58), 19.1, 0.3);
  close(relativeHumidityAt(20, 14.7, 101.3), 100, 0.5);
});

test('relativeHumidityAt clamps to 0–100 and rejects missing inputs', () => {
  assert.equal(relativeHumidityAt(5, 30, 101.3), 100);
  assert.equal(relativeHumidityAt(null, 10, 100), null);
});

test('heatCategory follows NOAA thresholds', () => {
  assert.equal(heatCategory(25), 'none');
  assert.equal(heatCategory(27), 'caution');
  assert.equal(heatCategory(33), 'extreme-caution');
  assert.equal(heatCategory(40), 'danger');
  assert.equal(heatCategory(52), 'extreme-danger');
  assert.equal(heatCategory(null), null);
});

test('withHeatIndex adds HI and a hot-day flag without mutating rows', () => {
  const rows = [
    { date: '2024-07-15', T2M_MAX: 41.5, QV2M: 9.98, PS: 95.58 },
    { date: '2024-01-15', T2M_MAX: 18, QV2M: 3, PS: 95.5 },
    { date: '2024-01-16', T2M_MAX: null, QV2M: 3, PS: 95.5 },
  ];
  const snapshot = JSON.stringify(rows);
  const out = withHeatIndex(rows);
  assert.equal(JSON.stringify(rows), snapshot);
  assert.ok(out[0].HI >= HOT_THRESHOLD_C);
  assert.equal(out[0].HOT, 1);
  assert.equal(out[1].HOT, 0);
  assert.equal(out[0].DANGER, out[0].HI >= DANGER_THRESHOLD_C ? 1 : 0);
  assert.equal(out[1].DANGER, 0);
  assert.equal(out[2].DANGER, null);
  assert.equal(out[2].HI, null);
  assert.equal(out[2].HOT, null);
});
