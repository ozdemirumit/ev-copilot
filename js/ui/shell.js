// Harita üstü kabuk: yüzen düğme çubuğu (uydu, tüm rota, konumum, navigasyon), arama düğmesi, "haritadan seç" çubuğu,
// üst çubuk yüksekliği (sayfaların üst sınırı) ve İstasyonlar rozeti.
import { getState, subscribe, effective } from '../state.js';
import { mapApi } from './mapView.js';
import { showTab } from './tabs.js';
import { startNav, stopNav } from '../nav/navigator.js';
import { toast } from './toast.js';
import { save, load } from '../utils/storage.js';
import { startGps, stopGps, locateOnce } from '../sensors/gps.js';
import { icon } from './icons.js';

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

  // 3B/2B görünüm: yalnızca navigasyonda görünür; şu anki kipi yazar (3B / 2B), dokununca değiştirir (seçim cihazda saklanır).
  // 'nav' her güncellemede çağrılır: durum (görünür, 3B) değişmediyse DOM'a yazılmaz. Metin karşılaştırılmaz, çünkü i18n yazılan
  // "3B"yi diğer dillerde "3D"ye çevirir (ek sözlük).
  const d3 = $('fab-3d');
  let painted3d = null;
  const paint3d = () => {
    const on = mapApi.is3d();
    const active = !!getState('nav').active;
    const st = `${active}|${on}`;
    if (st === painted3d) return;
    painted3d = st;
    d3.classList.toggle('hidden', !active);
    d3.classList.toggle('on', on);
    d3.setAttribute('aria-pressed', String(on));
    d3.textContent = on ? '3B' : '2B';
  };
  d3.addEventListener('click', () => { mapApi.set3d(!mapApi.is3d()); paint3d(); });
  subscribe('nav', paint3d);
  paint3d();

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
        toast('Konum izni kapalı: Android Ayarlar > Uygulamalar > EV Route Finder > İzinler > Konum', 7000);
      } else {
        toast('Konum henüz alınamadı: GPS sinyali bekleniyor (açık alanda dene)', 6000); // GPS izleme sürüyor: ilk konum gelince harita yine ortalanır
      }
    }
  });
  // Açılışta GPS açıksa (varsayılan açık) ilk gerçek konumda harita bir kez konuma odaklanır (rota/navigasyon/test varken görünüm bozulmaz)
  let startCenter = load('gpsOn', true);
  if (startCenter) setTimeout(() => { startCenter = false; }, 90000);
  subscribe('live', () => {
    if (wantCenter && centerMe()) wantCenter = false;
    if (!startCenter) return;
    if (getState('nav').active || getState('sim').enabled || mapApi.hasRoute()) { startCenter = false; return; }
    if (getState('live').gps === 'ok' && centerMe()) startCenter = false;
  });

  // Navigasyon düğmesi: plan hazırsa görünür
  const navBtn = $('fab-nav');
  const paintNav = () => {
    const ready = !!(getState('plan').profile && getState('plan').steps?.length);
    const on = getState('nav').active;
    navBtn.classList.toggle('hidden', !ready && !on);
    navBtn.classList.toggle('on', on);
    navBtn.innerHTML = icon(on ? 'stop' : 'nav');
    navBtn.title = navBtn.ariaLabel = on ? 'Navigasyonu durdur' : 'Navigasyonu başlat';
  };
  navBtn.addEventListener('click', () => (getState('nav').active ? stopNav() : startNav()));
  subscribe(['plan', 'nav'], paintNav);
  paintNav();

  // Arama: Rota sayfasını açıp varış kutusuna odaklan
  const openSearch = () => {
    showTab('route');
    $('route-end').focus();
  };
  $('fab-search').addEventListener('click', openSearch);
  $('nh-search').addEventListener('click', openSearch);

  // Az kullanılan harita düğmeleri ⋯ altında; dışarı dokununca ya da Esc ile kapanır
  const more = $('fabs-more');
  const moreBtn = $('fab-tools');
  const setMore = (open) => { more.classList.toggle('hidden', !open); moreBtn.setAttribute('aria-expanded', String(open)); };
  moreBtn.addEventListener('click', () => setMore(more.classList.contains('hidden')));
  document.addEventListener('click', (e) => { if (!$('fabs').contains(e.target)) setMore(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMore(false); });

  // Durum ve kontroller penceresi (Wake Lock, durum rozetleri, sürüm): rozet/düğme kimlikleri ve dinleyicileri aynı
  const tools = $('tools-dialog');
  const closeTools = () => tools.close();
  $('btn-tools').addEventListener('click', () => tools.showModal());
  $('tools-x').addEventListener('click', closeTools);
  $('tools-close').addEventListener('click', closeTools);
  tools.addEventListener('click', (e) => { if (e.target === tools) closeTools(); });

  // Haritadan seç: sayfa kapanır, üstte yönerge çubuğu çıkar (mapView çağırır)
  const bar = $('pickbar');
  const text = $('pick-text');
  mapApi.pickBar = (mode) => {
    bar.classList.toggle('hidden', !mode);
    if (mode) text.textContent = mode === 'start' ? 'Başlangıç için haritaya dokun' : mode === 'place' ? 'Favori için haritaya dokun' : 'Varış için haritaya dokun';
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
