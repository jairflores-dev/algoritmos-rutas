import { haversineDistance } from '../algorithms/haversine.js';

// 1. Geocoding de una búsqueda enviada (texto → lat/lng).
//    Primero Photon (con sesgo hacia donde está el usuario); Nominatim queda de respaldo.
export async function geocodeLocation(query, { bias } = {}) {
  try {
    const [first] = await photonSearch(query, { bias, limit: 1 });
    if (first) return { lat: first.lat, lng: first.lng, displayName: first.label };
  } catch (err) {
    console.warn('Photon no respondió, se usa Nominatim:', err);
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const response = await fetch(url);
  const data = await response.json();

  if (!data || data.length === 0) {
    throw new Error(`No se encontró la ubicación: "${query}"`);
  }

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name
  };
}

// 2. Obtiene la red vial entre dos coordenadas y genera la estructura de Grafo
export async function fetchDynamicGraph(startCoords, targetCoords) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startCoords.lng},${startCoords.lat};${targetCoords.lng},${targetCoords.lat}?overview=full&geometries=geojson&steps=true`;
  
  const response = await fetch(url);
  const data = await response.json();

  if (!data.routes || data.routes.length === 0) {
    throw new Error("No se pudo calcular una red de calles entre esos dos puntos.");
  }

  const coordinates = data.routes[0].geometry.coordinates; // [lng, lat]
  const nodes = {};
  const edges = {};

  // Crear nodos a partir de las intersecciones/puntos de la ruta
  coordinates.forEach((coord, idx) => {
    const id = idx === 0 ? "START" : idx === coordinates.length - 1 ? "TARGET" : `node_${idx}`;
    nodes[id] = {
      lat: coord[1],
      lng: coord[0],
      name: idx === 0 ? "Origen" : idx === coordinates.length - 1 ? "Destino" : `Intersección ${idx}`
    };
  });

  // Conectar nodos adyacentes formando las aristas del grafo
  const nodeKeys = Object.keys(nodes);
  for (let i = 0; i < nodeKeys.length - 1; i++) {
    const currentId = nodeKeys[i];
    const nextId = nodeKeys[i + 1];

    const dist = haversineDistance(
      nodes[currentId].lat, nodes[currentId].lng,
      nodes[nextId].lat, nodes[nextId].lng
    );

    if (!edges[currentId]) edges[currentId] = [];
    if (!edges[nextId]) edges[nextId] = [];

    edges[currentId].push({ target: nextId, weight: dist, oneWay: false });
    edges[nextId].push({ target: currentId, weight: dist, oneWay: false });
  }

  return { nodes, edges };
}

/* =====================================================================
   Sugerencias de búsqueda (autocompletado)
   Photon está pensado para "buscar mientras se escribe"; Nominatim público no.
   ===================================================================== */

const PHOTON_URL = 'https://photon.komoot.io/api/';
const MAX_CACHE = 60;
const suggestionCache = new Map();
let suggestionAbort = null;

// Convierte un resultado de Photon (GeoJSON) en una sugerencia lista para mostrar
function toSuggestion(feature) {
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;

  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const title = p.name || street || p.city || p.state || p.country || '';
  if (!title) return null;

  // Detalle: calle (si el título es un lugar), barrio, ciudad, región y país, sin repetir
  const raw = [p.name ? street : '', p.district || p.locality, p.city, p.state, p.country];
  const seen = new Set([title.toLowerCase()]);
  const parts = [];
  for (const part of raw) {
    if (part && !seen.has(part.toLowerCase())) {
      seen.add(part.toLowerCase());
      parts.push(part);
    }
  }

  const subtitle = parts.slice(0, 3).join(', ');
  return {
    title,
    subtitle,
    label: parts[0] ? `${title}, ${parts[0]}` : title, // texto corto que queda en el campo
    lat,
    lng
  };
}

async function photonSearch(query, { bias, limit = 5, signal } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit + 3) });
  if (bias) {
    params.set('lat', bias.lat.toFixed(4));
    params.set('lon', bias.lng.toFixed(4));
  }

  const response = await fetch(`${PHOTON_URL}?${params}`, { signal });
  if (!response.ok) throw new Error(`Photon respondió ${response.status}`);
  const data = await response.json();

  const unique = new Map();
  for (const feature of data.features || []) {
    const item = toSuggestion(feature);
    if (!item) continue;
    const key = `${item.title}|${item.subtitle}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, limit);
}

/**
 * Hasta 5 sugerencias para lo que escribe el usuario.
 * - Cancela la petición anterior si el usuario sigue escribiendo.
 * - Recuerda resultados ya consultados.
 * @param {string} query
 * @param {{bias?: {lat:number, lng:number}}} options  bias: da prioridad a lugares cercanos
 * @returns {Promise<Array|null>} null = petición cancelada (se debe ignorar);
 *   lanza error si el servicio no responde.
 */
export async function fetchAddressSuggestions(query, { bias } = {}) {
  const q = (query || '').trim();
  if (q.length < 3) return [];

  // El sesgo se redondea para que el caché sirva aunque el mapa se mueva un poco
  const key = `${q.toLowerCase()}|${bias ? `${bias.lat.toFixed(1)},${bias.lng.toFixed(1)}` : ''}`;
  if (suggestionCache.has(key)) return suggestionCache.get(key);

  if (suggestionAbort) suggestionAbort.abort();
  suggestionAbort = new AbortController();
  const { signal } = suggestionAbort;

  try {
    const items = await photonSearch(q, { bias, signal });
    if (suggestionCache.size >= MAX_CACHE) {
      suggestionCache.delete(suggestionCache.keys().next().value);
    }
    suggestionCache.set(key, items);
    return items;
  } catch (error) {
    if (error.name === 'AbortError') return null;
    throw error;
  }
}
