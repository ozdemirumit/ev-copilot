import { getState, subscribe } from '../state.js';

const GPS = {
  off: ['GPS: kapalı', ''],
  searching: ['GPS: aranıyor', 'wait'],
  error: ['GPS: hata', 'err'],
  denied: ['GPS: izin yok', 'err'],
};
const OCR = {
  idle: ['OCR: kapalı', ''],
  loading: ['OCR: yükleniyor', 'wait'],
  ok: ['OCR: okuyor', 'ok'],
  rejected: ['OCR: değer reddedildi', 'wait'],
  unreadable: ['OCR: okunamadı', 'wait'],
  manual: ['OCR: manuel', 'ok'],
  error: ['OCR: hata', 'err'],
};

function set(el, [text, cls]) {
  el.textContent = text;
  el.className = 'badge ' + cls + (el.id === 'bd-sim' ? ' test' : '');
}

export function initStatusBadges() {
  const gps = document.getElementById('bd-gps');
  const ocr = document.getElementById('bd-ocr');

  const paintGps = () => {
    const { gps: g, acc } = getState('live');
    set(gps, g === 'ok' ? [`GPS: ±${Math.round(acc)} m`, 'ok'] : GPS[g]);
  };
  const paintOcr = () => {
    const { status } = getState('ocr');
    // Okuma açık değilken "manuel" durumu OCR rozetini yeşertmesin.
    set(ocr, !getState('system').ocr && status === 'manual' ? OCR.idle : OCR[status] || OCR.idle);
  };

  // Dinamik uyarı bandı (fallback / eco-hız / hedef bilgisi)
  const banner = document.getElementById('advisor-banner');
  subscribe('advisor', ({ level, text }) => {
    banner.textContent = text;
    banner.className = 'advisor ' + (level === 'ok' ? '' : level) + (text ? '' : ' hidden');
  });

  subscribe('live', paintGps);
  subscribe(['ocr', 'system'], paintOcr);
  paintGps();
  paintOcr();
}
