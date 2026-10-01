import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compositionDistance,
  detectBreaks,
  auditSeries,
  catalogBreakYears,
} from '../src/audit.js';

// Builds yearly rows from a map of { sourceId: [counts per year] }.
function rows(startYear, bySourceCounts) {
  const length = Object.values(bySourceCounts)[0].length;
  return Array.from({ length }, (_, k) => {
    const bySource = {};
    for (const [id, counts] of Object.entries(bySourceCounts)) {
      if (counts[k] > 0) bySource[id] = counts[k];
    }
    const total = Object.values(bySource).reduce((a, b) => a + b, 0);
    return { year: startYear + k, total, bySource };
  });
}

const NOISY_FLAT = [20, 18, 22, 19, 21, 20, 23, 17, 20, 22, 19, 21, 18, 22, 20, 21, 19, 20, 22, 18];

test('compositionDistance is 0 for identical mixes and 1 for disjoint ones', () => {
  assert.equal(compositionDistance({ A: 10 }, { A: 30 }), 0);
  assert.equal(compositionDistance({ A: 10 }, { B: 10 }), 1);
  assert.equal(compositionDistance({ A: 5, B: 5 }, { A: 10 }), 0.5);
});

test('compositionDistance treats empty years explicitly', () => {
  assert.equal(compositionDistance({}, {}), 0);
  assert.equal(compositionDistance({}, { A: 3 }), 1);
});

test('detectBreaks finds the year a new dominant source enters', () => {
  const series = rows(2000, {
    A: [...Array(10).fill(20)],
    B: [0, 0, 0, 0, 0, 0, 400, 450, 500, 480],
  });
  const breaks = detectBreaks(series);
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].year, 2006);
  assert.deepEqual(breaks[0].entering, ['B']);
});

test('detectBreaks flags a volume jump within an existing source', () => {
  const series = rows(2000, { A: [30, 32, 29, 31, 300, 310] });
  const breaks = detectBreaks(series);
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].year, 2004);
  assert.equal(breaks[0].kind, 'volume');
});

test('detectBreaks flags coverage onset from near zero', () => {
  const series = rows(2000, { A: [0, 1, 0, 1, 150, 160, 170] });
  const breaks = detectBreaks(series);
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].year, 2004);
  assert.equal(breaks[0].kind, 'onset');
});

test('detectBreaks ignores composition noise in tiny years', () => {
  const series = rows(2000, { A: [1, 0, 2, 0, 1], B: [0, 1, 0, 2, 0] });
  assert.equal(detectBreaks(series).length, 0);
});

test('auditSeries labels a source-driven explosion as a catalog artifact', () => {
  const series = rows(2000, {
    A: NOISY_FLAT,
    B: [...Array(17).fill(0), 3000, 3200, 3500],
  });
  const audit = auditSeries(series);
  assert.equal(audit.naive.claimsTrend, true);
  assert.equal(audit.naive.direction, 'up');
  assert.ok(audit.naive.changePct > 1000);
  assert.equal(audit.segment.start, 2000);
  assert.equal(audit.segment.end, 2016);
  assert.equal(audit.segment.mk.significant, false);
  assert.equal(audit.verdict, 'artifact');
  assert.ok(audit.newSourceShare > 0.95);
});

test('auditSeries confirms a real trend when the source mix is stable', () => {
  const series = rows(2000, { A: NOISY_FLAT.map((v, k) => v + 2 * k) });
  const audit = auditSeries(series);
  assert.equal(audit.breaks.length, 0);
  assert.equal(audit.verdict, 'real');
  assert.equal(audit.segment.mk.trend, 'up');
  assert.ok(audit.segment.sen.slope > 1);
});

test('auditSeries reports a stable series as having no significant trend', () => {
  const audit = auditSeries(rows(2000, { A: NOISY_FLAT }));
  assert.equal(audit.verdict, 'stable');
});

test('auditSeries refuses to judge when no comparable stretch is long enough', () => {
  const series = rows(2000, {
    A: [20, 21, 19, 0, 0, 0, 0, 0, 0, 0],
    B: [0, 0, 0, 30, 29, 31, 0, 0, 0, 0],
    C: [0, 0, 0, 0, 0, 0, 20, 21, 19, 20],
  });
  const audit = auditSeries(series);
  assert.equal(audit.verdict, 'insufficient');
  assert.equal(audit.segment, null);
});

test('auditSeries excludes years after the last complete year', () => {
  const series = rows(2000, { A: [...NOISY_FLAT, 5] });
  const audit = auditSeries(series, { lastCompleteYear: 2019 });
  assert.equal(audit.analysisYears.at(-1).year, 2019);
  assert.equal(audit.partialYear.year, 2020);
});

test('auditSeries treats a steady significant naive trend as a claim too', () => {
  const series = rows(2000, { A: NOISY_FLAT.map((v, k) => v + 2 * k) });
  const audit = auditSeries(series);
  assert.equal(audit.naive.claimsTrend, true);
  assert.equal(audit.naive.direction, 'up');
});

test('auditSeries flags a segment trend opposite to the naive headline as artifact', () => {
  const declining = NOISY_FLAT.slice(0, 12).map((v, k) => v + 30 - 2.5 * k);
  const series = rows(2000, {
    A: [...declining, 0, 0, 0],
    B: [...Array(12).fill(0), 900, 950, 1000],
  });
  const audit = auditSeries(series);
  assert.equal(audit.segment.mk.trend, 'down');
  assert.equal(audit.naive.direction, 'up');
  assert.equal(audit.verdict, 'artifact');
});

test('auditSeries splits on a step change that coincides with a catalog-wide break', () => {
  const series = rows(2000, {
    A: [20, 18, 22, 19, 21, 20, 23, 17, 20, 22, 48, 52, 50, 47, 53, 49, 51, 50, 52, 48],
  });
  const audit = auditSeries(series, { catalogBreaks: [2010] });
  assert.equal(audit.breaks[0].kind, 'step');
  assert.equal(audit.breaks[0].year, 2010);
  assert.equal(audit.verdict, 'artifact');
});

test('auditSeries keeps a step change that has no catalog explanation', () => {
  const series = rows(2000, {
    A: [20, 18, 22, 19, 21, 20, 23, 17, 20, 22, 48, 52, 50, 47, 53, 49, 51, 50, 52, 48],
  });
  const audit = auditSeries(series, { catalogBreaks: [2003] });
  assert.equal(audit.breaks.length, 0);
  assert.equal(audit.verdict, 'real');
});

test('auditSeries will not judge a stretch that is almost empty', () => {
  const series = rows(2000, { A: [0, 1, 0, 0, 2, 0, 1, 0, 1, 0, 0, 1, 2, 1, 2, 2] });
  const audit = auditSeries(series);
  assert.equal(audit.segment, null);
  assert.equal(audit.verdict, 'insufficient');
});

test('catalogBreakYears finds feed changes across all categories combined', () => {
  const categories = {
    storms: { years: rows(2000, { U: [90, 92, 88, 0, 0, 0], J: [0, 0, 0, 91, 89, 90] }) },
    volcanoes: { years: rows(2000, { S: [20, 21, 19, 22, 20, 21] }) },
  };
  assert.deepEqual(catalogBreakYears(categories), [2003]);
});

test('auditSeries does not mutate its input', () => {
  const series = rows(2000, { A: NOISY_FLAT });
  const snapshot = JSON.stringify(series);
  auditSeries(series);
  assert.equal(JSON.stringify(series), snapshot);
});
