// Catalog auditor: separates "the world changed" from "the catalog changed".
// EONET aggregates external feeds (GDACS, IRWIN, InciWeb...). When a feed is
// added or ramps up, event counts jump without any physical change. We split
// the record at those breaks and only judge trends inside comparable stretches.

import { mannKendall, senSlope, mean, pettitt, SIGNIFICANCE_LEVEL } from './stats.js';

export const AUDIT_DEFAULTS = Object.freeze({
  // Total variation distance between yearly source mixes that counts as a break.
  compositionThreshold: 0.5,
  // Breaks are ignored when both neighbouring years are this small (pure noise).
  minEventsForBreak: 5,
  // Year-over-year ratio that counts as an operational volume jump.
  volumeJumpRatio: 4,
  volumeMinBase: 10,
  // Coverage onset: from below volumeMinBase to at least this many events.
  onsetMinEvents: 40,
  // A step change within this many years of a catalog-wide break is operational.
  stepTolerance: 1,
  // Catalog-wide break years (from catalogBreakYears) used to explain step changes.
  catalogBreaks: [],
  // Shortest stretch on which we are willing to run a trend test.
  minSegmentYears: 8,
  // ...and the stretch must average at least this many events per year.
  minSegmentMeanEvents: 3,
  // Years averaged at each end for the naive "% change" headline.
  edgeYears: 3,
  // A naive reader "sees a trend" when the edge-to-edge change exceeds this.
  headlineChangePct: 100,
  // A source must contribute this share of a year to be named as "entering".
  enteringShare: 0.2,
  lastCompleteYear: Infinity,
});

const shares = (bySource) => {
  const total = Object.values(bySource).reduce((a, b) => a + b, 0);
  return { total, share: (id) => (total ? (bySource[id] ?? 0) / total : 0) };
};

/** Total variation distance between two source mixes (0 = identical, 1 = disjoint). */
export function compositionDistance(a, b) {
  const sa = shares(a);
  const sb = shares(b);
  if (sa.total === 0 && sb.total === 0) return 0;
  if (sa.total === 0 || sb.total === 0) return 1;
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const id of ids) sum += Math.abs(sa.share(id) - sb.share(id));
  return sum / 2;
}

function namedSources(bySource, otherBySource, minShare) {
  const { share } = shares(bySource);
  return Object.keys(bySource)
    .filter((id) => !otherBySource[id] && share(id) >= minShare)
    .sort((x, y) => bySource[y] - bySource[x]);
}

function breakKind(isComposition, isVolume, isOnset) {
  if (isComposition) return 'composition';
  if (isVolume) return 'volume';
  if (isOnset) return 'onset';
  return null;
}

/** Years where the catalog itself changed: new feeds, dropped feeds or volume jumps. */
export function detectBreaks(series, options = {}) {
  const opts = { ...AUDIT_DEFAULTS, ...options };
  const breaks = [];
  for (let k = 1; k < series.length; k += 1) {
    const prev = series[k - 1];
    const curr = series[k];
    if (Math.max(prev.total, curr.total) < opts.minEventsForBreak) continue;
    const distance = compositionDistance(prev.bySource, curr.bySource);
    const low = Math.min(prev.total, curr.total);
    const ratio = low > 0 ? Math.max(prev.total, curr.total) / low : Infinity;
    const isComposition = distance >= opts.compositionThreshold;
    const isVolume = low >= opts.volumeMinBase && ratio >= opts.volumeJumpRatio;
    const isOnset =
      low < opts.volumeMinBase && Math.max(prev.total, curr.total) >= opts.onsetMinEvents;
    const kind = breakKind(isComposition, isVolume, isOnset);
    if (!kind) continue;
    breaks.push({
      year: curr.year,
      kind,
      distance,
      ratio,
      entering: namedSources(curr.bySource, prev.bySource, opts.enteringShare),
      leaving: namedSources(prev.bySource, curr.bySource, opts.enteringShare),
    });
  }
  return breaks;
}

function sumBySource(rows) {
  const merged = {};
  for (const row of rows) {
    for (const [id, count] of Object.entries(row.bySource)) merged[id] = (merged[id] ?? 0) + count;
  }
  return merged;
}

/** Break years of the whole catalog (all categories combined), e.g. when new feeds come online. */
export function catalogBreakYears(categories, options = {}) {
  const opts = { ...AUDIT_DEFAULTS, ...options };
  const all = Object.values(categories).map((c) => c.years);
  const years = [...new Set(all.flat().map((r) => r.year))]
    .filter((y) => y <= opts.lastCompleteYear)
    .sort((a, b) => a - b);
  const combined = years.map((year) => {
    const bySource = sumBySource(all.flat().filter((r) => r.year === year));
    const total = Object.values(bySource).reduce((a, b) => a + b, 0);
    return { year, total, bySource };
  });
  return detectBreaks(combined, opts).map((b) => b.year);
}

