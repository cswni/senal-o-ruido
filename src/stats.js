// Non-parametric trend statistics used across the app.
// Mann-Kendall answers "is there a monotonic trend?", Sen's slope answers "how big?".

export const SIGNIFICANCE_LEVEL = 0.05;
const MIN_MANN_KENDALL_N = 4;

const isValid = (v) => typeof v === 'number' && Number.isFinite(v);

// Abramowitz & Stegun 7.1.26 erf approximation (max error ~1.5e-7).
function erf(x) {
  const sign = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-a * a));
}

export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function tieCorrection(values) {
  const groups = new Map();
  for (const v of values) groups.set(v, (groups.get(v) ?? 0) + 1);
  let correction = 0;
  for (const t of groups.values()) {
    if (t > 1) correction += t * (t - 1) * (2 * t + 5);
  }
  return correction;
}

/**
 * Mann-Kendall trend test with tie correction and continuity correction.
 * Missing values (null/NaN) are dropped; order of the remaining values is kept.
 */
export function mannKendall(values, alpha = SIGNIFICANCE_LEVEL) {
  const x = values.filter(isValid);
  const n = x.length;
  if (n < MIN_MANN_KENDALL_N) {
    return { n, s: 0, varS: 0, z: 0, p: NaN, trend: 'insufficient', significant: false };
  }
  let s = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) s += Math.sign(x[j] - x[i]);
  }
  const varS = (n * (n - 1) * (2 * n + 5) - tieCorrection(x)) / 18;
  let z = 0;
  if (varS > 0 && s > 0) z = (s - 1) / Math.sqrt(varS);
  if (varS > 0 && s < 0) z = (s + 1) / Math.sqrt(varS);
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  const significant = p < alpha;
  let trend = 'none';
  if (significant) trend = z > 0 ? 'up' : 'down';
  return { n, s, varS, z, p, trend, significant };
}

/** Theil-Sen estimator: median of pairwise slopes, robust to outliers. */
export function senSlope(xs, ys) {
  const points = xs
    .map((x, k) => [x, ys[k]])
    .filter(([x, y]) => isValid(x) && isValid(y));
  const slopes = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[j][0] - points[i][0];
      if (dx !== 0) slopes.push((points[j][1] - points[i][1]) / dx);
    }
  }
  const slope = median(slopes);
  const intercept = median(points.map(([x, y]) => y - slope * x));
  return { slope, intercept, n: points.length };
}

/**
 * Pettitt change-point test: finds the most likely single step change.
 * `index` is the position where the second regime starts (-1 if untestable).
 */
export function pettitt(values) {
  const x = values.filter(isValid);
  const n = x.length;
  if (n < MIN_MANN_KENDALL_N) return { index: -1, k: 0, p: NaN };
  let best = { index: -1, k: -1 };
  for (let t = 1; t < n; t += 1) {
    let u = 0;
    for (let i = 0; i < t; i += 1) {
      for (let j = t; j < n; j += 1) u += Math.sign(x[i] - x[j]);
    }
    if (Math.abs(u) > best.k) best = { index: t, k: Math.abs(u) };
  }
  const p = Math.min(1, 2 * Math.exp((-6 * best.k ** 2) / (n ** 3 + n ** 2)));
  return { ...best, p };
}

/** Percent of the sample below `value` (ties count half). */
export function percentileRank(value, sample) {
  const valid = sample.filter(isValid);
  if (valid.length === 0) return NaN;
  const below = valid.filter((v) => v < value).length;
  const equal = valid.filter((v) => v === value).length;
  return ((below + 0.5 * equal) / valid.length) * 100;
}

export function mean(values) {
  const valid = values.filter(isValid);
  if (valid.length === 0) return NaN;
  return valid.reduce((acc, v) => acc + v, 0) / valid.length;
}

export function standardDeviation(values) {
  const valid = values.filter(isValid);
  if (valid.length < 2) return NaN;
  const m = mean(valid);
  return Math.sqrt(valid.reduce((acc, v) => acc + (v - m) ** 2, 0) / (valid.length - 1));
}
