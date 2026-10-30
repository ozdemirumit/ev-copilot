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
    const { status, lastOkAt } = getState('ocr');
    const running = getState('system').ocr;
    // Okuma açık değilken "manuel" durumu OCR rozetini yeşertmesin.
    if (!running && status === 'manual') return set(ocr, OCR.idle);
    // OCR açıkken son geçerli okuma 30 sn'den eskiyse yaşını göster (sürüş sırasında takılma fark edilsin).
    const age = lastOkAt ? Date.now() - lastOkAt : 0;
    if (running && lastOkAt && age > 30000) {
      const s = Math.round(age / 1000);
      return set(ocr, [`OCR: son okuma ${s >= 120 ? Math.round(s / 60) + ' dk' : s + ' sn'} önce`, 'wait']);
    }
    set(ocr, OCR[status] || OCR.idle);
  };

  // Dinamik uyarı bandı (fallback / eco-hız / hedef bilgisi)
  const banner = document.getElementById('advisor-banner');
  subscribe('advisor', ({ level, text }) => {
    banner.textContent = text;
    banner.className = 'advisor ' + (level === 'ok' ? '' : level) + (text ? '' : ' hidden');
  });

  subscribe('live', paintGps);
  subscribe(['ocr', 'system'], paintOcr);
  setInterval(paintOcr, 5000); // okuma yaşı zamanla değişir
  paintGps();
  paintOcr();
}
