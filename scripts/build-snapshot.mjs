// Builds a static snapshot of the EONET catalog so the app loads instantly.
// - data/summary.json: per category, per year, per source event counts
// - data/events/<year>.json: compact event records for the map
// Usage: node scripts/build-snapshot.mjs [startYear]

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compactEvent, EONET_API as API } from '../src/eonet.js';

const START_YEAR = Number(process.argv[2] ?? 2000);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4000;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, 'data');
const eventsDir = path.join(dataDir, 'events');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`  intento ${attempt} falló para ${url}: ${err.message}`);
      if (attempt === MAX_RETRIES) throw err;
      await delay(RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error('unreachable');
}

function addCount(summary, categoryId, year, sourceIds) {
  const category = summary[categoryId] ?? {};
  const bucket = category[year] ?? { total: 0, bySource: {} };
  const bySource = { ...bucket.bySource };
  for (const id of sourceIds) bySource[id] = (bySource[id] ?? 0) + 1;
  return {
    ...summary,
    [categoryId]: { ...category, [year]: { total: bucket.total + 1, bySource } },
  };
}

async function main() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  await mkdir(eventsDir, { recursive: true });

  const [{ categories }, { sources }] = await Promise.all([
    getJson(`${API}/categories`),
    getJson(`${API}/sources`),
  ]);

  const seen = new Set();
  const eventsByYear = {};
  for (let year = START_YEAR; year <= currentYear; year += 1) {
    console.log(`Descargando ${year}...`);
    const { events } = await getJson(
      `${API}/events?status=all&start=${year}-01-01&end=${year}-12-31`,
    );
    for (const raw of events) {
      if (seen.has(raw.id)) continue;
      const event = compactEvent(raw);
      if (!event) continue;
      seen.add(raw.id);
      const eventYear = Number(event.d.slice(0, 4));
      if (eventYear < START_YEAR) continue;
      eventsByYear[eventYear] = [...(eventsByYear[eventYear] ?? []), event];
    }
    console.log(`  ${events.length} eventos recibidos`);
  }

  let counts = {};
  for (const [year, events] of Object.entries(eventsByYear)) {
    for (const event of events) {
      for (const categoryId of event.c) counts = addCount(counts, categoryId, year, event.s);
    }
    await writeFile(path.join(eventsDir, `${year}.json`), JSON.stringify(events));
  }

  const years = Array.from({ length: currentYear - START_YEAR + 1 }, (_, k) => START_YEAR + k);
  const summary = {
    generatedAt: now.toISOString(),
    firstYear: START_YEAR,
    lastYear: currentYear,
    lastCompleteYear: currentYear - 1,
    categories: Object.fromEntries(
      categories.map((c) => [
        c.id,
        {
          title: c.title,
          years: years.map((year) => ({
            year,
            total: counts[c.id]?.[year]?.total ?? 0,
            bySource: counts[c.id]?.[year]?.bySource ?? {},
          })),
        },
      ]),
    ),
    sources: Object.fromEntries(sources.map((s) => [s.id, { title: s.title, url: s.source }])),
    eventYears: Object.keys(eventsByYear).map(Number).sort((a, b) => a - b),
  };
  await writeFile(path.join(dataDir, 'summary.json'), JSON.stringify(summary));
  console.log(`Listo: ${seen.size} eventos, snapshot en ${dataDir}`);
}

main().catch((err) => {
  console.error('Fallo al construir el snapshot:', err);
  process.exit(1);
});
