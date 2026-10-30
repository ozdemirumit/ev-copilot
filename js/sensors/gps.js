import { patch } from '../state.js';
import { haversineKm, bearing } from '../utils/geo.js';

const STILL_MS = 0.5; // m/s altında hızı 0 say (GPS titreşimi)
const BEARING_MIN_M = 8; // yön için en az bu kadar yer değiştirmiş olmalı

let watchId = null;
let prev = null; // son fix (hız yedeği için)
let anchor = null; // yön hesabı için son referans nokta
let lastHeading = null;

function onPosition(pos) {
  const c = pos.coords;
  const here = { lat: c.latitude, lon: c.longitude, t: pos.timestamp };

  let speedMs = Number.isFinite(c.speed) ? c.speed : null;
  if (speedMs == null && prev) {
    const dt = (here.t - prev.t) / 1000;
    if (dt > 0.5 && dt < 10) speedMs = (haversineKm(prev, here) * 1000) / dt;
  }

  let heading = Number.isFinite(c.heading) ? c.heading : null;
  if (heading == null && anchor && haversineKm(anchor, here) * 1000 >= BEARING_MIN_M) {
    heading = bearing(anchor, here);
  }
  if (!anchor || haversineKm(anchor, here) * 1000 >= BEARING_MIN_M) anchor = here;
  prev = here;

  // Duruyorken yön anlamsızdır: son bilinen yönü koru.
  const moving = speedMs != null && speedMs >= 1;
  if (heading != null && moving) lastHeading = heading;

  patch('live', {
    lat: c.latitude,
    lon: c.longitude,
    alt: Number.isFinite(c.altitude) ? c.altitude : null,
    speed: speedMs == null ? null : speedMs < STILL_MS ? 0 : speedMs * 3.6,
    heading: lastHeading,
    acc: c.accuracy,
    gps: 'ok',
  });
}

function onError(err) {
  patch('live', { gps: err.code === err.PERMISSION_DENIED ? 'denied' : 'error' });
}

export function startGps() {
  if (!navigator.geolocation) {
    patch('live', { gps: 'error' });
    throw new Error('Geolocation desteklenmiyor');
  }
  if (watchId != null) return;
  prev = anchor = null;
  patch('live', { gps: 'searching' });
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 20000,
  });
}

export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  patch('live', { gps: 'off', speed: null });
}
