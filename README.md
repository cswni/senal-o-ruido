# Señal o Ruido

**Detector de tendencias del sistema Tierra que audita sus propios sesgos.**
NASA Space Apps Challenge 2026 · *Be an Earth System Trend Detective!*

> Antes de creerle a una tendencia, pregúntale de dónde vienen los datos.

**Demo en vivo:** https://cswni.github.io/senal-o-ruido/

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

**Capítulo 03 (dentro de cada expediente): La cadena de impacto.** Cada evento o lugar
muestra su impacto en tres horizontes de tiempo. Cada tarjeta lleva un **nivel de evidencia**
para no afirmar más de lo que los datos permiten:

| Nivel | Significado |
|---|---|
| Medido en el punto | NASA POWER exactamente donde ocurrió el evento |
| Modelo atmosférico | Calidad del aire de CAMS (Copernicus) para ese punto |
| Exposición | Lo que estaba en riesgo, no lo que se perdió |
| Contexto nacional | Lo que ocurrió en el país ese año: coincidencia, no causalidad |

- **Inmediato (días), salud:**
  - *Calor:* índice de calor de NOAA (regresión de Rothfusz), con la humedad en la hora de
    máxima temperatura calculada a partir de la humedad específica (QV2M) y la presión (PS).
    Cuenta los días en cada categoría de NOAA y muestra su efecto documentado en la salud.
  - *Humo:* PM2.5 diario frente a la guía de la OMS (15 µg/m³ en 24 h, 2021) y frente al
    nivel habitual del lugar. Disponible desde agosto de 2022.
- **Corto plazo (semanas a meses):**
  - *Agua y suelo:* anomalías de lluvia y humedad del suelo, con una señal de estrés hídrico
    para cultivos, vegetación y combustible.
  - *Biodiversidad (GBIF):* registros de especies amenazadas de la Lista Roja de la UICN en
    25 km. Audita el esfuerzo de observación: más registros no significa más fauna.
- **Largo plazo (años a décadas):**
  - *Tendencias en el punto:* días de calor peligroso por año, temperatura, lluvia y humedad
    del suelo desde 1981.
  - *Contexto del país (Banco Mundial):* esperanza de vida, rendimiento de cereales,
    crecimiento del PIB, superficie forestal y exposición a PM2.5. Indica si el año del evento
    salió de la variación habitual (desviación robusta frente a 15 años previos) y detecta
    saltos bruscos típicos de revisiones metodológicas de la serie.

Los indicadores de salud son de riesgo a nivel población. No son diagnóstico ni consejo médico.

## Hallazgos con datos reales (snapshot 2000–2026)

| Fenómeno | Veredicto | Motivo |
|---|---|---|
| Tormentas severas | Sin tendencia (26 años, p = 0,81) | Única serie de EONET con cobertura estable; coincide con el consenso de que la frecuencia global de ciclones no muestra una tendencia clara |
| Incendios | Artefacto | Arranque de cobertura en 2015 y entrada de GDACS en 2024 |
| Volcanes | Artefacto | Escalón ×2,5 en 2015 que coincide con el cambio de feeds del catálogo |
| Inundaciones, hielo | Artefacto | Cambios de fuente (hielo: 2011, 2019; inundaciones: 2015, 2019, 2025) |
| Sequía, sismos, nieve… | Datos insuficientes | < 3 eventos/año |

Ejemplos de la cadena de impacto con datos reales:

- **Mérida (Yucatán):** los días con índice de calor de peligro (≥ 39,4 °C) pasaron de 36 al
  año (1981) a 132 (2025): **+10,8 por década** (p < 0,001). Sevilla: de 2 a 30.
- **Incendio de 55.865 ha en Canadá (mayo de 2025):** PM2.5 de **79 µg/m³**, 5,3 veces la
  guía de la OMS y 23 veces el nivel habitual del lugar, tras 90 días más secos que el 82 % de
  los años anteriores.
- **Australia 2020:** el PIB sale "fuera de lo habitual", pero por la pandemia, no por los
  incendios. Por eso el contexto nacional se etiqueta como coincidencia.
- **Canadá:** la superficie forestal salta +0,8 puntos en 2021, un salto que la app marca como
  probable revisión de la serie.

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

App 100 % estática, sin backend ni API keys. Fuentes consultadas desde el navegador:
NASA POWER, NASA GIBS, CAMS/Open-Meteo, GBIF, Banco Mundial y OpenStreetMap (Nominatim). Se puede desplegar en GitHub Pages.

| Archivo | Responsabilidad |
|---|---|
| `src/stats.js` | Mann-Kendall (con corrección por empates), Theil-Sen, Pettitt, percentiles |
| `src/audit.js` | Detección de quiebres del catálogo, tramos comparables y veredicto |
| `src/power.js` | Cliente NASA POWER, series anuales, ventanas y anomalías |
| `src/narrative.js` | Todas las frases en lenguaje simple (puras y testeadas) |
| `src/heat.js` | Índice de calor NOAA y humedad relativa en la hora de Tmax |
| `src/air.js` | PM2.5 (CAMS vía Open-Meteo), medias diarias y comparación con la OMS |
| `src/fauna.js` | Exposición de biodiversidad (GBIF) y auditoría del esfuerzo de observación |
| `src/context.js` | Indicadores del Banco Mundial, línea base robusta y saltos de revisión |
| `src/impact-narrative.js` | Frases de la cadena de impacto (puras y testeadas) |
| `src/case-view.js`, `src/impact-cards.js` | Expediente por horizontes de tiempo |
| `src/eonet.js` | Snapshot y feed en vivo de EONET |
| `src/charts.js` | Gráficas SVG sin dependencias, con tooltips |
| `src/audit-view.js`, `src/measure-view.js`, `src/app.js` | Interfaz |
| `scripts/build-snapshot.mjs` | Descarga EONET 2000→hoy y genera `data/` |

Los datos de EONET se pre-construyen porque descargar un año de incendios tarda unos 20 s
y pesa 5 MB. NASA POWER responde en unos 1,5 s para 45 años diarios, así que se consulta en vivo.

## Limitaciones honestas

- El índice de calor usa la temperatura máxima diaria de una malla de ~0,5°: subestima islas de
  calor urbanas y no reemplaza los avisos oficiales.
- La calidad del aire es un modelo (CAMS), no una estación; suaviza los picos locales de humo.
- GBIF cuenta registros, no individuos ni especies, y crece con el número de observadores.

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
- Datos de la OMS (Global Health Observatory) pre-construidos, porque su API no permite CORS.
- Población expuesta por evento con NASA SEDAC (GPW).
