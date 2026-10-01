// Plain-language Spanish copy for the impact chain (health, air, biodiversity,
// national context). Pure functions, so every sentence is testable.

import { formatNumber, formatSigned, chanceOfLuck } from './narrative.js';
import { median } from './stats.js';

export const EVIDENCE = Object.freeze({
  measured: {
    label: 'Medido en el punto',
    explain: 'Observación satelital o reanálisis de la NASA exactamente donde ocurrió el evento.',
  },
  model: {
    label: 'Modelo atmosférico',
    explain: 'Estimación de un modelo de calidad del aire (CAMS, Copernicus) para ese punto.',
  },
  exposure: {
    label: 'Exposición',
    explain: 'Lo que estaba en riesgo en la zona, no lo que se perdió.',
  },
  context: {
    label: 'Contexto nacional',
    explain: 'Lo que ocurrió en el país ese año. Coincidencia, no causalidad.',
  },
});

export const HORIZONS = Object.freeze({
  immediate: { label: 'Inmediato', span: 'días' },
  short: { label: 'Corto plazo', span: 'semanas a meses' },
  long: { label: 'Largo plazo', span: 'años a décadas' },
});

/** NOAA/NWS descriptions of each heat index category (paraphrased in Spanish). */
export const HEAT_HEALTH_EFFECTS = Object.freeze({
  caution: 'Fatiga posible con exposición prolongada o actividad física.',
  'extreme-caution': 'Posibles calambres, agotamiento o golpe de calor con exposición prolongada.',
  danger: 'Calambres o agotamiento por calor probables y golpe de calor posible con exposición prolongada o actividad física.',
  'extreme-danger': 'Golpe de calor muy probable con exposición continuada.',
});

const HEAT_METRICS = Object.freeze({
  DANGER: { days: 'días con índice de calor de peligro (≥ 39,4 °C)', title: 'Días de peligro por año' },
  HOT: { days: 'días con índice de calor de precaución extrema o más (≥ 32,2 °C)', title: 'Días de calor extremo por año' },
});

export function heatWindowSentence({ metric, anomaly, lead }) {
  const m = HEAT_METRICS[metric];
  const typical = formatNumber(median(anomaly.baseline), 0);
  return `${lead} hubo ${formatNumber(anomaly.value, 0)} ${m.days}; en un año típico, ${typical}.`;
}

export function heatTrendSentence(metric, trend) {
  const m = HEAT_METRICS[metric];
  const verdict = trend.mk.significant ? 'tendencia significativa' : 'no significativa';
  return `${m.title}: ${formatSigned(trend.perDecade, 1)} por década (${trend.start}–${trend.end}), ${verdict} (probabilidad de azar: ${chanceOfLuck(trend.mk.p)}).`;
}

export function airSentence(s) {
  const usualShare = s.usualExceedanceShare == null ? '' : ` En días normales eso ocurre el ${formatNumber(s.usualExceedanceShare * 100, 0)} % de las veces.`;
  const vsUsual = s.peakVsUsual == null ? '' : ` y ${formatNumber(s.peakVsUsual, 1)} veces el nivel habitual del lugar`;
  return (
    `Pico de PM2.5: ${formatNumber(s.peak.value, 0)} µg/m³ el ${s.peak.date}, ` +
    `${formatNumber(s.peakVsGuideline, 1)} veces la guía de la OMS (15 µg/m³ en 24 h)${vsUsual}. ` +
    `${s.exceedances} de ${s.windowDays} días superaron la guía.${usualShare}`
  );
}

export function faunaSentence(f, radiusKm) {
  const r = f.redList;
  if (r.threatened === 0) {
    return `En ${radiusKm} km hay ${formatNumber(f.total)} registros de biodiversidad y ningún registro de especies amenazadas en la Lista Roja de la UICN.`;
  }
  return (
    `En ${radiusKm} km hay ${formatNumber(r.threatened)} registros de especies amenazadas según la Lista Roja de la UICN ` +
    `(${formatNumber(r.CR)} en peligro crítico, ${formatNumber(r.EN)} en peligro, ${formatNumber(r.VU)} vulnerables), ` +
    `de ${formatNumber(f.total)} registros en total.`
  );
}

export function samplingSentence(audit) {
  if (!audit) return '';
  const pct = formatNumber(audit.recentShare * 100, 0);
  if (audit.effortGrowing) {
    return `Ojo: el ${pct} % de los registros son de los últimos ${audit.recentYears} años. Crece el esfuerzo de observación (más personas y apps), así que esto indica presencia, no tendencias de población.`;
  }
  if (audit.effortDeclining) {
    return `El esfuerzo de observación ha disminuido (${pct} % de los registros en los últimos ${audit.recentYears} años); menos registros recientes no implica menos fauna.`;
  }
  return `El esfuerzo de observación no muestra una tendencia detectable (${pct} % de los registros en los últimos ${audit.recentYears} años). Aun así, los registros indican presencia, no abundancia.`;
}

export function contextSentence(indicator, year, dev) {
  const fmt = (v) => `${formatNumber(v, indicator.decimals)} ${indicator.unit}`;
  switch (dev.status) {
    case 'ok':
      return dev.unusual
        ? `En ${year}: ${fmt(dev.actual)} frente a ${fmt(dev.expected)} esperado. Fuera de lo habitual, aunque puede deberse a otras causas del mismo año.`
        : `En ${year}: ${fmt(dev.actual)} (esperado ${fmt(dev.expected)}), dentro de la variación habitual.`;
    case 'missing':
      return `El dato de ${year} aún no se publica (último disponible: ${dev.latestYear ?? 'ninguno'}).`;
    default:
      return 'Serie demasiado corta para comparar con años anteriores.';
  }
}

export function revisionSentence(indicator, jump) {
  return `Salto brusco en ${jump.year}: ${formatSigned(jump.change, indicator.decimals)} ${indicator.unit} en un solo año, muy por encima de su variación normal. Suele indicar una revisión metodológica de la serie o un choque real (como una pandemia); tómalo con cautela.`;
}

const GROUPS = Object.freeze({
  Aves: 'Aves',
  Mammalia: 'Mamíferos',
  Amphibia: 'Anfibios',
  Squamata: 'Reptiles escamosos',
  Testudines: 'Tortugas',
  Crocodylia: 'Cocodrilos',
  Actinopterygii: 'Peces',
  Elasmobranchii: 'Tiburones y rayas',
  Insecta: 'Insectos',
  Arachnida: 'Arácnidos',
  Gastropoda: 'Caracoles',
  Bivalvia: 'Moluscos bivalvos',
  Anthozoa: 'Corales',
  Magnoliopsida: 'Plantas con flor',
  Liliopsida: 'Plantas con flor (monocotiledóneas)',
  Pinopsida: 'Coníferas',
  Polypodiopsida: 'Helechos',
  Bryopsida: 'Musgos',
});

export const groupName = (cls) => GROUPS[cls] ?? cls;
