import { getState, subscribe } from '../state.js';
import { toast } from './toast.js';
import { densityFromRatio } from '../physics/traffic.js';
import { tr } from '../i18n/index.js';

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

/** Trafik rozeti: son planlanan rotanın trafik verisi (route.trafficInfo). Canlı veri veren kaynak yoksa trafik varmış gibi bir şey söylemez. */
export function trafficBadge(info) {
  if (!info) return ['Trafik: —', '']; // planlı rota yok
  if (!info.live) return ['Trafik: veri yok', ''];
  const delay = Math.round(info.driveMin - info.freeMin);
  return densityFromRatio(info.ratio) > 0 && delay >= 1 ? [`Trafik: +${delay} dk`, 'wait'] : ['Trafik: akıcı', 'ok'];
}

/** ABRP rozeti (üst şerit): telemetri durumunun kısa hali; ayrıntılı metin rozetin başlığında ve ABRP sayfasında kalır. "bağlı" yalnızca sunucu onayladıysa; no-cors gönderimde yanıt okunamaz, "gönderildi" der. */
export function abrpBadge({ status, http }) {
  if (status === 'ok') return ['ABRP: bağlı', 'ok'];
  if (status === 'err') return ['ABRP: hata', 'err'];
  if (status === 'wait') return [http === 'opaque' ? 'ABRP: gönderildi' : 'ABRP: bekliyor', 'wait'];
  return ['ABRP: pasif', ''];
}

const WX_STALE_MS = 60 * 60e3; // bu kadar eski hava bilgisi "bilinmiyor" sayılır (çevrimdışı/GPS yok)

/** WMO hava kodundan simge; kod yoksa yağmur ölçümü, o da yoksa nötr termometre (hava açık diye uydurulmaz). */
export function weatherKind(code, rain) {
  if (Number.isFinite(code)) {
    if (code >= 95) return 'storm';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 51) return 'rain';
    return code <= 1 ? 'sun' : 'cloud';
  }
  return rain >= 0.1 ? 'rain' : 'thermo';
}

/** Hava rozeti: { text, kind, known }. Veri yoksa, eskiyse ya da sıcaklık kaynaktan gelmediyse bilinmiyor der; değer uydurmaz. */
export function weatherBadge({ sim = null, weather, now = Date.now() }) {
  if (sim) return { text: `${Math.round(sim.temp)}°C`, kind: weatherKind(null, sim.rain), known: true };
  const fresh = weather.at > 0 && now - weather.at < WX_STALE_MS && weather.known !== false && Number.isFinite(weather.temp);
  if (!fresh) return { text: 'Hava: —', kind: 'thermo', known: false };
  return { text: `${Math.round(weather.temp)}°C`, kind: weatherKind(weather.code, weather.rain), known: true };
}

/** Ağ katmanı (net/proxy.js) sunucu kısa süre kapalıyken 'proxy-retrying' olayı gönderir (kesinti başına bir kez): tek toast gösterilir. */
export function watchProxyRetry() {
  document.addEventListener('proxy-retrying', () => toast('Sunucuya ulaşılamıyor, yeniden deneniyor…', 5000));
}

export function initStatusBadges() {
  watchProxyRetry();
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

  const traffic = document.getElementById('bd-traffic');
  const paintTraffic = () => {
    const { end, trafficInfo } = getState('route');
    set(traffic, trafficBadge(end ? trafficInfo : null)); // "Temizle" varışı siler; trafficInfo eski rotadan kalır
  };

  const wx = document.getElementById('bd-weather');
  const wxText = document.getElementById('bd-weather-t');
  const wxIcon = document.getElementById('bd-weather-ic');
  let wxShown = '';
  const paintWeather = () => {
    const simOn = getState('sim').enabled;
    const b = weatherBadge({ sim: simOn ? getState('sim') : null, weather: getState('weather') });
    const key = b.text + b.kind;
    if (key === wxShown) return; // canlı veri saniyede çok kez gelir: aynı değer DOM'a yazılmaz
    wxShown = key;
    wxText.textContent = b.text;
    wxIcon.setAttribute('href', '#i-' + b.kind);
    wx.className = 'badge' + (b.known ? ' ok' : '');
    wx.title = tr(b.known ? 'Hava durumu (Open-Meteo)' : 'Hava durumu bilinmiyor: konum ve Open-Meteo yanıtı gerekir');
  };
  subscribe(['weather', 'sim'], paintWeather);
  setInterval(paintWeather, 60000); // eskiyen veri bilinmiyor durumuna düşsün
  paintWeather();

  subscribe('live', paintGps);
  subscribe(['ocr', 'system'], paintOcr);
  subscribe('route', paintTraffic);
  setInterval(paintOcr, 5000); // okuma yaşı zamanla değişir
  paintGps();
  paintOcr();
  paintTraffic();
}
