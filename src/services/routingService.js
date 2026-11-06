import { haversineDistance } from '../algorithms/haversine.js';

// 1. Geocoding gratuito con Nominatim (Convierte texto a lat/lng)
export async function geocodeLocation(query) {
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

// Obtiene hasta 5 sugerencias coincidentes con lo que escribe el usuario
export async function fetchAddressSuggestions(query) {
  if (!query || query.trim().length < 3) return [];

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=pe`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();

    return data.map(item => ({
      displayName: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon)
    }));
  } catch (error) {
    console.error("Error al obtener sugerencias:", error);
    return [];
  }
}

// Convierte coordenadas GPS (lat, lng) en nombre de dirección real
export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (error) {
    console.error("Error en geocodificación inversa:", error);
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}