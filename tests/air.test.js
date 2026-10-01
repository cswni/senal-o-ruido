import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIR_START_DATE,
  WHO_PM25_24H,
  buildAirUrl,
  parseAirHourly,
  dailyMeans,
  eventWindow,
  summarizeAir,
  airBand,
} from '../src/air.js';

function hours(date, values) {
  return values.map((v, h) => ({ time: `${date}T${String(h).padStart(2, '0')}:00`, value: v }));
}

test('WHO 24-hour PM2.5 guideline is 15 µg/m³ (2021 AQG)', () => {
  assert.equal(WHO_PM25_24H, 15);
});

test('buildAirUrl requests hourly PM2.5 for a date range', () => {
  const url = new URL(buildAirUrl({ lat: 40.71, lon: -74, start: '2023-06-01', end: '2023-06-10' }));
  assert.equal(url.hostname, 'air-quality-api.open-meteo.com');
  assert.equal(url.searchParams.get('hourly'), 'pm2_5');
  assert.equal(url.searchParams.get('start_date'), '2023-06-01');
  assert.equal(url.searchParams.get('end_date'), '2023-06-10');
});

test('buildAirUrl rejects invalid coordinates', () => {
  assert.throws(() => buildAirUrl({ lat: 91, lon: 0, start: '2023-01-01', end: '2023-01-02' }));
});

test('parseAirHourly pairs times with values and keeps nulls', () => {
  const parsed = parseAirHourly({ hourly: { time: ['2023-06-07T00:00', '2023-06-07T01:00'], pm2_5: [10.5, null] } });
  assert.deepEqual(parsed, [
    { time: '2023-06-07T00:00', value: 10.5 },
    { time: '2023-06-07T01:00', value: null },
  ]);
});

test('parseAirHourly rejects a response without hourly data', () => {
  assert.throws(() => parseAirHourly({ error: true, reason: 'x' }), /calidad del aire/);
});

test('dailyMeans averages each day and drops days with too few hours', () => {
  const data = [
    ...hours('2023-06-07', Array(24).fill(20)),
    ...hours('2023-06-08', [...Array(10).fill(5), ...Array(14).fill(null)]),
  ];
  assert.deepEqual(dailyMeans(data), [{ date: '2023-06-07', value: 20 }]);
});

test('eventWindow spans a few days before to ten days after, clipped to available data', () => {
  assert.deepEqual(eventWindow('2023-06-05', '2026-09-30'), { start: '2023-06-02', end: '2023-06-15' });
  assert.deepEqual(eventWindow('2026-09-25', '2026-09-30'), { start: '2026-09-22', end: '2026-09-29' });
  assert.deepEqual(eventWindow('2022-08-05', '2026-09-30'), { start: AIR_START_DATE, end: '2022-08-15' });
  assert.equal(eventWindow('2021-01-01', '2026-09-30'), null);
});

test('summarizeAir compares the window with the guideline and with the usual level', () => {
  const days = [
    { date: '2023-05-01', value: 6 },
    { date: '2023-05-02', value: 8 },
    { date: '2023-05-03', value: 7 },
    { date: '2023-06-06', value: 40 },
    { date: '2023-06-07', value: 97 },
    { date: '2023-06-08', value: 12 },
  ];
  const summary = summarizeAir(days, { start: '2023-06-06', end: '2023-06-08' });
  assert.equal(summary.windowDays, 3);
  assert.equal(summary.exceedances, 2);
  assert.deepEqual(summary.peak, { date: '2023-06-07', value: 97 });
  assert.equal(summary.usual, 7);
  assert.ok(Math.abs(summary.peakVsUsual - 97 / 7) < 1e-9);
  assert.ok(Math.abs(summary.peakVsGuideline - 97 / 15) < 1e-9);
  assert.equal(summary.usualExceedanceShare, 0);
});

test('summarizeAir reports how often ordinary days already exceed the guideline', () => {
  const days = [
    { date: '2023-05-01', value: 20 },
    { date: '2023-05-02', value: 10 },
    { date: '2023-05-03', value: 16 },
    { date: '2023-05-04', value: 5 },
    { date: '2023-06-07', value: 60 },
  ];
  const summary = summarizeAir(days, { start: '2023-06-07', end: '2023-06-07' });
  assert.equal(summary.usualExceedanceShare, 0.5);
});

test('airBand needs the guideline to be exceeded before calling a peak high', () => {
  assert.equal(airBand({ peak: { value: 15 }, peakVsUsual: 3.5 }), 'high');
  assert.equal(airBand({ peak: { value: 12 }, peakVsUsual: 1.2 }), 'normal');
  assert.equal(airBand({ peak: { value: 20 }, peakVsUsual: 1.1 }), 'high');
  assert.equal(airBand({ peak: { value: 64 }, peakVsUsual: 5 }), 'very-high');
  assert.equal(airBand({ peak: { value: 40 }, peakVsUsual: 1.2 }), 'very-high');
  assert.equal(airBand({ peak: { value: 4 }, peakVsUsual: 2.7 }), 'normal');
});

test('summarizeAir returns null when the window has no data', () => {
  assert.equal(summarizeAir([{ date: '2023-01-01', value: 5 }], { start: '2024-01-01', end: '2024-01-05' }), null);
});
