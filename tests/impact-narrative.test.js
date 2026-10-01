import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE,
  HORIZONS,
  HEAT_HEALTH_EFFECTS,
  heatWindowSentence,
  heatTrendSentence,
  airSentence,
  faunaSentence,
  samplingSentence,
  contextSentence,
  groupName,
  revisionSentence,
} from '../src/impact-narrative.js';

test('every evidence level and horizon has a label and an explanation', () => {
  for (const level of Object.values(EVIDENCE)) assert.ok(level.label && level.explain);
  for (const horizon of Object.values(HORIZONS)) assert.ok(horizon.label && horizon.span);
  for (const key of ['caution', 'extreme-caution', 'danger', 'extreme-danger']) assert.ok(HEAT_HEALTH_EFFECTS[key]);
});

test('heatWindowSentence compares the window with the typical year', () => {
  const text = heatWindowSentence({
    metric: 'DANGER',
    anomaly: { value: 23, baseline: [5, 8, 8, 10, 12] },
    lead: 'En los 90 días previos al evento',
  });
  assert.equal(
    text,
    'En los 90 días previos al evento hubo 23 días con índice de calor de peligro (≥ 39,4 °C); en un año típico, 8.',
  );
});

test('heatTrendSentence reports change per decade and significance', () => {
  const text = heatTrendSentence('DANGER', { start: 1981, end: 2025, perDecade: 10.8, mk: { p: 0.00002, significant: true } });
  assert.match(text, /^Días de peligro por año: \+10,8 por década \(1981–2025\)/);
  assert.match(text, /1981–2025/);
  assert.match(text, /menos de 0,1 %/);
});

test('airSentence puts the peak against the WHO guideline and the usual level', () => {
  const text = airSentence({
    peak: { date: '2023-06-07', value: 64.3 },
    peakVsGuideline: 4.29,
    peakVsUsual: 4.94,
    exceedances: 12,
    windowDays: 14,
    usualExceedanceShare: 0.4,
  });
  assert.match(text, /64 µg\/m³ el 2023-06-07/);
  assert.match(text, /4,3 veces la guía de la OMS/);
  assert.match(text, /4,9 veces el nivel habitual/);
  assert.match(text, /12 de 14 días/);
  assert.match(text, /40 %/);
});

test('faunaSentence counts records, not species', () => {
  const text = faunaSentence({ total: 239009, redList: { CR: 9, EN: 99, VU: 532, threatened: 640 } }, 25);
  assert.match(text, /25 km/);
  assert.match(text, /640 registros de especies amenazadas/);
  assert.match(text, /9 en peligro crítico/);
});

test('faunaSentence handles places with no threatened records', () => {
  assert.match(faunaSentence({ total: 50, redList: { CR: 0, EN: 0, VU: 0, threatened: 0 } }, 25), /ningún registro/);
});

test('samplingSentence warns when observation effort is growing', () => {
  assert.match(samplingSentence({ effortGrowing: true, recentShare: 0.82, recentYears: 10 }), /82 %.*presencia, no tendencias/);
  assert.match(samplingSentence({ effortGrowing: false, effortDeclining: false, recentShare: 0.4, recentYears: 10 }), /no muestra una tendencia detectable/);
  assert.match(samplingSentence({ effortGrowing: false, effortDeclining: true, recentShare: 0.1, recentYears: 10 }), /disminuido.*no implica menos/);
  assert.equal(samplingSentence(null), '');
});

const gdp = { label: 'Crecimiento del PIB', unit: '%', decimals: 1 };

test('contextSentence flags unusual years without claiming causation', () => {
  const text = contextSentence(gdp, 2020, { status: 'ok', actual: -0.1, expected: 2.7, unusual: true });
  assert.match(text, /2020/);
  assert.match(text, /fuera de lo habitual/i);
  assert.match(text, /otras causas/);
});

test('contextSentence covers usual, missing and short series', () => {
  assert.match(contextSentence(gdp, 2022, { status: 'ok', actual: 4.8, expected: 4.1, unusual: false }), /dentro de la variación habitual/);
  assert.match(contextSentence(gdp, 2024, { status: 'missing', latestYear: 2023 }), /aún no se publica.*2023/);
  assert.match(contextSentence(gdp, 2024, { status: 'short' }), /demasiado corta/);
});

test('revisionSentence offers both explanations for an abrupt jump', () => {
  const text = revisionSentence({ label: 'Superficie forestal', unit: '% del territorio', decimals: 1 }, { year: 2021, change: 0.77 });
  assert.match(text, /2021/);
  assert.match(text, /\+0,8 % del territorio/);
  assert.match(text, /revisión/);
  assert.match(text, /choque real/);
});

test('groupName translates common taxonomic classes', () => {
  assert.equal(groupName('Aves'), 'Aves');
  assert.equal(groupName('Mammalia'), 'Mamíferos');
  assert.equal(groupName('Magnoliopsida'), 'Plantas con flor');
  assert.equal(groupName('Unknownia'), 'Unknownia');
});