// A significant step change that lines up with a catalog-wide feed change is operational.
function stepBreak(rows, breaks, opts) {
  const result = pettitt(rows.map((r) => r.total));
  if (!(result.p < SIGNIFICANCE_LEVEL)) return null;
  const year = rows[result.index].year;
  const near = (y) => Math.abs(y - year) <= opts.stepTolerance;
  if (!opts.catalogBreaks.some(near) || breaks.some((b) => near(b.year))) return null;
  return {
    year,
    kind: 'step',
    distance: 0,
    ratio: mean(rows.slice(result.index).map((r) => r.total)) /
      mean(rows.slice(0, result.index).map((r) => r.total)),
    entering: [],
    leaving: [],
    p: result.p,
  };
}

function splitSegments(series, breaks) {
  const breakYears = new Set(breaks.map((b) => b.year));
  return series.reduce((segments, row) => {
    if (segments.length === 0 || breakYears.has(row.year)) return [...segments, [row]];
    return [...segments.slice(0, -1), [...segments.at(-1), row]];
  }, []);
}

function trendOf(rows) {
  const years = rows.map((r) => r.year);
  const totals = rows.map((r) => r.total);
  return {
    start: years[0],
    end: years.at(-1),
    rows,
    mk: mannKendall(totals),
    sen: senSlope(years, totals),
  };
}

function edgeChangePct(totals, edge) {
  if (totals.length < edge * 2) return null;
  const first = mean(totals.slice(0, edge));
  const last = mean(totals.slice(-edge));
  return first > 0 ? ((last - first) / first) * 100 : null;
}

// Share of the latest stretch's events that come from feeds unseen before it.
function newSourceShareOf(segments) {
  if (segments.length < 2) return 0;
  const latest = segments.at(-1);
  const earlier = new Set(segments.slice(0, -1).flat().flatMap((r) => Object.keys(r.bySource)));
  let fresh = 0;
  let total = 0;
  for (const row of latest) {
    for (const [id, count] of Object.entries(row.bySource)) {
      total += count;
      if (!earlier.has(id)) fresh += count;
    }
  }
  return total ? fresh / total : 0;
}

// What a naive dashboard would claim: a significant test or a big headline change.
function naiveClaim(mk, changePct, threshold) {
  const bigHeadline = changePct != null && Math.abs(changePct) >= threshold;
  if (mk.significant) return { claimsTrend: true, direction: mk.trend };
  if (bigHeadline) return { claimsTrend: true, direction: changePct > 0 ? 'up' : 'down' };
  return { claimsTrend: false, direction: 'none' };
}

function decideVerdict(naive, segment, hasBreaks) {
  if (!segment) return naive.claimsTrend && hasBreaks ? 'artifact' : 'insufficient';
  const segmentDisagrees = !segment.mk.significant || segment.mk.trend !== naive.direction;
  if (hasBreaks && naive.claimsTrend && segmentDisagrees) return 'artifact';
  return segment.mk.significant ? 'real' : 'stable';
}

/**
 * Full audit of one yearly series of { year, total, bySource }.
 * Returns the naive reading, the catalog breaks, the longest comparable stretch
 * and a verdict: 'real' | 'stable' | 'artifact' | 'insufficient'.
 */
export function auditSeries(series, options = {}) {
  const opts = { ...AUDIT_DEFAULTS, ...options };
  const analysisYears = series.filter((r) => r.year <= opts.lastCompleteYear);
  const partialYear = series.find((r) => r.year > opts.lastCompleteYear) ?? null;
  const totals = analysisYears.map((r) => r.total);

  const naiveTrend = trendOf(analysisYears);
  const changePct = edgeChangePct(totals, opts.edgeYears);
  const naive = {
    ...naiveTrend,
    changePct,
    ...naiveClaim(naiveTrend.mk, changePct, opts.headlineChangePct),
  };
  const ownBreaks = detectBreaks(analysisYears, opts);
  const step = stepBreak(analysisYears, ownBreaks, opts);
  const breaks = [...ownBreaks, ...(step ? [step] : [])].sort((a, b) => a.year - b.year);
  const segments = splitSegments(analysisYears, breaks);
  const judgeable = (rows) =>
    rows.length >= opts.minSegmentYears &&
    mean(rows.map((r) => r.total)) >= opts.minSegmentMeanEvents;
  const longest = segments
    .filter(judgeable)
    .reduce((best, s) => (best == null || s.length >= best.length ? s : best), null);
  const segment = longest ? trendOf(longest) : null;

  return {
    analysisYears,
    partialYear,
    naive,
    breaks,
    segments: segments.map((s) => ({ start: s[0].year, end: s.at(-1).year })),
    segment,
    newSourceShare: newSourceShareOf(segments),
    verdict: decideVerdict(naive, segment, breaks.length > 0),
  };
}
