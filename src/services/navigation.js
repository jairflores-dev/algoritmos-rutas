import { haversineDistance } from '../algorithms/haversine.js';

// Longitudes acumuladas de cada ruta (se calculan una sola vez por ruta)
const cache = new WeakMap();

function cumulativeLengths(path) {
  let cum = cache.get(path);
  if (!cum) {
    cum = [0];
    for (let i = 1; i < path.length; i++) {
      cum[i] = cum[i - 1] + haversineDistance(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    }
    cache.set(path, cum);
  }
  return cum;
}

/**
 * Proyecta la posición del usuario sobre la ruta.
 * @param {Array<[number, number]>} path - [[lat, lng], ...]
 * @param {{lat:number, lng:number}} pos
 * @returns {{distanceToPathKm:number, remainingKm:number}}
 *   distanceToPathKm: qué tan lejos está de la ruta
 *   remainingKm: lo que falta recorrer sobre la ruta desde el punto más cercano
 */
export function projectOnPath(path, pos) {
  if (!path || path.length < 2) return { distanceToPathKm: 0, remainingKm: 0 };

  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1];

  // Plano local en km centrado en la posición del usuario
  const kx = Math.cos((pos.lat * Math.PI) / 180) * 111.32;
  const ky = 110.574;

  let best = { d: Infinity, along: 0 };

  for (let i = 0; i < path.length - 1; i++) {
    const ax = (path[i][1] - pos.lng) * kx;
    const ay = (path[i][0] - pos.lat) * ky;
    const bx = (path[i + 1][1] - pos.lng) * kx;
    const by = (path[i + 1][0] - pos.lat) * ky;

    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));

    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) {
      best = { d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
  }

  return { distanceToPathKm: best.d, remainingKm: Math.max(0, total - best.along) };
}
