// Harita üstü kabuk: yüzen düğme çubuğu (uydu, tüm rota, konumum, navigasyon), arama düğmesi, "haritadan seç" çubuğu,
// üst çubuk yüksekliği (sayfaların üst sınırı) ve İstasyonlar rozeti.
import { getState, subscribe, effective } from '../state.js';
import { mapApi } from './mapView.js';
import { showTab } from './tabs.js';
import { startNav, stopNav } from '../nav/navigator.js';
import { toast } from './toast.js';

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
  $('fab-me').addEventListener('click', () => {
    const e = effective();
    if (e.lat == null) return toast('Konum yok: üstteki 📍 ile GPS\'i aç (veya Test Modu)', 4000);
    mapApi.follow(e.lat, e.lon, 15, true);
    mapApi.recenter?.();
  });

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
