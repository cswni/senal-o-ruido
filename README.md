# Señal o Ruido

**Detector de tendencias del sistema Tierra que audita sus propios sesgos.**
NASA Space Apps Challenge 2026 · *Be an Earth System Trend Detective!*

> Antes de creerle a una tendencia, pregúntale de dónde vienen los datos.

## El problema

El reto pide determinar **qué** cambia, **dónde**, **cuánto** y si es **significativo**.
El atajo obvio es graficar los eventos de NASA EONET por año. Esto es lo que sale:

| Incendios en EONET | Eventos |
|---|---|
| 2022 | 157 |
| 2023 | 97 |
| 2024 | **5.615** |

Un dashboard ingenuo concluiría que los incendios se multiplicaron ×35. En realidad,
en 2024 el catálogo empezó a recibir los feeds de **GDACS** e **IRWIN**. El planeta no
cambió así: cambió el catálogo. EONET es un *agregador* de fuentes externas, y cada vez
que se incorpora o se retira una fuente, los conteos saltan.

## La solución

**Capítulo 01: El juicio de la tendencia.** Para cada fenómeno de EONET:

1. Muestra lo que diría un dashboard ingenuo.
2. Detecta automáticamente los **quiebres del catálogo**:
   - *composición*: cambia la mezcla de fuentes (distancia de variación total ≥ 0,5);
   - *volumen*: salto ×4 en un año;
   - *arranque de cobertura*: de casi cero a decenas de eventos;
   - *escalón*: cambio de nivel detectado con la prueba de **Pettitt** que coincide (±1 año)
     con un quiebre de fuentes de **todo el catálogo**.
3. Solo juzga tendencias dentro del **tramo comparable** más largo (≥ 8 años, ≥ 3 eventos/año),
   con **Mann-Kendall** (significancia) y **Theil-Sen** (magnitud).
4. Emite un veredicto: ✓ *Tendencia real* · = *Sin tendencia* · ! *Artefacto de catálogo* · ? *Datos insuficientes*.

**Capítulo 02: Del evento a la medición.** Como el catálogo no alcanza, la app usa
**mediciones** de **NASA POWER** (diarias desde 1981) para cualquier evento o lugar:

- ¿Qué tan anómalos fueron los 90 días previos al evento? Se compara con la misma ventana
  de cada año desde 1981 (percentil y puntaje z).
- ¿Cuál es la tendencia de largo plazo en ese punto? Mann-Kendall + Theil-Sen por década.
- Variables: temperatura máxima, precipitación y humedad del suelo en la zona de raíces.
- "Mi lugar": busca tu ciudad y obtén su expediente.

## Hallazgos con datos reales (snapshot 2000–2026)

| Fenómeno | Veredicto | Motivo |
|---|---|---|
| Tormentas severas | Sin tendencia (26 años, p = 0,81) | Única serie de EONET con cobertura estable; coincide con el consenso de que la frecuencia global de ciclones no muestra una tendencia clara |
| Incendios | Artefacto | Arranque de cobertura en 2015 y entrada de GDACS en 2024 |
| Volcanes | Artefacto | Escalón ×2,5 en 2015 que coincide con el cambio de feeds del catálogo |
| Inundaciones, hielo | Artefacto | Cambios de fuente (hielo: 2011, 2019; inundaciones: 2015, 2019, 2025) |
| Sequía, sismos, nieve… | Datos insuficientes | < 3 eventos/año |

Ejemplo en un punto de Sierra Nevada (California): la temperatura máxima sube **+0,29 °C por
década** desde 1981 (p = 0,006). Los 90 días previos al Park Fire (julio de 2024) fueron más
calurosos que el 95 % de los años anteriores.

## Ejecutar

Requisitos: Node ≥ 20 (tests y snapshot) y Python 3 (servidor estático). No hay dependencias npm.

```bash
npm test
```

```bash
npm run serve
```

Abre http://localhost:5173. Para regenerar el snapshot de EONET (tarda unos minutos):

```bash
npm run snapshot
```

## Arquitectura

App 100 % estática, sin backend ni API keys. Se puede desplegar en GitHub Pages.

| Archivo | Responsabilidad |
|---|---|
| `src/stats.js` | Mann-Kendall (con corrección por empates), Theil-Sen, Pettitt, percentiles |
| `src/audit.js` | Detección de quiebres del catálogo, tramos comparables y veredicto |
| `src/power.js` | Cliente NASA POWER, series anuales, ventanas y anomalías |
| `src/narrative.js` | Todas las frases en lenguaje simple (puras y testeadas) |
| `src/eonet.js` | Snapshot y feed en vivo de EONET |
| `src/charts.js` | Gráficas SVG sin dependencias, con tooltips |
| `src/audit-view.js`, `src/measure-view.js`, `src/app.js` | Interfaz |
| `scripts/build-snapshot.mjs` | Descarga EONET 2000→hoy y genera `data/` |

Los datos de EONET se pre-construyen porque descargar un año de incendios tarda unos 20 s
y pesa 5 MB. NASA POWER responde en unos 1,5 s para 45 años diarios, así que se consulta en vivo.

## Limitaciones honestas

- Se asigna cada evento al año de su primera observación. Los eventos con varias categorías cuentan en cada una.
- El año en curso se muestra, pero se excluye de las pruebas de tendencia.
- Mann-Kendall supone independencia entre años. Con autocorrelación fuerte habría que usar la variante con pre-blanqueo (siguiente paso).
- NASA POWER es una malla de ~0,5° (MERRA-2): describe la región alrededor del punto, no una estación local.
- Los umbrales del auditor (0,5 de composición, ×4 de volumen, 8 años mínimos) son configurables en `AUDIT_DEFAULTS`.

## Siguientes pasos

- Mapa de divergencia regional: tendencias por celda hexagonal con corrección FDR.
- Mann-Kendall modificado (Hamed-Rao) para series autocorrelacionadas.
- Capas de NASA GIBS del día del evento (MODIS/VIIRS) en el expediente.
- Tarjetas compartibles que incluyan el veredicto de confiabilidad.
- Interfaz bilingüe ES/EN.
