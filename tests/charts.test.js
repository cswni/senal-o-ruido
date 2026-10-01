import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, tickDecimals } from '../src/charts.js';

test('niceTicks always reaches at least the maximum value', () => {
  for (const [min, max] of [[0, 17.3], [0, 7520], [0, 64.3], [12.4, 31.7], [0.21, 0.68]]) {
    const ticks = niceTicks(min, max, 3);
    assert.ok(ticks.at(-1) >= max, `${ticks} does not cover ${max}`);
    assert.ok(ticks[0] <= min, `${ticks} does not cover ${min}`);
  }
});

test('niceTicks does not add an extra tick when the maximum is already round', () => {
  assert.deepEqual(niceTicks(0, 100, 4), [0, 25, 50, 75, 100]);
});

test('tickDecimals prints every step exactly', () => {
  assert.equal(tickDecimals([0, 1000, 2000]), 0);
  assert.equal(tickDecimals([0, 2.5, 5]), 1);
  assert.equal(tickDecimals([38.5, 39, 39.5]), 1);
  assert.equal(tickDecimals([0.2, 0.25, 0.3]), 2);
});
