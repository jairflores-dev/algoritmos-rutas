import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Con Vite, Leaflet no encuentra solo los íconos por defecto: se indican a mano
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

let map = null;
let currentRouteLayer = null;
let markersLayer = null;
let navMarker = null;
let animationTimer = null;
let userLayer = null;
let userMarker = null;
let userCircle = null;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initMap(containerId = 'map', onMapClick) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  if (map !== null) {
    map.remove();
    map = null;
  }

  map = L.map(containerId, { zoomControl: false }).setView([-17.6394, -71.3375], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  currentRouteLayer = L.layerGroup().addTo(map);
  userLayer = L.layerGroup().addTo(map);
  userMarker = null;
  userCircle = null;

  requestAnimationFrame(() => { if (map) map.invalidateSize(); });
  setTimeout(() => { if (map) map.invalidateSize(); }, 250);

  window.addEventListener('resize', () => { if (map) map.invalidateSize(); });

  if (onMapClick) {
    map.on('click', (e) => onMapClick(e.latlng));
  }

  return map;
}

export function renderDynamicMarkers(startCoords, targetCoords) {
  if (!markersLayer) return;
  markersLayer.clearLayers();

  if (startCoords) {
    L.marker([startCoords.lat, startCoords.lng])
      .bindPopup("<b>Origen Seleccionado</b>")
      .addTo(markersLayer);
  }

  if (targetCoords) {
    L.marker([targetCoords.lat, targetCoords.lng])
      .bindPopup("<b>Destino Seleccionado</b>")
      .addTo(markersLayer);
  }
}

export function renderRoute(coords, color = '#1a73e8', { fit = true } = {}) {
  if (!currentRouteLayer || !map) return;
  currentRouteLayer.clearLayers();
  stopNavigationAnimation();

  const polyline = L.polyline(coords, {
    color: color,
    weight: 6,
    opacity: 0.9,
    lineJoin: 'round'
  }).addTo(currentRouteLayer);

  map.invalidateSize();
  // Al recalcular durante la navegación no se mueve la cámara (evita mareo)
  if (fit) map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
}

export function startNavigationAnimation(coords, onStep, onFinish) {
  if (!map || !coords || coords.length === 0) return;

  stopNavigationAnimation();

  const userIcon = L.divIcon({
    className: 'nav-user-marker',
    html: `<div class="user-dot"><span>🚶</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  navMarker = L.marker(coords[0], { icon: userIcon }).addTo(currentRouteLayer);
  map.panTo(coords[0]);

  let step = 0;
  const totalSteps = coords.length;

  animationTimer = setInterval(() => {
    step++;
    if (step < totalSteps) {
      navMarker.setLatLng(coords[step]);
      map.panTo(coords[step]);
      if (onStep) onStep(step, totalSteps);
    } else {
      stopNavigationAnimation();
      if (onFinish) onFinish();
    }
  }, 400);
}

export function stopNavigationAnimation() {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
  if (navMarker) {
    currentRouteLayer.removeLayer(navMarker);
    navMarker = null;
  }
}

/* ================= Ubicación en tiempo real ================= */

// Punto azul con círculo de precisión; si hay rumbo y velocidad, muestra la dirección
export function showUserLocation(fix) {
  if (!map || !userLayer) return;
  const latlng = [fix.lat, fix.lng];

  if (!userMarker) {
    userMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'user-loc-icon',
        html: '<div class="user-loc"><span class="user-loc-cone"></span><span class="user-loc-pulse"></span><span class="user-loc-dot"></span></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 900
    }).addTo(userLayer);

    userCircle = L.circle(latlng, {
      radius: fix.accuracy || 0,
      color: '#1a73e8',
      weight: 1,
      opacity: 0.45,
      fillColor: '#1a73e8',
      fillOpacity: 0.1,
      interactive: false
    }).addTo(userLayer);
  } else {
    userMarker.setLatLng(latlng);
    userCircle.setLatLng(latlng);
    userCircle.setRadius(fix.accuracy || 0);
  }

  const cone = userMarker.getElement()?.querySelector('.user-loc-cone');
  if (cone) {
    const moving = fix.heading != null && !Number.isNaN(fix.heading) && (fix.speed ?? 0) > 0.5;
    cone.style.opacity = moving ? '1' : '0';
    if (moving) cone.style.transform = `rotate(${fix.heading}deg)`;
  }
}

export function clearUserLocation() {
  if (userLayer) userLayer.clearLayers();
  userMarker = null;
  userCircle = null;
}

// Centra una vez, con animación suave
export function centerOnUser(fix, minZoom = 16) {
  if (!map) return;
  const zoom = fix.accuracy > 500 ? Math.min(minZoom, 15) : minZoom;
  map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), zoom), {
    animate: !reduceMotion,
    duration: 0.8
  });
}

// Seguimiento: solo mueve la cámara cuando el usuario se aleja del centro
export function followUser(fix) {
  if (!map) return;
  const size = map.getSize();
  const p = map.latLngToContainerPoint([fix.lat, fix.lng]);
  const offCenter = Math.hypot(p.x - size.x / 2, p.y - size.y / 2);

  if (offCenter > Math.min(size.x, size.y) * 0.22) {
    map.panTo([fix.lat, fix.lng], { animate: !reduceMotion, duration: 0.8, easeLinearity: 0.25 });
  }
}

// Se avisa cuando el usuario arrastra el mapa (para dejar de seguirlo)
export function onMapDragStart(callback) {
  if (map) map.on('dragstart', callback);
}


// Centro actual del mapa (sirve para priorizar sugerencias cercanas)
export function getMapCenter() {
  if (!map) return null;
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng };
}

// Lleva la cámara a un lugar elegido (movimiento suave)
export function focusPoint(lat, lng, zoom = 15) {
  if (!map) return;
  map.setView([lat, lng], Math.max(map.getZoom(), zoom), { animate: !reduceMotion, duration: 0.8 });
}
