import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mannKendall,
  senSlope,
  median,
  normalCdf,
  percentileRank,
  pettitt,
} from '../src/stats.js';

const close = (actual, expected, tol = 1e-3) =>
  assert.ok(Math.abs(actual - expected) < tol, `${actual} not within ${tol} of ${expected}`);

test('normalCdf matches known quantiles', () => {
  close(normalCdf(0), 0.5, 1e-7);
  close(normalCdf(1.959964), 0.975, 1e-5);
  close(normalCdf(-1.644854), 0.05, 1e-5);
});

test('mannKendall detects a strictly increasing series as significant upward', () => {
  const result = mannKendall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(result.s, 45);
  close(result.varS, 125);
  close(result.z, 3.9355);
  assert.ok(result.p < 0.001);
  assert.equal(result.trend, 'up');
  assert.equal(result.significant, true);
});

test('mannKendall detects a decreasing series as downward', () => {
  const result = mannKendall([10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(result.trend, 'down');
  assert.equal(result.significant, true);
});

test('mannKendall applies tie correction to the variance', () => {
  const result = mannKendall([1, 2, 2, 3]);
  assert.equal(result.s, 5);
  close(result.varS, 138 / 18);
});

test('mannKendall reports no trend for a constant series', () => {
  const result = mannKendall([4, 4, 4, 4, 4, 4]);
  assert.equal(result.s, 0);
  assert.equal(result.p, 1);
  assert.equal(result.trend, 'none');
  assert.equal(result.significant, false);
});

test('mannKendall ignores missing values', () => {
  const result = mannKendall([1, null, 2, NaN, 3, 4, 5]);
  assert.equal(result.n, 5);
  assert.equal(result.s, 10);
});

test('mannKendall flags series too short to test', () => {
  const result = mannKendall([1, 2, 3]);
  assert.equal(result.trend, 'insufficient');
  assert.equal(result.significant, false);
});

test('mannKendall does not mark a noisy flat series as significant', () => {
  const result = mannKendall([5, 3, 6, 4, 5, 3, 6, 4, 5, 4, 6, 3]);
  assert.equal(result.significant, false);
});

test('median handles odd, even and empty inputs', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test('median does not mutate its input', () => {
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test('senSlope recovers the slope and intercept of a line', () => {
  const xs = [2000, 2001, 2002, 2003, 2004];
  const ys = xs.map((x) => 2 * (x - 2000) + 1);
  const result = senSlope(xs, ys);
  close(result.slope, 2);
  close(result.intercept + result.slope * 2000, 1);
});

test('senSlope is robust to a single outlier', () => {
  const xs = [0, 1, 2, 3, 4, 5, 6];
  const ys = [0, 1, 2, 300, 4, 5, 6];
  close(senSlope(xs, ys).slope, 1);
});

test('senSlope skips missing points', () => {
  const result = senSlope([0, 1, 2, 3], [0, null, 2, 3]);
  close(result.slope, 1);
  assert.equal(result.n, 3);
});

test('percentileRank places a value within a sample', () => {
  const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentileRank(0, sample), 0);
  assert.equal(percentileRank(11, sample), 100);
  assert.equal(percentileRank(5, sample), 45);
  assert.ok(Number.isNaN(percentileRank(5, [])));
});

test('pettitt locates a step change and reports it as significant', () => {
  const result = pettitt([10, 11, 9, 10, 12, 10, 30, 31, 29, 32, 30, 31]);
  assert.equal(result.index, 6);
  assert.ok(result.p < 0.05);
});

test('pettitt does not find a change in a noisy flat series', () => {
  const result = pettitt([5, 3, 6, 4, 5, 3, 6, 4, 5, 4, 6, 3]);
  assert.ok(result.p > 0.05);
});

test('pettitt handles too-short input', () => {
  const result = pettitt([1, 2]);
  assert.equal(result.index, -1);
  assert.ok(Number.isNaN(result.p));
});
