import { getState } from '../state.js';
import { toast } from './toast.js';

// ABRP token / API Key'i bir cihazdan diğerine QR ile aktarma. Kod cihazın içinde üretilir (üçüncü taraf siteye yazılmaz).
const QRGEN = { src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', sri: 'sha256-Fk/Cwcnq8KA6qN/bhV6C5BpcaSL7rYuzI4EWIH4mvvc=', global: 'qrcode' };
const JSQR = { src: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', sri: 'sha256-vEDIoVGWI2sjFNsIVvcsoLSZgM1UE7jIUqc0n1/uCFk=', global: 'jsQR' };
const VALID = /^[A-Za-z0-9_-]{8,128}$/;
const PREFIX = 'evcp1?';

const $ = (id) => document.getElementById(id);

function loadLib({ src, sri, global }) {
  if (window[global]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.integrity = sri;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('QR kütüphanesi yüklenemedi (internet?)'));
    document.head.append(s);
  });
}

export function buildPayload(token, apikey) {
  const p = new URLSearchParams({ token });
  if (apikey) p.set('apikey', apikey);
  return PREFIX + p;
}

/**
 * QR içeriğini çözer. Dış kaynaklı (güvenilmez) veri olduğu için yalnızca token ve API Key kabul edilir,
 * ikisi de sıkı bir karakter kümesine uymalı. Webhook gibi alanlar bilinçli olarak yok sayılır
 * (kötü niyetli bir QR telemetriyi başka sunucuya yönlendiremesin). Düz token metni de kabul edilir.
 */
export function parsePayload(text) {
  const t = String(text).trim();
  let token = null;
  let apikey = null;
  if (t.startsWith(PREFIX)) {
    const p = new URLSearchParams(t.slice(PREFIX.length));
    token = p.get('token');
    apikey = p.get('apikey');
  } else if (VALID.test(t)) {
    token = t;
  }
  if (!token || !VALID.test(token)) return null;
  if (apikey && !VALID.test(apikey)) apikey = null;
  return { token, apikey };
}

const mask = (s) => (s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : '••••');

export function initQrTransfer() {
  const dlg = $('qr-dialog');
  const views = { show: $('qr-show'), scan: $('qr-scan') };
  let stream = null;
  let loopTimer = null;
  let found = null;

  function openView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
    $('qr-title').textContent = name === 'show' ? 'QR göster' : 'QR ile oku';
    if (!dlg.open) dlg.showModal();
  }

  function cleanup() {
    clearTimeout(loopTimer);
    loopTimer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    $('qr-video').srcObject = null;
    $('qr-img').removeAttribute('src'); // gizli bilgi ekranda kalmasın
    $('qr-confirm').classList.add('hidden');
    found = null;
  }
  dlg.addEventListener('close', cleanup);
  $('qr-close').addEventListener('click', () => dlg.close());

  // ---------- QR göster ----------
  async function renderQr() {
    const token = $('abrp-token').value.trim();
    const apikey = $('qr-with-key').checked ? $('abrp-apikey').value.trim() : '';
    const note = $('qr-show-note');
    if (!VALID.test(token)) { $('qr-img').removeAttribute('src'); note.textContent = 'Önce geçerli bir User Token gir.'; return; }
    try {
      await loadLib(QRGEN);
      const qr = window.qrcode(0, 'M');
      qr.addData(buildPayload(token, VALID.test(apikey) ? apikey : ''));
      qr.make();
      $('qr-img').src = qr.createDataURL(6, 4);
      note.textContent = 'Diğer telefonda ABRP sekmesinde "QR ile oku"ya bas ve bu kodu göster. Kodu yalnızca kendi cihazına göster.';
    } catch (err) {
      note.textContent = err.message;
    }
  }
  $('btn-qr-show').addEventListener('click', () => { openView('show'); renderQr(); });
  $('qr-with-key').addEventListener('change', renderQr);

  // ---------- QR oku ----------
  async function startScan() {
    if (getState('system').camera) return toast('Önce Kamera sekmesindeki kamerayı durdur');
    openView('scan');
    $('qr-confirm').classList.add('hidden');
    const status = $('qr-status');
    status.textContent = 'Kamera açılıyor…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (err) {
      status.textContent = 'Kamera açılamadı: ' + (err.message || err.name);
      return;
    }
    const video = $('qr-video');
    video.srcObject = stream;
    await video.play().catch(() => {});

    let detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch { /* jsQR'a düş */ }
    }
    if (!detector) {
      try { await loadLib(JSQR); } catch (err) { status.textContent = err.message; return; }
    }
    status.textContent = 'Kamerayı QR koduna doğrult…';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastBad = '';

    const scan = async () => {
      if (!stream) return;
      let text = null;
      try {
        if (detector) {
          text = (await detector.detect(video))[0]?.rawValue ?? null;
        } else if (video.videoWidth) {
          const w = Math.min(640, video.videoWidth);
          canvas.width = w;
          canvas.height = Math.round((video.videoHeight * w) / video.videoWidth);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
        }
      } catch { /* kare okunamadı: sonrakini dene */ }

      if (text) {
        const parsed = parsePayload(text);
        if (parsed) return onFound(parsed);
        if (text !== lastBad) { lastBad = text; status.textContent = 'Bu QR bir ABRP token kodu değil, tekrar dene.'; }
      }
      loopTimer = setTimeout(scan, 200);
    };
    scan();
  }

  function onFound(parsed) {
    found = parsed;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    $('qr-video').srcObject = null;
    $('qr-status').textContent = 'Kod okundu.';
    $('qr-found').textContent = `User Token: ${mask(parsed.token)}${parsed.apikey ? ` · API Key: ${mask(parsed.apikey)}` : ' · (API Key yok)'}`;
    $('qr-confirm').classList.remove('hidden');
  }

  $('btn-qr-scan').addEventListener('click', startScan);
  $('qr-retry').addEventListener('click', startScan);
  $('qr-save').addEventListener('click', () => {
    if (!found) return;
    const set = (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new Event('change')); }; // abrpPanel kaydeder
    set('abrp-token', found.token);
    if (found.apikey) set('abrp-apikey', found.apikey);
    dlg.close();
    toast('ABRP bilgileri kaydedildi');
  });
}
