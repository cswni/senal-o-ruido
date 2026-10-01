// Small dependency-free SVG charts. Every chart redraws on resize, carries a
// hover tooltip, and writes text with text tokens (never the series color).

import { formatNumber } from './narrative.js';

const NS = 'http://www.w3.org/2000/svg';
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;
const MARGIN = { top: 28, right: 12, bottom: 26, left: 44 };

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

const scale = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

function niceTicks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= count) ?? 10 * pow;
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** Re-renders `draw(width)` whenever the container width changes. */
function responsive(container, draw) {
  container.__observer?.disconnect();
  let lastWidth = 0;
  const run = () => {
    // Containers replaced by a new render get detached: stop observing them.
    if (!container.isConnected && lastWidth > 0) {
      observer.disconnect();
      return;
    }
    const width = Math.floor(container.clientWidth);
    if (width === lastWidth || width === 0) return;
    lastWidth = width;
    container.replaceChildren();
    draw(width);
  };
  const observer = new ResizeObserver(run);
  observer.observe(container);
  container.__observer = observer;
  run();
}

function tooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.append(tip);
  return {
    show(lines, x, y) {
      tip.replaceChildren(
        ...lines.map(([label, value, swatch]) => {
          const row = document.createElement('div');
          row.className = 'chart-tip-row';
          if (swatch) {
            const dot = document.createElement('span');
            dot.className = 'chart-tip-swatch';
            dot.style.background = swatch;
            row.append(dot);
          }
          const name = document.createElement('span');
          name.textContent = label;
          const val = document.createElement('strong');
          val.textContent = value;
          row.append(name, val);
          return row;
        }),
      );
      tip.hidden = false;
      const box = container.getBoundingClientRect();
      const left = Math.min(Math.max(x + 12, 0), box.width - tip.offsetWidth - 4);
      tip.style.transform = `translate(${Math.max(left, 0)}px, ${Math.max(y - tip.offsetHeight - 8, 0)}px)`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function yAxis(svg, ticks, y, width, decimals = 0) {
  for (const t of ticks) {
    svg.append(el('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(el('text', { x: MARGIN.left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, formatNumber(t, decimals)));
  }
}

function xLabels(svg, years, x, height, minSpacing = 52) {
  const every = Math.max(1, Math.ceil((minSpacing * years.length) / (x(years.at(-1)) - x(years[0]) + minSpacing)));
  const lastX = x(years.at(-1));
  years.forEach((year, k) => {
    const isLast = k === years.length - 1;
    if (k % every !== 0 && !isLast) return;
    // Skip a regular label that would collide with the always-shown last one.
    if (!isLast && lastX - x(year) < minSpacing * 0.8) return;
    svg.append(el('text', { x: x(year), y: height - 6, 'text-anchor': 'middle', class: 'tick' }, String(year)));
  });
}

// Bar segment with optional 4px rounded top.
function barPath(x, y, w, h, roundTop) {
  const r = roundTop ? Math.min(RADIUS, h, w / 2) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Stacked yearly bars by source, with catalog-break markers and a shaded comparable stretch.
 * rows: [{ year, total, parts: [{ key, value }] }]  keys: [{ key, label, color }]
 */
export function stackedBars(container, { rows, keys, markers = [], highlight, partialYear, height = 280 }) {
  const color = Object.fromEntries(keys.map((k) => [k.key, k.color]));
  const label = Object.fromEntries(keys.map((k) => [k.key, k.label]));
  responsive(container, (width) => {
    const svg = el('svg', { width, height, role: 'img', class: 'chart' });
    const years = rows.map((r) => r.year);
    const band = (width - MARGIN.left - MARGIN.right) / rows.length;
    const barW = Math.max(2, Math.min(MAX_BAR, band - GAP));
    const center = scale(years[0], years.at(-1), MARGIN.left + band / 2, width - MARGIN.right - band / 2);
    const ticks = niceTicks(0, Math.max(...rows.map((r) => r.total), 1));
    const y = scale(0, ticks.at(-1), height - MARGIN.bottom, MARGIN.top);

    if (highlight) {
      const x0 = center(highlight.start) - band / 2;
      const x1 = center(highlight.end) + band / 2;
      svg.append(el('rect', { x: x0, y: MARGIN.top - 18, width: x1 - x0, height: height - MARGIN.bottom - MARGIN.top + 18, class: 'stretch' }));
      svg.append(el('text', { x: x0 + 6, y: MARGIN.top - 6, class: 'stretch-label' }, highlight.label));
    }
    yAxis(svg, ticks, y, width);
    svg.append(el('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: y(0), y2: y(0), class: 'baseline' }));

    for (const row of rows) {
      let top = y(0);
      const visible = row.parts.filter((p) => p.value > 0);
      const g = el('g', { opacity: row.year === partialYear ? 0.4 : 1 });
      visible.forEach((part, k) => {
        const h = y(0) - y(part.value);
        const isTop = k === visible.length - 1;
        const drawn = Math.max(0, h - (k > 0 ? GAP : 0));
        top -= h;
        if (drawn > 0) {
          g.append(el('path', { d: barPath(center(row.year) - barW / 2, top + (h - drawn), barW, drawn, isTop), style: `fill:${color[part.key]}` }));
        }
      });
      svg.append(g);
    }

    markers.forEach((m, k) => {
      const mx = center(m.year) - band / 2;
      svg.append(el('line', { x1: mx, x2: mx, y1: MARGIN.top - 4, y2: height - MARGIN.bottom, class: 'break-line' }));
      svg.append(el('circle', { cx: mx, cy: MARGIN.top - 4, r: 8, class: 'break-badge' }));
      svg.append(el('text', { x: mx, y: MARGIN.top, 'text-anchor': 'middle', class: 'break-num' }, String(k + 1)));
    });
    xLabels(svg, years, center, height);

    const tip = tooltip(container);
    for (const row of rows) {
      const hit = el('rect', { x: center(row.year) - band / 2, y: MARGIN.top, width: band, height: height - MARGIN.top - MARGIN.bottom, class: 'hit' });
      hit.addEventListener('pointerenter', () => {
        const parts = [...row.parts].sort((a, b) => b.value - a.value).filter((p) => p.value > 0).slice(0, 5);
        tip.show(
          [
            [`${row.year}${row.year === partialYear ? ' (año en curso)' : ''}`, `${formatNumber(row.total)} eventos`],
            ...parts.map((p) => [label[p.key], formatNumber(Math.round(p.value)), color[p.key]]),
          ],
          center(row.year),
          y(row.total),
        );
      });
      hit.addEventListener('pointerleave', () => tip.hide());
      svg.append(hit);
    }
    container.prepend(svg);
  });
}

/** Annual series with its Theil-Sen fit and an optional event-year marker. */
export function trendLine(container, { points, fit, decimals = 1, unit = '', eventX, height = 170 }) {
  responsive(container, (width) => {
    const svg = el('svg', { width, height, role: 'img', class: 'chart' });
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys), 3);
    const x = scale(xs[0], xs.at(-1), MARGIN.left, width - MARGIN.right);
    const y = scale(ticks[0], ticks.at(-1), height - MARGIN.bottom, 12);
    yAxis(svg, ticks, y, width, decimals > 1 ? 2 : decimals === 1 && ticks.at(-1) < 10 ? 1 : 0);
    if (eventX != null && eventX >= xs[0] && eventX <= xs.at(-1)) {
      svg.append(el('line', { x1: x(eventX), x2: x(eventX), y1: 12, y2: height - MARGIN.bottom, class: 'event-line' }));
    }
    svg.append(el('path', { d: points.map((p, k) => `${k ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join(''), class: 'series-line' }));
    if (fit) {
      const f = (v) => fit.intercept + fit.slope * v;
      svg.append(el('line', { x1: x(xs[0]), y1: y(f(xs[0])), x2: x(xs.at(-1)), y2: y(f(xs.at(-1))), class: 'fit-line' }));
    }
    const last = points.at(-1);
    svg.append(el('circle', { cx: x(last.x), cy: y(last.y), r: 4, class: 'series-dot' }));
    xLabels(svg, xs, x, height, 64);

    const tip = tooltip(container);
    const cross = el('line', { y1: 12, y2: height - MARGIN.bottom, class: 'crosshair', visibility: 'hidden' });
    const hit = el('rect', { x: MARGIN.left, y: 0, width: width - MARGIN.left - MARGIN.right, height, class: 'hit' });
    hit.addEventListener('pointermove', (evt) => {
      const px = evt.offsetX;
      const nearest = points.reduce((best, p) => (Math.abs(x(p.x) - px) < Math.abs(x(best.x) - px) ? p : best));
      cross.setAttribute('x1', x(nearest.x));
      cross.setAttribute('x2', x(nearest.x));
      cross.setAttribute('visibility', 'visible');
      tip.show([[String(nearest.x), `${formatNumber(nearest.y, decimals)}${unit ? ` ${unit}` : ''}`]], x(nearest.x), y(nearest.y));
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      tip.hide();
    });
    svg.append(cross, hit);
    container.prepend(svg);
  });
}

/** One dot per year for the same pre-event window; the event year stands out. */
export function strip(container, { values, event, decimals = 1, unit = '', height = 64 }) {
  responsive(container, (width) => {
    const svg = el('svg', { width, height, role: 'img', class: 'chart' });
    const all = [...values.map((v) => v.value), event.value];
    const pad = (Math.max(...all) - Math.min(...all)) * 0.04 || 1;
    const x = scale(Math.min(...all) - pad, Math.max(...all) + pad, 12, width - 12);
    const mid = height / 2 + 4;
    const sorted = [...values].map((v) => v.value).sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    if (sorted.length >= 5) {
      svg.append(el('rect', { x: x(q(0.1)), y: mid - 14, width: Math.max(1, x(q(0.9)) - x(q(0.1))), height: 28, class: 'usual-band', rx: 4 }));
      svg.append(el('text', { x: x(q(0.1)) + 4, y: mid - 18, class: 'tick' }, 'habitual (p10–p90)'));
    }
    svg.append(el('line', { x1: 12, x2: width - 12, y1: mid, y2: mid, class: 'baseline' }));
    const tip = tooltip(container);
    values.forEach((v, k) => {
      const dot = el('circle', { cx: x(v.value), cy: mid + ((k % 3) - 1) * 5, r: 4, class: 'strip-dot' });
      dot.addEventListener('pointerenter', () => tip.show([[String(v.year), `${formatNumber(v.value, decimals)} ${unit}`]], x(v.value), mid));
      dot.addEventListener('pointerleave', () => tip.hide());
      svg.append(dot);
    });
    svg.append(el('circle', { cx: x(event.value), cy: mid, r: 7, class: 'strip-event' }));
    const anchor = x(event.value) > width * 0.8 ? 'end' : x(event.value) < width * 0.2 ? 'start' : 'middle';
    svg.append(el('text', { x: x(event.value), y: height - 2, 'text-anchor': anchor, class: 'strip-label' }, `${event.year}: ${formatNumber(event.value, decimals)} ${unit}`));
    container.prepend(svg);
  });
}

/** Legend row: colored swatch beside text-token label. */
export function legend(container, keys) {
  container.replaceChildren(
    ...keys.map((k) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.background = k.color;
      const text = document.createElement('span');
      text.textContent = k.label;
      item.append(sw, text);
      return item;
    }),
  );
}
