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
    is_dcfc: 0,
  };
}

const setStatus = (status, text, http = null, sent = false) =>
  patch('abrp', { status, text, http, ...(sent ? { lastSentAt: Date.now() } : {}) });

// Dokümantasyon kaynakları iki biçim gösteriyor: sorgu parametreli GET (api_key, token, tlm) ve form gövdeli POST.
// Hangisinin geçerli olduğunu gerçek anahtar olmadan doğrulayamadım; ilki başarısız olursa diğeri 6 gönderimde bir denenir.
let mode = 'query'; // 'query' | 'body'
let probe = 0;

function attempt(m, cfg, pkt, noCors = false) {
  const params = new URLSearchParams({ api_key: cfg.apikey, token: cfg.token, tlm: JSON.stringify(pkt) });
  const opts = { signal: AbortSignal.timeout(8000) };
  if (noCors) opts.mode = 'no-cors';
  let url = ABRP.endpoint;
  if (m === 'query') url += '?' + params;
  else { opts.method = 'POST'; opts.body = params; }
  return fetch(url, opts);
}

async function readResult(res) {
  let ok = res.ok;
  let msg = '';
  try {
    const j = await res.json();
    ok = ok && (j.status === undefined || j.status === 'ok');
    if (!ok) msg = j.error || j.status || '';
  } catch { /* JSON değil */ }
  return { ok, status: res.status, msg };
}

async function sendAbrp(cfg, pkt) {
  if (!corsBlocked) {
    try {
      let r = await readResult(await attempt(mode, cfg, pkt));
      if (!r.ok && probe++ % 6 === 0) {
        const other = mode === 'query' ? 'body' : 'query';
        try {
          const r2 = await readResult(await attempt(other, cfg, pkt));
          if (r2.ok) { mode = other; r = r2; }
        } catch { /* diğer biçim de başarısız: ilk sonucu göster */ }
      }
      return r.ok
        ? setStatus('ok', `${r.status} OK`, r.status, true)
        : setStatus('err', `Hata ${r.status} ${r.msg}`.trim(), r.status, true);
    } catch (err) {
      if (err.name !== 'TypeError') return setStatus('err', 'Hata: ' + err.message);
      corsBlocked = true; // büyük olasılıkla CORS; aşağıda no-cors ile devam
    }
  }
  try {
    await attempt(mode, cfg, pkt, true);
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

// Pil okuması (OCR veya manuel) bu süreden eskiyse ABRP'ye eski pil değeri göndermek yerine beklenir.
const STALE_SOC_MS = 5 * 60 * 1000;

async function send() {
  if (!getState('abrp').enabled) return;
  const { lastOkAt } = getState('ocr');
  if (effective().source === 'live' && lastOkAt && Date.now() - lastOkAt > STALE_SOC_MS) {
    return setStatus('wait', 'Pil okuması eski — OCR / kamera kontrol et');
  }
  const cfg = load('abrp', {});
  const pkt = buildPacket();
  if (pkt.soc == null || pkt.lat == null || pkt.lon == null) return setStatus('wait', 'Veri bekleniyor (pil/konum)');
  const jobs = [];
  if (cfg.token && cfg.apikey) jobs.push(sendAbrp(cfg, pkt));
  else setStatus('err', 'Token / API Key eksik');
  if (cfg.webhook) jobs.push(sendWebhook(cfg.webhook, pkt));
  await Promise.all(jobs);
}

/** Kullanıcının seçtiği aralık (sn → ms). */
export const getIntervalMs = () => (load('abrpInterval', ABRP.intervalMs / 1000) || ABRP.intervalMs / 1000) * 1000;

/** Bir sonraki gönderime kadar bekleme: araç duruyorsa (hız < 1 km/h) en az parkedIntervalMs, veri tasarrufu için. */
function nextDelay() {
  const base = getIntervalMs();
  const speed = effective().speed ?? 0;
  return speed < 1 ? Math.max(base, ABRP.parkedIntervalMs) : base;
}

export function initTelemetry() {
  clearTimeout(timer);
  const loop = async () => {
    await send();
    timer = setTimeout(loop, nextDelay());
  };
  timer = setTimeout(loop, nextDelay());
}

/** Anahtar açılınca ilk paketi beklemeden gönder. */
export const sendNow = send;
