import { getState, patch, effective } from '../state.js';
import { ABRP } from '../config.js';
import { load } from '../utils/storage.js';

let corsBlocked = false; // tarayıcı ABRP yanıtını okutmuyorsa "no-cors" ile göndermeye devam et
let timer = null;

const rnd = (v, d) => (v == null ? null : Number(v.toFixed(d)));

/** ABRP telemetri paketi: utc (sn), soc (%), speed (km/h), lat, lon, elevation (m), ext_temp (°C). */
export function buildPacket() {
  const e = effective();
  return {
    utc: Math.floor(Date.now() / 1000),
    soc: rnd(e.soc, 0),
    speed: rnd(e.speed, 0),
    lat: rnd(e.lat, 6),
    lon: rnd(e.lon, 6),
    elevation: rnd(e.alt, 0),
    ext_temp: rnd(e.extTemp, 1),
    is_charging: 0,
  };
}

const setStatus = (status, text, http = null, sent = false) =>
  patch('abrp', { status, text, http, ...(sent ? { lastSentAt: Date.now() } : {}) });

async function sendAbrp(cfg, pkt) {
  // Token/anahtar URL'e değil, POST gövdesine konur (geçmişte/günlüklerde görünmesin).
  const body = new URLSearchParams({ api_key: cfg.apikey, token: cfg.token, tlm: JSON.stringify(pkt) });

  if (!corsBlocked) {
    try {
      const res = await fetch(ABRP.endpoint, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
      let ok = res.ok;
      let msg = '';
      try {
        const j = await res.json();
        ok = ok && (j.status === 'ok' || j.status === undefined);
        if (!ok) msg = j.error || j.status || '';
      } catch { /* JSON değil */ }
      return ok ? setStatus('ok', `${res.status} OK`, res.status, true) : setStatus('err', `Hata ${res.status} ${msg}`.trim(), res.status, true);
    } catch (err) {
      if (err.name !== 'TypeError') return setStatus('err', 'Hata: ' + err.message);
      corsBlocked = true; // büyük olasılıkla CORS; aşağıda no-cors ile devam
    }
  }
  try {
    await fetch(ABRP.endpoint, { method: 'POST', body, mode: 'no-cors', signal: AbortSignal.timeout(8000) });
    setStatus('wait', 'Gönderildi (yanıt okunamıyor)', 'opaque', true);
  } catch (err) {
    setStatus('err', 'Hata: ' + (err.message || 'ağ'));
  }
}

async function sendWebhook(url, pkt) {
  const payload = JSON.stringify({ source: 'ev-copilot', ...pkt });
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(8000) });
    patch('abrp', { webhook: res.ok ? `${res.status} OK` : `Hata ${res.status}` });
  } catch (err) {
    if (err.name !== 'TypeError') return patch('abrp', { webhook: 'Hata: ' + err.message });
    try { // CORS izin vermiyorsa yine de ilet (yanıt okunamaz)
      await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: payload, signal: AbortSignal.timeout(8000) });
      patch('abrp', { webhook: 'Gönderildi (yanıt okunamıyor)' });
    } catch (e2) {
      patch('abrp', { webhook: 'Hata: ' + (e2.message || 'ağ') });
    }
  }
}

async function send() {
  if (!getState('abrp').enabled) return;
  const cfg = load('abrp', {});
  const pkt = buildPacket();
  if (pkt.soc == null || pkt.lat == null || pkt.lon == null) return setStatus('wait', 'Veri bekleniyor (pil/konum)');
  const jobs = [];
  if (cfg.token && cfg.apikey) jobs.push(sendAbrp(cfg, pkt));
  else setStatus('err', 'Token / API Key eksik');
  if (cfg.webhook) jobs.push(sendWebhook(cfg.webhook, pkt));
  await Promise.all(jobs);
}

export function initTelemetry() {
  clearInterval(timer);
  timer = setInterval(send, ABRP.intervalMs);
}

/** Anahtar açılınca ilk paketi beklemeden gönder. */
export const sendNow = send;
