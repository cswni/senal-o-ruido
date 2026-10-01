// Tiny DOM helpers. All text goes through textContent (feed data is untrusted).

import { formatNumber } from './narrative.js';

export function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

export function link(text, href) {
  const a = node('a', null, text);
  a.href = href;
  a.rel = 'noopener';
  a.target = '_blank';
  return a;
}

export const fmtCoord = (lat, lon) =>
  `${formatNumber(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}, ${formatNumber(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'O'}`;

export function skeleton(lines = 3) {
  const wrap = node('div', 'skeleton-group');
  for (let k = 0; k < lines; k += 1) wrap.append(node('div', 'skeleton'));
  return wrap;
}

export function bandTag(text, band) {
  const tag = node('span', 'band-tag', text);
  tag.dataset.band = band;
  return tag;
}

export function chartBox() {
  return node('div', 'chart-box');
}
