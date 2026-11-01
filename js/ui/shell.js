// Harita üstü kabuk: yüzen düğme çubuğu (uydu, tüm rota, konumum, navigasyon), arama düğmesi, "haritadan seç" çubuğu,
// üst çubuk yüksekliği (sayfaların üst sınırı) ve İstasyonlar rozeti.
import { getState, subscribe, effective } from '../state.js';
import { mapApi } from './mapView.js';
import { showTab } from './tabs.js';
import { startNav, stopNav } from '../nav/navigator.js';
import { toast } from './toast.js';
import { save } from '../utils/storage.js';
import { startGps, stopGps, locateOnce } from '../sensors/gps.js';

const $ = (id) => document.getElementById(id);

export function initShell() {
  // Sayfalar üst çubuğun/uyarıların altından başlar: yükseklik değişince CSS değişkenini güncelle
  const hud = $('hudtop');
  const fit = () => document.documentElement.style.setProperty('--hud-h', hud.offsetHeight + 8 + 'px');
  new ResizeObserver(fit).observe(hud);
  fit();

  // Uydu görüntüsü
  const sat = $('fab-sat');
  const paintSat = () => { const on = mapApi.isSatellite(); sat.classList.toggle('on', on); sat.setAttribute('aria-pressed', String(on)); };
  sat.addEventListener('click', () => { mapApi.setSatellite(!mapApi.isSatellite()); paintSat(); });
  paintSat();

  $('fab-route').addEventListener('click', () => (mapApi.hasRoute() ? mapApi.overview() : toast('Önce bir rota planla')));
  // Haritayı bana ortala: konum varsa hemen, yoksa GPS'i açıp ilk konumda ortalar
  let wantCenter = false;
  const centerMe = () => {
    const e = effective();
    if (e.lat == null) return false;
    const acc = getState('live').acc; // kaba konumda (şebeke) çok yakınlaşma
    mapApi.recenter?.(); // önce görünümü sıfırla (jumpTo çalışan animasyonu iptal eder), sonra konuma git: sıra ters olursa harita hiç kaymaz
    mapApi.follow(e.lat, e.lon, acc > 1500 ? 13 : acc > 300 ? 15 : 16, true);
    return true;
  };
  $('fab-me').addEventListener('click', async () => {
    if (centerMe()) return;
    wantCenter = true;
    setTimeout(() => { wantCenter = false; }, 90000); // en çok 90 sn bekle
    toast('Konum aranıyor… (ilk konum 30 sn sürebilir)', 5000);
    const g = getState('live').gps;
    if (g === 'off' || g === 'error' || g === 'denied') { // kapalı ya da hatalıysa (yeniden) başlat; izin sorusu bu dokunuşta çıkar
      if (g !== 'off') stopGps();
      try { startGps(); save('gpsOn', true); } catch (err) { toast(err.message); }
    }
    try {
      await locateOnce(); // hızlı ilk konum; gelince abonelik haritayı ortalar. Hata nedeni kullanıcıya söylenir
    } catch (err) {
      if (err?.code === 1) { // izin reddedildi: beklemenin anlamı yok
        wantCenter = false;
        toast('Konum izni kapalı: Android Ayarlar > Uygulamalar > EV Co-Pilot > İzinler > Konum', 7000);
      } else {
        toast('Konum henüz alınamadı: GPS sinyali bekleniyor (açık alanda dene)', 6000); // GPS izleme sürüyor: ilk konum gelince harita yine ortalanır
      }
    }
  });
  subscribe('live', () => { if (wantCenter && centerMe()) wantCenter = false; });

  // Navigasyon düğmesi: plan hazırsa görünür
  const navBtn = $('fab-nav');
  const paintNav = () => {
    const ready = !!(getState('plan').profile && getState('plan').steps?.length);
    const on = getState('nav').active;
    navBtn.classList.toggle('hidden', !ready && !on);
    navBtn.classList.toggle('on', on);
    navBtn.textContent = on ? '⏹' : '🧭';
    navBtn.title = navBtn.ariaLabel = on ? 'Navigasyonu durdur' : 'Navigasyonu başlat';
  };
  navBtn.addEventListener('click', () => (getState('nav').active ? stopNav() : startNav()));
  subscribe(['plan', 'nav'], paintNav);
  paintNav();

  // Arama: Rota sayfasını açıp varış kutusuna odaklan
  $('fab-search').addEventListener('click', () => {
    showTab('route');
    $('route-end').focus();
  });

  // Haritadan seç: sayfa kapanır, üstte yönerge çubuğu çıkar (mapView çağırır)
  const bar = $('pickbar');
  const text = $('pick-text');
  mapApi.pickBar = (mode) => {
    bar.classList.toggle('hidden', !mode);
    if (mode) text.textContent = mode === 'start' ? 'Başlangıç için haritaya dokun' : 'Varış için haritaya dokun';
  };
  $('pick-cancel').addEventListener('click', () => mapApi.cancelPick());

  // İstasyonlar rozeti: plandaki şarj durağı sayısı
  const badge = $('badge-stations');
  const paintBadge = () => {
    const n = getState('plan').stops?.length || 0;
    badge.textContent = n;
    badge.classList.toggle('hidden', !n);
  };
  subscribe('plan', paintBadge);
  paintBadge();
}
