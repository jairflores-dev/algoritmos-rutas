export function updateMetrics(metrics) {
  const distKm = parseFloat(metrics.totalDistanceKm);

  // Cálculo de tiempo de viaje real
  const minsPedestrian = Math.round((distKm / 4.5) * 60);
  const minsCar = Math.round((distKm / 30) * 60);

  document.getElementById('metric-distance').textContent = `${distKm.toFixed(2)} km`;
  document.getElementById('metric-time').textContent = `${metrics.executionTimeMs} ms`;
  document.getElementById('metric-nodes').textContent = metrics.visitedNodesCount;

  // Actualizar tiempos estimados visuales
  const etaElem = document.getElementById('metric-eta');
  if (etaElem) {
    etaElem.textContent = minsPedestrian < 60 
      ? `🚶 ${minsPedestrian} min | 🚗 ${minsCar < 1 ? '<1' : minsCar} min`
      : `🚶 ${(minsPedestrian / 60).toFixed(1)} h | 🚗 ${minsCar} min`;
  }
}

export function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
}

// Aviso discreto (reemplaza a alert, que bloquea la pantalla)
let toastTimer;
export function showToast(message, ms = 3800) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

// Línea de estado de la navegación en vivo (null la oculta)
export function setLiveStatus(text) {
  const box = document.getElementById('live-status');
  const label = document.getElementById('live-text');
  if (!box || !label) return;
  if (text) {
    label.textContent = text;
    box.hidden = false;
  } else {
    box.hidden = true;
    label.textContent = '';
  }
}
