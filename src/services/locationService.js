// Servicio de ubicación en tiempo real (Geolocation API del navegador).
// Un único watchPosition compartido; la UI se suscribe a las posiciones y errores.
// Nota: la API solo funciona en contextos seguros (https o localhost).

const OPTIONS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 };

let watchId = null;
let lastFix = null;
const fixListeners = new Set();
const errorListeners = new Set();

export const isSupported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;
export const isActive = () => watchId !== null;
export const getLastFix = () => lastFix;

export function subscribe(onFix, onError) {
  if (onFix) fixListeners.add(onFix);
  if (onError) errorListeners.add(onError);
  return () => {
    fixListeners.delete(onFix);
    errorListeners.delete(onError);
  };
}

export function start() {
  if (watchId !== null) return true;

  if (!isSupported()) {
    emitError({ fatal: true, message: 'Tu navegador no soporta geolocalización.' });
    return false;
  }

  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, OPTIONS);
  return true;
}

export function stop() {
  if (watchId !== null && isSupported()) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  lastFix = null;
}

function onPosition(pos) {
  const c = pos.coords;
  lastFix = {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: c.accuracy,   // metros
    heading: c.heading,     // grados (puede ser null)
    speed: c.speed,         // m/s (puede ser null)
    timestamp: pos.timestamp
  };
  fixListeners.forEach((fn) => fn(lastFix));
}

function onPositionError(err) {
  if (err.code === 1) {
    stop();
    emitError({
      fatal: true,
      message: 'Permiso de ubicación denegado. Actívalo desde el candado de la barra de direcciones (en http solo funciona en localhost).'
    });
  } else if (err.code === 2) {
    emitError({ fatal: false, message: 'No se pudo determinar tu ubicación. Revisa que el GPS o la red estén activos.' });
  } else {
    emitError({ fatal: false, message: 'La ubicación tarda en responder…' });
  }
}

function emitError(error) {
  errorListeners.forEach((fn) => fn(error));
}
