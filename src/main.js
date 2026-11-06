import './style.css';
import { solvePath } from './algorithms/searchEngine.js';
import { geocodeLocation, fetchDynamicGraph, fetchAddressSuggestions } from './services/routingService.js';
import {
  initMap, renderDynamicMarkers, renderRoute,
  startNavigationAnimation, stopNavigationAnimation,
  showUserLocation, clearUserLocation, centerOnUser, followUser, onMapDragStart,
  getMapCenter, focusPoint
} from './map/mapController.js';
import { updateMetrics, showToast, setLiveStatus, formatDistance } from './ui/telemetryPanel.js';
import * as gps from './services/locationService.js';
import { projectOnPath } from './services/navigation.js';

/* ---------- Parámetros de la navegación en vivo ---------- */
const ARRIVAL_M = 25;               // llegada: a menos de 25 m del destino
const OFF_ROUTE_M = 40;             // se considera fuera de ruta a más de 40 m
const OFF_ROUTE_FIXES = 3;          // lecturas seguidas fuera de ruta antes de recalcular
const REROUTE_COOLDOWN_MS = 15000;  // mínimo entre recálculos
const MAX_USEFUL_ACCURACY_M = 60;   // con peor precisión no se decide llegada ni desvío
const WALK_KMH = 4.5;
const ALGO_COLORS = { ASTAR: '#1a73e8', GREEDY: '#1e8e3e', DIJKSTRA: '#e37400' };

/* ---------- Estado ---------- */
let clickedStart = null;
let clickedTarget = null;
let currentPathCoords = [];
let lastRoute = null;        // { start, target, algorithm } para poder recalcular
let startFromGps = false;    // el origen es "Mi ubicación"

const nav = { mode: null, offRoute: 0, lastReroute: 0, rerouting: false }; // mode: null | 'live' | 'sim'
const loc = { following: false, pendingCenter: false, lowAccuracyWarned: false };

const $ = (id) => document.getElementById(id);
const btnLocate = $('btn-locate');
const btnUseLoc = $('btn-use-location');
const btnStartNav = $('btn-start-nav');

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ---------- Mapa y selección por clic ---------- */
initMap('map', async (latlng) => {
  if (!clickedStart) {
    clickedStart = latlng;
    startFromGps = false;
    $('input-start').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    renderDynamicMarkers(clickedStart, clickedTarget);
  } else if (!clickedTarget) {
    clickedTarget = latlng;
    $('input-target').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    renderDynamicMarkers(clickedStart, clickedTarget);
    await processRouting();
  } else {
    clickedStart = latlng;
    clickedTarget = null;
    startFromGps = false;
    $('input-start').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    $('input-target').value = '';
    renderDynamicMarkers(clickedStart, clickedTarget);
  }
});

// Si el usuario arrastra el mapa, se deja de seguir su ubicación (como en Google Maps)
onMapDragStart(() => {
  if (loc.following) {
    loc.following = false;
    refreshLocateButton();
  }
});

/* ---------- Autocompletado ---------- */

// Las sugerencias dan prioridad a lugares cercanos: tu GPS si lo hay, si no el centro del mapa
function searchBias() {
  const fix = gps.getLastFix();
  return fix ? { lat: fix.lat, lng: fix.lng } : getMapCenter();
}

// Texto con la parte coincidente en negrita (nodos de texto, sin innerHTML)
function highlight(text, query) {
  const frag = document.createDocumentFragment();
  const q = query.trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) {
    frag.append(text);
    return frag;
  }
  const mark = document.createElement('mark');
  mark.textContent = text.slice(i, i + q.length);
  frag.append(text.slice(0, i), mark, text.slice(i + q.length));
  return frag;
}

function pinIcon(gpsIcon = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.innerHTML = gpsIcon
    ? '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'
    : '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>';
  return svg;
}

