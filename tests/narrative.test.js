import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNumber,
  formatSigned,
  chanceOfLuck,
  verdictCopy,
  naiveHeadline,
  breakSentence,
  auditConclusion,
  trendSentence,
  anomalySentence,
} from '../src/narrative.js';
import { PARAMETERS } from '../src/power.js';

const rowsOf = (totals) => totals.map((total, k) => ({ year: 2000 + k, total, bySource: {} }));

test('formatNumber uses Spanish separators', () => {
  assert.equal(formatNumber(1234.5, 1), '1234,5');
  assert.equal(formatNumber(12345, 0), '12.345');
  assert.equal(formatSigned(0.285, 2), '+0,29');
  assert.equal(formatSigned(-3, 0), '−3');
});

test('chanceOfLuck phrases p-values for non-specialists', () => {
  assert.equal(chanceOfLuck(0.0004), 'menos de 0,1 %');
  assert.equal(chanceOfLuck(0.0056), '0,6 %');
  assert.equal(chanceOfLuck(0.31), '31 %');
});

test('verdictCopy covers every verdict with an icon and label', () => {
  for (const verdict of ['real', 'stable', 'artifact', 'insufficient']) {
    const copy = verdictCopy(verdict);
    assert.ok(copy.label.length > 0);
    assert.ok(copy.icon.length > 0);
    assert.ok(copy.tone.length > 0);
  }
});

test('naiveHeadline reports percentage change when the base is non-zero', () => {
  const audit = { analysisYears: rowsOf([10, 10, 10, 20, 30, 30, 30]), naive: { changePct: 200 } };
  assert.equal(naiveHeadline(audit, 'Incendios'), 'Incendios: +200 % entre 2000–2002 y 2004–2006');
});

test('naiveHeadline reports absolute counts when starting from zero', () => {
  const audit = { analysisYears: rowsOf([0, 0, 0, 5, 900, 900, 900]), naive: { changePct: null } };
  assert.equal(
    naiveHeadline(audit, 'Incendios'),
    'Incendios: de 0 a 900 eventos por año entre 2000–2002 y 2004–2006',
  );
});

test('breakSentence explains each kind of catalog break', () => {
  const sources = { GDACS: { title: 'Global Disaster Alert' } };
  assert.match(
    breakSentence({ year: 2024, kind: 'composition', entering: ['GDACS'], leaving: [] }, sources),
    /2024.*Global Disaster Alert/,
  );
  assert.match(breakSentence({ year: 2015, kind: 'onset', entering: [], leaving: [] }, sources), /cobertura/);
  assert.match(breakSentence({ year: 2015, kind: 'step', ratio: 2.4, entering: [], leaving: [] }, sources), /×2,4/);
  assert.match(breakSentence({ year: 2010, kind: 'volume', ratio: 5, entering: [], leaving: [] }, sources), /×5/);
});

test('auditConclusion explains an artifact with its comparable stretch', () => {
  const text = auditConclusion({
    verdict: 'artifact',
    segment: { start: 2000, end: 2014, mk: { p: 0.455, trend: 'none' }, sen: { slope: -0.4 } },
  });
  assert.match(text, /fuentes del catálogo/);
  assert.match(text, /2000–2014/);
});

test('auditConclusion explains a stable record', () => {
  const text = auditConclusion({
    verdict: 'stable',
    segment: { start: 2000, end: 2025, mk: { p: 0.81, trend: 'none' }, sen: { slope: -0.07 } },
  });
  assert.match(text, /26 años/);
  assert.match(text, /81 %/);
});

test('trendSentence states slope per decade and whether it is significant', () => {
  const text = trendSentence(PARAMETERS.T2M_MAX, {
    start: 1981,
    end: 2025,
    perDecade: 0.285,
    mk: { p: 0.0056, significant: true, trend: 'up' },
  });
  assert.match(text, /\+0,3 °C por década/);
  assert.match(text, /1981–2025/);
  assert.match(text, /significativa/);
});

test('anomalySentence reads high and low percentiles in plain language', () => {
  const hot = anomalySentence(PARAMETERS.T2M_MAX, { percentile: 95, band: 'very-high', baseline: Array(40) }, 'En los 90 días previos al evento');
  assert.match(hot, /^En los 90 días previos al evento, la temperatura máxima fue más alta que en el 95 % de los 40 años anteriores\.$/);
  const dry = anomalySentence(PARAMETERS.PRECTOTCORR, { percentile: 4, band: 'very-low', baseline: Array(40) }, 'En los últimos 90 días');
  assert.match(dry, /más baja que en el 96 %/);
  const normal = anomalySentence(PARAMETERS.GWETROOT, { percentile: 53, band: 'normal', baseline: Array(40) }, 'En los últimos 90 días');
  assert.match(normal, /dentro de lo habitual/);
});
