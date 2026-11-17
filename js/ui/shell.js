// Harita üstü kabuk: yüzen düğme çubuğu (uydu, tüm rota, konumum, navigasyon), arama düğmesi, "haritadan seç" çubuğu,
// üst çubuk yüksekliği (sayfaların üst sınırı) ve İstasyonlar rozeti.
import { getState, subscribe, effective } from '../state.js';
import { mapApi } from './mapView.js';
import { showTab } from './tabs.js';
import { startNav, stopNav, recenterNav } from '../nav/navigator.js';
import { toast } from './toast.js';
import { save } from '../utils/storage.js';
import { startGps, stopGps, locateOnce } from '../sensors/gps.js';
import { RAIL_PITCH, railLimitTop, railFit } from './railFit.js';
import { navLayoutReport } from './navLayoutProbe.js';

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
    if (getState('nav').active) { recenterNav(); return true; } // navigasyonda: serbest gezinmeden navigasyon takip kamerasına (zoom/yön/eğim) dön
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
  // Açılışta ilk gerçek konumda harita bir kez konuma odaklanır (rota/navigasyon/test varken görünüm bozulmaz)
  let startCenter = true;
  setTimeout(() => { startCenter = false; }, 90000);
  subscribe('live', () => {
    if (wantCenter && centerMe()) wantCenter = false;
    if (!startCenter) return;
    if (getState('nav').active || getState('sim').enabled || mapApi.hasRoute()) { startCenter = false; return; }
    if (getState('live').gps === 'ok' && centerMe()) startCenter = false;
  });

  // Git (arama satırı): navigasyon sürmüyorsa görünür. Plan hazırsa başlatır; varış seçiliyse Rota sayfasındaki Git gibi planlar + başlatır; varış yoksa sorar.
  const navBtn = $('fab-nav');
  const planReady = () => !!(getState('plan').profile && getState('plan').steps?.length);
  const paintNav = () => navBtn.classList.toggle('hidden', !!getState('nav').active);
  navBtn.addEventListener('click', () => {
    if (planReady()) return startNav();
    if (getState('route').end) return $('btn-go').click();
    toast('Önce varış seç');
    openSearch();
  });
  subscribe(['plan', 'nav'], paintNav);
  paintNav();

  // Arama: Rota sayfasını açıp varış kutusuna odaklan
  const openSearch = () => {
    showTab('route');
    $('route-end').focus();
  };
  $('fab-search').addEventListener('click', openSearch);
  $('nh-search').addEventListener('click', openSearch);

  // Sağ kenar sütunu: harita kontrolleri her zaman görünür, konum düğmelerinin üstünden yukarı dizilir.
  // Üst panele/haritadan seç çubuğuna taşmasın diye yükseklik ölçülür; yer yetmezse CSS sonraki sütunu sola açar.
  // İki sütuna da sığmıyorsa (küçük ekranda navigasyon) sütun konum düğmelerinin soluna geçer ve onların yüksekliğini de kullanır.
  const RAIL_REACH = 8 + 3 * RAIL_PITCH; // konum düğmelerinin solunda en çok 3 sütun
  const more = $('fabs-more');
  const fabsBox = $('fabs');
  const pickBox = $('pickbar');
  const banners = $('banners');
  const fitMore = () => {
    const anchor = [...fabsBox.children].find((el) => el !== more && el.offsetParent);
    if (!anchor) return; // sayfa açıkken harita arayüzü gizli
    fabsBox.style.setProperty('--ev-lift', '0px'); // pil şeridi artık üst panelde: düğme sütunu alt şeride göre kaldırılmaz
    const box = fabsBox.getBoundingClientRect();
    // Yatay ekranda uyarı panelleri solda durur: yalnızca sütunun ulaşabileceği bölgedekiler sınırdır
    const limits = [...hud.children, ...banners.children, pickBox].filter((el) => el.id !== 'banners' && el.offsetParent && el.getBoundingClientRect().right > box.left - RAIL_REACH);
    // #banners kendi içinde kayar (max-height + overflow-y:auto): çocukların altı kabın görünür altına kırpılır
    const bannersBox = banners.getBoundingClientRect();
    const top = railLimitTop(limits.map((el) => ({ bottom: el.getBoundingClientRect().bottom, clipBottom: el.parentElement === banners ? bannersBox.bottom : null })));
    const count = [...more.children].filter((el) => el.offsetParent).length;
    const { side, maxHeight } = railFit({ anchorTop: anchor.getBoundingClientRect().top, boxBottom: box.bottom, count, top });
    fabsBox.classList.toggle('side', side);
    more.style.maxHeight = maxHeight + 'px';
  };
  const railObserver = new ResizeObserver(fitMore);
  for (const el of [hud, pickBox, fabsBox, $('mapstack')]) railObserver.observe(el);
  window.addEventListener('resize', fitMore);
  fitMore();
  // RM-07 A3 tanılama (salt okunur): tarayıcı konsolunda window.__navLayout(). Yalnızca çağrılınca ölçer; DOM'a yazmaz, dinleyici/ağ yok.
  // NAVLAYOUT-READ-BEGIN
  window.__navLayout = () => {
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const dims = (el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight });
    const cells = [...document.querySelectorAll('#nb-metrics > .nb-cell')].filter((el) => el.offsetParent).map((el) => ({
      id: el.id, width: el.getBoundingClientRect().width, ...dims(el),
      parts: [...el.querySelectorAll('small, b, .ne-sub, .nh-avg')].filter((p) => p.offsetParent).map((p) => ({ sel: (p.id ? '#' + p.id : p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).split(' ')[0] : '')), ...dims(p) })),
    }));
    const close = $('near-alert-close'), list = $('near-alert-toggle');
    const closeSnap = close && close.offsetParent ? (() => {
      const cs = getComputedStyle(close), ca = getComputedStyle(close, '::after');
      const px = (v) => parseFloat(v) || 0;
      return { rect: rectOf(close), border: { left: px(cs.borderLeftWidth), top: px(cs.borderTopWidth), right: px(cs.borderRightWidth), bottom: px(cs.borderBottomWidth) },
        after: ca.content && ca.content !== 'none' && ca.position === 'absolute' ? { left: px(ca.left), top: px(ca.top), right: px(ca.right), bottom: px(ca.bottom) } : null };
    })() : null;
    return navLayoutReport({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      navActive: !!getState('nav').active,
      cells,
      banners: { clientHeight: banners.clientHeight, scrollHeight: banners.scrollHeight, scrollTop: banners.scrollTop },
      close: closeSnap,
      list: list && list.offsetParent ? { rect: rectOf(list) } : null,
      rail: { side: fabsBox.classList.contains('side'), maxHeight: parseFloat(more.style.maxHeight) || null },
    });
  };
  // NAVLAYOUT-READ-END
  // Navigasyonu durdur: sağdaki kırmızı düğme, onay ister (yanlışlıkla dokunuşta navigasyon kesilmesin). Varsayılan odak "Devam et"te.
  const stopDlg = $('stop-nav-dialog');
  $('fab-stopnav').addEventListener('click', () => stopDlg.showModal());
  $('stop-nav-no').addEventListener('click', () => stopDlg.close());
  $('stop-nav-yes').addEventListener('click', () => { stopDlg.close(); stopNav(); });
  stopDlg.addEventListener('click', (e) => { if (e.target === stopDlg) stopDlg.close(); });
  subscribe('nav', () => { if (!getState('nav').active && stopDlg.open) stopDlg.close(); }); // araya varış girerse pencere kalmasın

  // Haritadan seç: sayfa kapanır, üstte yönerge çubuğu çıkar (mapView çağırır)
  const bar = $('pickbar');
  const text = $('pick-text');
  mapApi.pickBar = (mode) => {
    bar.classList.toggle('hidden', !mode);
    if (mode) text.textContent = mode === 'start' ? 'Başlangıç için haritaya dokun' : mode === 'place' ? 'Favori için haritaya dokun' : mode === 'via' ? 'Ara durak için haritaya dokun' : 'Varış için haritaya dokun';
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
