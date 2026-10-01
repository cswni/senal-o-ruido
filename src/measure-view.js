// Chapter 02: map of EONET events on NASA GIBS imagery and the place search.
// The case file for a picked event or place lives in case-view.js.

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search';
const MARKER = Object.freeze({ radius: 5, weight: 1, color: '#fff', fillColor: '#eb6834', fillOpacity: 0.85 });
const MARKER_SELECTED = Object.freeze({ radius: 9, weight: 3, color: '#fff', fillColor: '#1c3faa', fillOpacity: 1 });

export function createMap(node, onPick) {
  const map = L.map(node, { preferCanvas: true, worldCopyJump: true, minZoom: 1, maxZoom: 10 }).setView([20, -20], 2);
  L.tileLayer(`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, {
    maxNativeZoom: 8,
    attribution: 'Imágenes: NASA GIBS / Blue Marble',
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  // Leaflet only measures its container once; keep it in sync with layout changes.
  new ResizeObserver(() => map.invalidateSize()).observe(node);
  let selected = null;
  let pin = null;

  const deselect = () => {
    selected?.setStyle(MARKER);
    selected = null;
  };

  map.on('click', (e) => {
    deselect();
    onPick({ kind: 'place', lat: e.latlng.lat, lon: L.Util.wrapNum(e.latlng.lng, [-180, 180], true) });
  });

  return {
    showEvents(events) {
      layer.clearLayers();
      selected = null;
      for (const event of events) {
        const marker = L.circleMarker([event.y, event.x], { ...MARKER, bubblingMouseEvents: false });
        // Leaflet writes string tooltips with innerHTML; feed titles are untrusted, so pass a text node.
        marker.bindTooltip(document.createTextNode(`${event.t} · ${event.d}`));
        marker.on('click', () => {
          deselect();
          pin?.remove();
          marker.setStyle(MARKER_SELECTED).bringToFront();
          selected = marker;
          onPick({ kind: 'event', event });
        });
        layer.addLayer(marker);
      }
    },
    clear() {
      layer.clearLayers();
      selected = null;
    },
    showPlace(lat, lon) {
      deselect();
      pin?.remove();
      pin = L.circleMarker([lat, lon], { ...MARKER_SELECTED, bubblingMouseEvents: false }).addTo(map);
    },
    flyTo(lat, lon) {
      map.flyTo([lat, lon], Math.max(map.getZoom(), 6), { duration: 0.8 });
    },
  };
}

/** Place search through the Open-Meteo geocoder (no key, CORS enabled). */
export async function geocode(query, signal) {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const params = new URLSearchParams({ name: q, count: '5', language: 'es', format: 'json' });
  const res = await fetch(`${GEOCODER}?${params}`, { signal });
  if (!res.ok) throw new Error('El buscador de lugares no respondió');
  const { results = [] } = await res.json();
  return results
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
    }));
}
