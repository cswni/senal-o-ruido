// Plain-language Spanish copy for every statistical result in the app.
// Kept pure (no DOM) so every sentence is testable.

const LOCALE = 'es-ES';
const MINUS = '−';

export function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: Math.abs(value) >= 10000 ? true : 'min2',
  }).format(value);
}

export function formatSigned(value, decimals = 0) {
  const text = formatNumber(Math.abs(value), decimals);
  if (Number(text.replace(',', '.')) === 0) return text;
  return value < 0 ? `${MINUS}${text}` : `+${text}`;
}

/** p-value as "probability this is just luck", in percent. */
export function chanceOfLuck(p) {
  if (p < 0.001) return 'menos de 0,1 %';
  const pct = p * 100;
  return `${formatNumber(pct, pct < 10 ? 1 : 0)} %`;
}

const VERDICTS = Object.freeze({
  real: {
    label: 'Tendencia real',
    icon: '✓',
    tone: 'good',
    lead: 'El cambio se sostiene con fuentes comparables.',
  },
  stable: {
    label: 'Sin tendencia',
    icon: '=',
    tone: 'neutral',
    lead: 'Con fuentes comparables, no hay cambio distinguible del azar.',
  },
  artifact: {
    label: 'Artefacto de catálogo',
    icon: '!',
    tone: 'serious',
    lead: 'Lo que cambió fue el catálogo, no necesariamente el planeta.',
  },
  insufficient: {
    label: 'Datos insuficientes',
    icon: '?',
    tone: 'warning',
    lead: 'No hay registro comparable suficiente para juzgar.',
  },
});

export function verdictCopy(verdict) {
  return VERDICTS[verdict] ?? VERDICTS.insufficient;
}

const EDGE = 3;
const avg = (rows) => rows.reduce((acc, r) => acc + r.total, 0) / rows.length;
const span = (rows) => `${rows[0].year}–${rows.at(-1).year}`;

/** What a naive dashboard would print for this series. */
export function naiveHeadline(audit, title) {
  const rows = audit.analysisYears;
  if (rows.length < EDGE * 2) return `${title}: registro demasiado corto`;
  const first = rows.slice(0, EDGE);
  const last = rows.slice(-EDGE);
  const range = `entre ${span(first)} y ${span(last)}`;
  if (audit.naive.changePct != null) {
    return `${title}: ${formatSigned(audit.naive.changePct, 0)} % ${range}`;
  }
  return `${title}: de ${formatNumber(avg(first), 0)} a ${formatNumber(avg(last), 0)} eventos por año ${range}`;
}

const sourceName = (id, sources) => sources?.[id]?.title ?? id;

export function breakSentence(brk, sources) {
  const names = (ids) => ids.map((id) => sourceName(id, sources)).join(', ');
  switch (brk.kind) {
    case 'composition': {
      if (brk.entering.length) return `${brk.year}: entra ${names(brk.entering)} y cambia la mezcla de fuentes.`;
      if (brk.leaving.length) return `${brk.year}: deja de reportar ${names(brk.leaving)}.`;
      return `${brk.year}: la mezcla de fuentes cambia por completo.`;
    }
    case 'onset':
      return `${brk.year}: arranque de cobertura; el catálogo pasa de casi nada a registrar el fenómeno.`;
    case 'volume':
      return `${brk.year}: salto de volumen ×${formatNumber(brk.ratio, 1)} en un solo año, típico de un cambio operativo.`;
    case 'step':
      return `${brk.year}: escalón ×${formatNumber(brk.ratio, 1)} que coincide con un cambio de fuentes de todo el catálogo.`;
    default:
      return `${brk.year}: cambio en el catálogo.`;
  }
}

const years = (segment) => segment.end - segment.start + 1;

export function auditConclusion(audit) {
  const { verdict, segment } = audit;
  const stretch = segment ? `${segment.start}–${segment.end}` : null;
  const luck = segment ? chanceOfLuck(segment.mk.p) : null;
  switch (verdict) {
    case 'artifact':
      return segment
        ? `El cambio aparente coincide con cambios en las fuentes del catálogo. En el tramo comparable más largo (${stretch}) la tendencia ${segment.mk.trend === 'none' ? 'no es significativa' : 'va en otra dirección'} (probabilidad de azar: ${luck}).`
        : 'El cambio aparente coincide con cambios en las fuentes del catálogo, y ningún tramo comparable es lo bastante largo para medir una tendencia propia.';
    case 'real':
      return `En ${years(segment)} años con fuentes comparables (${stretch}) el cambio es de ${formatSigned(segment.sen.slope, 1)} eventos por año. La probabilidad de que sea azar es ${luck}.`;
    case 'stable':
      return `En ${years(segment)} años con fuentes comparables (${stretch}) no hay tendencia significativa: la probabilidad de que el cambio observado sea azar es ${luck}.`;
    default:
      return 'Hay muy pocos eventos por año o tramos comparables de menos de 8 años. No hay base para afirmar una tendencia.';
  }
}

/** Measured trend at a point, e.g. "+0,3 °C por década (1981–2025)". */
export function trendSentence(meta, trend) {
  const unit = meta.unit ? ` ${meta.unit}` : '';
  const slope = `${formatSigned(trend.perDecade, meta.decimals)}${unit} por década`;
  const verdict = trend.mk.significant
    ? `tendencia significativa (probabilidad de azar: ${chanceOfLuck(trend.mk.p)})`
    : `no significativa (probabilidad de azar: ${chanceOfLuck(trend.mk.p)})`;
  return `${meta.label}: ${slope} (${trend.start}–${trend.end}), ${verdict}.`;
}

/**
 * A window compared with the same window in earlier years.
 * `lead` names the window, e.g. "En los 90 días previos al evento".
 */
export function anomalySentence(meta, anomaly, lead) {
  const label = meta.label.toLowerCase();
  const pct = Math.round(anomaly.percentile);
  const base = `los ${anomaly.baseline.length} años anteriores`;
  if (anomaly.band === 'very-high' || anomaly.band === 'high') {
    return `${lead}, la ${label} fue más alta que en el ${pct} % de ${base}.`;
  }
  if (anomaly.band === 'very-low' || anomaly.band === 'low') {
    return `${lead}, la ${label} fue más baja que en el ${100 - pct} % de ${base}.`;
  }
  return `${lead}, la ${label} estuvo dentro de lo habitual (percentil ${pct} frente a ${base}).`;
}
