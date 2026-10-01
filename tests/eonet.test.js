import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactEvent, eventUrl } from '../src/eonet.js';

const base = {
  id: 'EONET_1',
  title: 'Fire A',
  categories: [{ id: 'wildfires' }],
  sources: [{ id: 'GDACS' }, { id: 'IRWIN' }],
  closed: '2024-08-01T00:00:00Z',
};

test('compactEvent keeps the earliest geometry and the peak magnitude', () => {
  const event = compactEvent({
    ...base,
    geometry: [
      { date: '2024-07-26T00:00:00Z', type: 'Point', coordinates: [-121.12345, 39.98765], magnitudeValue: 900, magnitudeUnit: 'acres' },
      { date: '2024-07-24T00:00:00Z', type: 'Point', coordinates: [-121.5, 39.8], magnitudeValue: 100, magnitudeUnit: 'acres' },
    ],
  });
  assert.deepEqual(event, {
    i: 'EONET_1',
    t: 'Fire A',
    c: ['wildfires'],
    s: ['GDACS', 'IRWIN'],
    d: '2024-07-24',
    x: -121.5,
    y: 39.8,
    n: 2,
    m: 900,
    u: 'acres',
    o: false,
  });
});

test('compactEvent uses the vertex average of a polygon ring', () => {
  const event = compactEvent({
    ...base,
    closed: null,
    geometry: [
      { date: '2024-01-01T00:00:00Z', type: 'Polygon', coordinates: [[[10, 20], [12, 20], [12, 22], [10, 22], [10, 20]]] },
    ],
  });
  assert.equal(event.x, 11);
  assert.equal(event.y, 21);
  assert.equal(event.m, null);
  assert.equal(event.o, true);
});

test('compactEvent drops events without usable geometry', () => {
  assert.equal(compactEvent({ ...base, geometry: [] }), null);
  assert.equal(
    compactEvent({ ...base, geometry: [{ date: '2024-01-01', type: 'LineString', coordinates: [] }] }),
    null,
  );
});

test('eventUrl encodes the id', () => {
  assert.equal(eventUrl('EONET 1/2'), 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET%201%2F2');
});