function setupAutocomplete(inputId, listId, { onEdit, onSelect, offerMyLocation = false }) {
  const input = $(inputId);
  const list = $(listId);
  const GPS_ITEM = { kind: 'gps', title: 'Mi ubicación', subtitle: 'Usar tu posición actual' };

  let options = [];     // solo las filas que se pueden elegir
  let activeIndex = -1;
  let requestId = 0;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');
  list.setAttribute('role', 'listbox');

  function close() {
    list.classList.remove('active');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function setActive(index) {
    const rows = list.querySelectorAll('[role="option"]');
    rows.forEach((row, i) => {
      const on = i === index;
      row.classList.toggle('is-active', on);
      row.setAttribute('aria-selected', String(on));
      if (on) {
        input.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView({ block: 'nearest' });
      }
    });
    activeIndex = index;
  }

  function choose(item) {
    close();
    if (item.kind === 'gps') {
      useMyLocation();
      return;
    }
    input.value = item.label;
    onSelect({ lat: item.lat, lng: item.lng });
  }

  function render(entries, query) {
    list.replaceChildren();
    options = [];
    if (entries.length === 0) {
      close();
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement('li');

      if (entry.kind === 'status') {
        li.className = 'sugg-status';
        li.textContent = entry.text;
        list.appendChild(li);
        return;
      }

      const index = options.length;
      options.push(entry);
      li.id = `${listId}-opt-${index}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      const icon = document.createElement('span');
      icon.className = 'sugg-icon';
      icon.appendChild(pinIcon(entry.kind === 'gps'));

      const text = document.createElement('span');
      text.className = 'sugg-text';
      const title = document.createElement('strong');
      title.className = 'sugg-title';
      title.appendChild(entry.kind === 'gps' ? document.createTextNode(entry.title) : highlight(entry.title, query));
      text.appendChild(title);
      if (entry.subtitle) {
        const sub = document.createElement('small');
        sub.className = 'sugg-sub';
        sub.textContent = entry.subtitle;
        text.appendChild(sub);
      }

      li.append(icon, text);
      // mousedown evita que el campo pierda el foco antes de elegir
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => choose(entry));
      li.addEventListener('mousemove', () => { if (activeIndex !== index) setActive(index); });
      list.appendChild(li);
    });

    list.classList.add('active');
    input.setAttribute('aria-expanded', 'true');
    activeIndex = -1;
  }

  const search = debounce(async () => {
    const query = input.value.trim();
    const id = ++requestId;

    if (query.length < 3) {
      render(offerMyLocation ? [GPS_ITEM] : [], query);
      return;
    }

    if (options.length === 0) render([{ kind: 'status', text: 'Buscando…' }], query);

    try {
      const results = await fetchAddressSuggestions(query, { bias: searchBias() });
      if (results === null || id !== requestId) return; // respuesta vieja o cancelada
      render(
        results.length ? results.map((r) => ({ kind: 'place', ...r })) : [{ kind: 'status', text: `Sin resultados para «${query}»` }],
        query
      );
    } catch (err) {
      if (id !== requestId) return;
      console.warn('Error al buscar sugerencias:', err);
      render([{ kind: 'status', text: 'No se pudo buscar. Revisa tu conexión.' }], query);
    }
  }, 250);

  input.addEventListener('input', () => {
    onEdit();   // el texto cambió: las coordenadas anteriores ya no valen
    search();
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length < 3 && offerMyLocation) render([GPS_ITEM], '');
  });

  input.addEventListener('keydown', (e) => {
    const open = list.classList.contains('active') && options.length > 0;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (e.key === 'Enter' && open && activeIndex >= 0) {
      e.preventDefault(); // elige la sugerencia en lugar de enviar el formulario
      choose(options[activeIndex]);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) close();
  });
}

// Después de elegir una sugerencia: si ya hay origen y destino, se calcula sola la ruta
function afterSelection(coords) {
  renderDynamicMarkers(clickedStart, clickedTarget);
  if ((clickedStart || startFromGps) && clickedTarget) processRouting();
  else focusPoint(coords.lat, coords.lng);
}

setupAutocomplete('input-start', 'suggestions-start', {
  offerMyLocation: true,
  onEdit: () => { clickedStart = null; startFromGps = false; },
  onSelect: (coords) => { clickedStart = coords; startFromGps = false; afterSelection(coords); }
});

setupAutocomplete('input-target', 'suggestions-target', {
  onEdit: () => { clickedTarget = null; },
  onSelect: (coords) => { clickedTarget = coords; afterSelection(coords); }
});

$('route-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await processRouting();
});

/* ---------- Cálculo de ruta ---------- */
async function computeRoute(start, target, algorithm, { fit = true } = {}) {
  const graph = await fetchDynamicGraph(start, target);
  const result = solvePath(graph, "START", "TARGET", algorithm, "car");

  if (!result.success) throw new Error('No se pudo hallar una ruta.');

  renderRoute(result.pathCoords, ALGO_COLORS[algorithm] || '#1a73e8', { fit });
  updateMetrics(result);

  currentPathCoords = result.pathCoords;
  lastRoute = { start, target, algorithm };
  return result;
}

async function processRouting() {
  const btn = $('btn-search');
  const startVal = $('input-start').value;
  const targetVal = $('input-target').value;

  const algoRadio = document.querySelector('input[name="select-algo"]:checked');
  const algorithm = algoRadio ? algoRadio.value : 'ASTAR';

  if (!startVal || !targetVal) return;

  // Una búsqueda nueva cancela cualquier navegación en curso
  if (nav.mode) stopNavigation();

  btn.disabled = true;
  btn.textContent = '⌛ Buscando coordenadas...';

  try {
    let startCoords = clickedStart;
    let targetCoords = clickedTarget;

    if (startFromGps) {
      const fix = gps.getLastFix();
      if (fix) startCoords = { lat: fix.lat, lng: fix.lng };
      if (!startCoords) throw new Error('Aún no tenemos tu ubicación. Inténtalo en unos segundos.');
    } else if (!startCoords) {
      startCoords = await geocodeLocation(startVal, { bias: searchBias() });
      clickedStart = startCoords;
    }
    if (!targetCoords) {
      targetCoords = await geocodeLocation(targetVal, { bias: searchBias() });
      clickedTarget = targetCoords;
    }

    renderDynamicMarkers(startCoords, targetCoords);

    btn.textContent = '⚙️ Generando grafo y calculando...';
    await computeRoute(startCoords, targetCoords, algorithm);

    btnStartNav.disabled = false;
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg class="gmaps-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M21.71 11.29l-9-9c-.39-.39-1.02-.39-1.41 0l-9 9c-.39.39-.39 1.02 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9c.39-.38.39-1.01 0-1.41zM14 14.5V12h-4v3H8.5v-4.5c0-.55.45-1 1-1H14V7l4 3.75-4 3.75z"/>
      </svg>
      Cómo llegar
    `;
  }
}

/* =====================================================================
   UBICACIÓN EN TIEMPO REAL
   ===================================================================== */

// Botón flotante: apagado → buscando → mostrando → siguiendo
function refreshLocateButton() {
  let state = 'off';
  if (gps.isActive()) {
    state = !gps.getLastFix() ? 'searching' : loc.following ? 'following' : 'on';
  }
  const labels = {
    off: 'Mostrar mi ubicación',
    searching: 'Buscando tu ubicación…',
    on: 'Centrar en mi ubicación',
    following: 'Dejar de mostrar mi ubicación'
  };
  btnLocate.dataset.state = state;
  btnLocate.setAttribute('aria-pressed', String(state === 'on' || state === 'following'));
  btnLocate.title = labels[state];
  btnLocate.setAttribute('aria-label', labels[state]);
}

function stopTracking() {
  gps.stop();
  clearUserLocation();
  loc.following = false;
  loc.pendingCenter = false;
  loc.lowAccuracyWarned = false;
  refreshLocateButton();
}

// Cada nueva posición del GPS
function handleFix(fix) {
  showUserLocation(fix);

  if (loc.pendingCenter) {
    loc.pendingCenter = false;
    centerOnUser(fix);
  } else if (loc.following) {
    followUser(fix);
  }

  if (fix.accuracy > 1000 && !loc.lowAccuracyWarned) {
    loc.lowAccuracyWarned = true;
    showToast(`Precisión baja (±${Math.round(fix.accuracy)} m). En un celular con GPS será más exacta.`, 5000);
  }

  if (nav.mode === 'live') handleNavFix(fix);
  refreshLocateButton();
}

// Errores del GPS (se evita repetir el mismo aviso seguido)
let lastGpsErrorAt = 0;
function handleGpsError(err) {
  const now = Date.now();
  if (err.fatal || now - lastGpsErrorAt > 10000) {
    showToast(err.message, 5000);
    lastGpsErrorAt = now;
  }
  if (err.fatal) {
    if (nav.mode === 'live') stopNavigation();
    stopTracking();
  }
}

gps.subscribe(handleFix, handleGpsError);

// Espera la primera posición (inicia el GPS si hace falta). Devuelve null si falla.
function waitForFix(timeoutMs = 12000) {
  const last = gps.getLastFix();
  if (gps.isActive() && last) return Promise.resolve(last);

  return new Promise((resolve) => {
    let done = false;
    let off = () => {};
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = (value) => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      resolve(value);
    };
    off = gps.subscribe((fix) => finish(fix), () => finish(null));
    gps.start();
    refreshLocateButton();
  });
}

btnLocate.addEventListener('click', () => {
  const state = btnLocate.dataset.state;

  if (state === 'off') {
    loc.following = true;
    loc.pendingCenter = true;
    gps.start();
    refreshLocateButton();
  } else if (state === 'on' || (state === 'following' && nav.mode === 'live')) {
    const fix = gps.getLastFix();
    loc.following = true;
    if (fix) centerOnUser(fix);
    refreshLocateButton();
  } else if (state === 'following') {
    stopTracking();
  }
});

// "Usar mi ubicación" como punto de partida
async function useMyLocation() {
  btnUseLoc.classList.add('busy');
  const fix = await waitForFix();
  btnUseLoc.classList.remove('busy');
  if (!fix) return; // el motivo ya se mostró como aviso

  clickedStart = { lat: fix.lat, lng: fix.lng };
  startFromGps = true;
  $('input-start').value = 'Mi ubicación';
  renderDynamicMarkers(clickedStart, clickedTarget);

  if ($('input-target').value) {
    await processRouting();
  } else {
    centerOnUser(fix);
  }
}

btnUseLoc.addEventListener('click', useMyLocation);

/* ---------- Navegación en vivo ---------- */
function setNavButton(state) {
  const labels = {
    idle: '▶ Iniciar Caminata',
    searching: '⌛ Buscando tu ubicación…',
    live: '■ Detener navegación',
    sim: '■ Detener simulación'
  };
  btnStartNav.textContent = labels[state];
  btnStartNav.classList.toggle('active', state === 'live' || state === 'sim');
  btnStartNav.disabled = state === 'searching' || (state === 'idle' && currentPathCoords.length === 0);
}

function liveText(remainingKm, extra = '') {
  const mins = Math.max(1, Math.round((remainingKm / WALK_KMH) * 60));
  return `Te faltan ${formatDistance(remainingKm)} · ~${mins} min${extra}`;
}

function handleNavFix(fix) {
  const p = projectOnPath(currentPathCoords, fix);
  const remainingM = p.remainingKm * 1000;
  const offM = p.distanceToPathKm * 1000;
  const precise = fix.accuracy <= MAX_USEFUL_ACCURACY_M;

  if (precise && remainingM <= ARRIVAL_M) {
    showToast('🎉 ¡Has llegado a tu destino!', 5000);
    stopNavigation();
    return;
  }

  const offRoute = precise && offM > OFF_ROUTE_M;
  const note = !precise
    ? ` · GPS ±${Math.round(fix.accuracy)} m`
    : offRoute ? ' · fuera de ruta' : '';
  setLiveStatus(liveText(p.remainingKm + p.distanceToPathKm, note));

  if (offRoute) {
    nav.offRoute++;
    if (nav.offRoute >= OFF_ROUTE_FIXES && Date.now() - nav.lastReroute > REROUTE_COOLDOWN_MS) {
      reroute(fix);
    }
  } else {
    nav.offRoute = 0;
  }
}

// Recalcula desde la posición actual, sin mover la cámara
async function reroute(fix) {
  if (nav.rerouting || !lastRoute) return;
  nav.rerouting = true;
  nav.lastReroute = Date.now();
  nav.offRoute = 0;
  showToast('Te saliste de la ruta. Recalculando…');

  try {
    await computeRoute({ lat: fix.lat, lng: fix.lng }, lastRoute.target, lastRoute.algorithm, { fit: false });
    showToast('Ruta actualizada');
  } catch (err) {
    showToast(`No se pudo recalcular: ${err.message}`);
  } finally {
    nav.rerouting = false;
  }
}

function startLiveNavigation(fix) {
  nav.mode = 'live';
  nav.offRoute = 0;
  nav.lastReroute = 0;
  loc.following = true;
  loc.pendingCenter = false;

  centerOnUser(fix, 17);
  setNavButton('live');
  handleNavFix(fix);
  refreshLocateButton();
}

// Sin GPS (permiso denegado o sin soporte): se simula el recorrido como antes
function startSimulation() {
  nav.mode = 'sim';
  showToast('Sin ubicación en tiempo real: se simulará el recorrido.');
  setNavButton('sim');

  const update = (step) => {
    const [lat, lng] = currentPathCoords[step];
    setLiveStatus(liveText(projectOnPath(currentPathCoords, { lat, lng }).remainingKm));
  };
  update(0);

  startNavigationAnimation(
    currentPathCoords,
    (step) => update(step),
    () => {
      showToast('🎉 ¡Has llegado a tu destino!', 5000);
      stopNavigation();
    }
  );
}

function stopNavigation() {
  nav.mode = null;
  nav.offRoute = 0;
  stopNavigationAnimation();
  setLiveStatus(null);
  setNavButton('idle');
  refreshLocateButton();
}

btnStartNav.addEventListener('click', async () => {
  if (nav.mode) {
    stopNavigation();
    return;
  }
  if (currentPathCoords.length === 0) return;

  setNavButton('searching');
  const fix = await waitForFix();

  if (fix) startLiveNavigation(fix);
  else startSimulation();
});

refreshLocateButton();
