// "Yakınımdaki istasyonlar": konum etrafındaki herkese açık istasyonlar, fiyat/kW, tahmini varış pili ve maliyet.
// Düzenli güncelleme + düşük pil uyarısı: pil eşiğin altına inince (veya yetmeyecek görünürse) en yakın uygun
// istasyon önerilir ve sesli söylenir.
import { t } from '../i18n/index.js';
import { getState, patch, effective, subscribe } from '../state.js';
import { brandOk } from '../routing/planner.js';
import { load, save } from '../utils/storage.js';
import { VEHICLE, PLANNER } from '../config.js';
import { haversineKm } from '../utils/geo.js';
import { fetchAround } from '../providers/index.js';
import { chargeMinutes } from '../routing/chargeCurve.js';
import { planTrip } from '../routing/controller.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { speak } from '../advisor/voice.js';
import { slotKind, slotEl, isFresh, livePrice } from '../routing/slots.js';
import { fetchAvailability } from '../routing/occupancyClient.js';
import { proxyHas } from '../net/proxy.js';
import { startNav, syncTopPanel } from './navigator.js';
import { icon } from '../ui/icons.js';
import { measuredSoc } from '../physics/socEstimate.js';
import { paintMore } from '../ui/moreToggle.js';

const $ = (id) => document.getElementById(id);
const BAT = VEHICLE.batteryNetKwh;
const ROAD_FACTOR = 1.35; // kuş uçuşu → yol tahmini
const MIN_ARRIVE_SOC = 3; // bundan azıyla varılacaksa "ulaşılamayabilir"
const REFRESH_MS = 15 * 60e3; // sürüş sırasında otomatik güncelleme aralığı
const REFRESH_KM = 10; // ya da bu kadar yol alınınca
const LOW_REFRESH_MS = 5 * 60e3;
const CHARGE_TO = 80;
const OCC_EVERY_MS = 60e3; // kritik pilde (Premium) aday istasyonların canlı doluluğu bu aralıkla yenilenir (sunucu önbelleği 90 sn)
const OCC_BATCH = 6; // sunucu bir istekte en çok 6 istasyon alır

let all = []; // son sorgu sonucu (fetchAround)
let meta = { at: 0, lat: null, lon: null, errors: [], cached: false };
let busy = false;
let occBusy = false;
let occAt = 0;
let occDone = 0; // son doluluk sorgusunun bittiği an
let troubleSince = 0; // pil sorunu başladığından beri (sesli öneri, doluluk gelene kadar kısa süre beklesin)
let elimCount = 0; // son sıralamada doluluğu dolu/arızalı çıktığı için elenen istasyon sayısı
let focusId = null;
// Yarıçap: 'auto' (varsayılan) 1 km'den başlar, sonuç yoksa 10, 25, 50 km'ye genişler; sayı seçilirse yalnızca o yarıçap aranır.
const RADIUS_STEPS = [1, 10, 25, 50];
const NEAR_LIMIT = 3; // liste kapalıyken en çok 3 satır, "+" ile tümü
let radiusSetting = load('nearRadiusMode', 'auto');
let radius = radiusSetting === 'auto' ? RADIUS_STEPS[0] : Number(radiusSetting); // son aranan (sonuç veren) yarıçap
let nearOpen = false;
let showAc = load('nearAc', false);
const bands = new Set(); // bu düşüş için konuşulmuş pil bantları

const fmtKm = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', ',');

/** Anlık konuma göre uzaklık, yol tahmini, varış pili, maliyet/süre ekler. */
function enrich(list) {
  const e = effective();
  if (e.lat == null) return [];
  const eng = getState('engine');
  const kwh100 = eng.kwh100Flat ?? eng.kwh100Est ?? 20; // düz zemin: yerel iniş eğimi varış pilini şişirmesin
  return list.map((s) => {
    const distKm = haversineKm(e, s);
    const roadKm = distKm * ROAD_FACTOR;
    const arrive = e.soc == null ? null : e.soc - ((roadKm * kwh100) / 100 / BAT) * 100;
    const from = Math.max(arrive ?? 20, 0);
    const kwh = (Math.max(0, CHARGE_TO - from) / 100) * BAT;
    return {
      ...s, distKm, roadKm, arrive,
      reachable: arrive == null || arrive >= MIN_ARRIVE_SOC,
      cost: (kwh / PLANNER.billedEff) * s.price,
      minutes: chargeMinutes(s.kw, from, CHARGE_TO),
    };
  }).sort((a, b) => a.distKm - b.distKm);
}

const visible = () => {
  const list = enrich(all).filter((s) => showAc || !s.slow);
  const pref = list.filter(brandOk); // Şarj markası tercihi (İstasyonlar sekmesi); tercih edilen markada hiç istasyon yoksa hepsi gösterilir
  return pref.length ? pref : list;
};

export async function refreshNearby({ force = false, silent = false } = {}) {
  const e = effective();
  if (e.lat == null) { if (!silent) toast('Konum yok: üstteki 📍 ile GPS\'i aç (veya Test Modu)', 3500); return; }
  if (busy) return;
  busy = true;
  paintStatus('Yakındaki istasyonlar aranıyor…');
  try {
    const old = new Map(all.map((x) => [x.id, x.slots]));
    let res;
    for (const r of radiusSetting === 'auto' ? RADIUS_STEPS : [radius]) { // otomatik: görünür istasyon çıkana kadar 1 → 10 → 25 → 50 km
      radius = r;
      res = await fetchAround(e.lat, e.lon, r, force);
      all = res.stations;
      for (const x of all) if (!x.slots && old.get(x.id)) x.slots = old.get(x.id); // yenilemede doluluk bilgisi kaybolmasın
      if (visible().length || res.errors.length) break; // hata varsa genişletmenin anlamı yok (aynı sunucu)
    }
    meta = { at: Date.now(), lat: e.lat, lon: e.lon, errors: res.errors, cached: res.cached };
  } catch (err) {
    meta = { ...meta, errors: ['Arama başarısız: ' + err.message] };
  } finally {
    busy = false;
  }
  render();
  checkLow();
  if (proxyHas('occupancy')) refreshOccupancy({ force: true }); // Premium: liste her yenilendiğinde en yakın istasyonların canlı doluluğu ve fiyatı da gelir
}

/**
 * Premium: en yakın aday istasyonların (önce ulaşılabilirler) canlı doluluk ve fiyatını sorar. İlk 6 içinde en az 3 boş/bilinmeyen kalmadıysa
 * sonraki 6 da sorulur. Sonuç `all` üzerindeki istasyonlara yazılır; kritik pilde sıralama dolu olanları eler (rankNearby).
 */
async function refreshOccupancy({ force = false, every = OCC_EVERY_MS } = {}) {
  const e = effective();
  if (occBusy || e.lat == null || !all.length || !proxyHas('occupancy')) return;
  if (!force && Date.now() - occAt < every) return;
  occBusy = true;
  occAt = Date.now();
  try {
    const pool = enrich(all).filter((s) => !s.slow);
    const order = [...pool.filter((s) => s.reachable), ...pool.filter((s) => !s.reachable)];
    for (let i = 0; i < 2 * OCC_BATCH && i < order.length; i += OCC_BATCH) {
      const batch = order.slice(i, i + OCC_BATCH);
      const res = await fetchAvailability(batch, OCC_BATCH, measuredSoc(e));
      for (const [id, sl] of res) { const src = all.find((x) => x.id === id); if (src) src.slots = sl; }
      const open = batch.filter((b) => { const k = slotKind(all.find((x) => x.id === b.id) || b); return k !== 'full' && k !== 'out'; }).length;
      if (open >= 3) break;
    }
  } finally {
    occBusy = false;
    occDone = Date.now();
  }
  render();
  checkLow();
}

function paintStatus(text) {
  const el = $('near-status');
  if (el) el.textContent = text;
}

/**
 * İstasyona git. Varış noktası varsa (planlı rota): rota bulunduğun yerden istasyon ÜZERİNDEN asıl varışa yeniden kurulur ve
 * plan ilk durak olarak orada şarj eder (varış değişmez). Varış yoksa istasyonun kendisi varış olur.
 */
function goTo(s, { auto = false } = {}) {
  const e = effective();
  if (e.lat == null) return toast('Konum yok');
  const start = { lat: e.lat, lon: e.lon, label: 'Konumum' };
  const dest = getState('route').end;
  const keep = dest && getState('plan').profile && haversineKm(dest, s) > 1;
  if (!(keep && getState('sim').enabled)) mapApi.setPoint('start', start, { fit: false }); // sürüş simülasyonunda istasyon üzerinden yeniden rota A'yı taşımaz
  document.querySelector('.bottomnav [data-tab="map"]')?.click();
  if (!keep) mapApi.setPoint('end', { lat: s.lat, lon: s.lon, label: s.name });
  const done = () => { if (getState('plan').steps?.length) startNav(); };
  if (keep) {
    planTrip(start, { via: s, extra: all }).then(() => {
      done();
      const p = getState('plan');
      const first = p.stops[0];
      const msg = first?.station.id === s.id
        ? `Rota güncellendi: ${s.name} üzerinden, orada %${Math.round(first.arriveSoc)} → %${Math.round(first.leaveSoc)} şarj`
        : `Rota ${s.name} üzerinden güncellendi`;
      toast(msg, 5000);
      if (auto) speak(`Rota güncellendi. ${s.name} istasyonunda şarj durağı eklendi.`, { key: 'viaupdate', cooldownMs: 0, interrupt: true });
    });
  } else {
    planTrip().then(done);
  }
}

/** Harita istasyon kartından: istasyona git (liste dışı istasyonlar için de). */
export const goToStation = (s) => goTo(s);

const mapsUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`;

function cell(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

function render() {
  const list = $('near-list');
  if (!list) return;
  const items = visible();
  const shown = items.slice(0, 30);
  mapApi.drawNearby(shown, focusId);

  const age = meta.at ? Math.round((Date.now() - meta.at) / 60000) : null;
  paintStatus(meta.at
    ? `${items.length} istasyon · ${radius} km çevre · ${age < 1 ? 'şimdi' : age + ' dk önce'} güncellendi${meta.cached ? ' (önbellek)' : ''}`
    : 'Henüz aranmadı. Konumunu açıp "Ara"ya dokun.');
  $('near-summary-text').textContent = meta.at && items.length ? t('Yakında {0} şarj istasyonu', items.length) : 'Şarj istasyonları';
  const warn = $('near-warn');
  warn.textContent = meta.errors.join(' · ');
  warn.classList.toggle('hidden', !meta.errors.length);

  list.replaceChildren();
  if (meta.at && !items.length) list.append(cell('p', 'small muted', showAc ? 'Bu çevrede istasyon bulunamadı.' : 'Bu çevrede hızlı (DC) istasyon bulunamadı; yavaş AC olanlar için "AC de göster"i aç.'));

  paintMore($('near-more'), shown.length, NEAR_LIMIT, nearOpen);
  (nearOpen ? shown : shown.slice(0, NEAR_LIMIT)).forEach((s) => {
    const row = document.createElement('div');
    row.className = 'station' + (s.id === focusId ? ' focus' : '');
    const left = document.createElement('div');
    left.append(cell('div', 'name', s.name));
    const meta1 = document.createElement('div');
    meta1.className = 'meta';
    meta1.append(
      cell('span', 'tag ' + (s.reachable ? 'best' : ''), s.reachable ? `${fmtKm(s.distKm)} km` : 'Yetmeyebilir'),
      cell('span', '', `${s.opName} · ${s.slow ? 'AC/yavaş ' : ''}${s.kw} kW${s.uncertain ? '*' : ''}` + (s.foreign ? '' : ` · ${s.price.toFixed(2)} TL/kWh`)),
    );
    const meta2 = cell('div', 'meta', t('~{0} km yol', fmtKm(s.roadKm))
      + (s.arrive != null ? ' ' + t('· varışta %{0}', Math.max(0, s.arrive).toFixed(0)) : '')
      + ' ' + (s.foreign ? t("· %{0}'e ≈ {1} dk", CHARGE_TO, Math.round(s.minutes)) : t("· %{0}'e ≈ {1} dk, {2} TL", CHARGE_TO, Math.round(s.minutes), s.cost.toFixed(0)))); // parçalar ayrı çevrilir (tek dizge olarak desen eşleşmez) // doluluk verisi yalnızca gelen istasyonda gösterilir (altta slotEl)
    const slotNode = slotEl(s);
    if (slotNode) meta2.append(slotNode);
    const lp = livePrice(s);
    if (lp) meta2.append(' · ', cell('span', '', lp.text));
    const acts = document.createElement('div');
    acts.className = 'row wrap';
    const go = cell('button', 'btn primary sm', '🧭 Git');
    go.type = 'button';
    go.addEventListener('click', () => goTo(s));
    const gm = cell('a', 'btn ghost sm', '↗ Haritalar');
    gm.href = mapsUrl(s);
    gm.target = '_blank';
    gm.rel = 'noopener';
    const show = cell('button', 'btn ghost sm', '📍 Haritada');
    show.type = 'button';
    show.addEventListener('click', () => { focusId = s.id; mapApi.follow(s.lat, s.lon, 14, true); document.querySelector('.bottomnav [data-tab="map"]')?.click(); render(); });
    acts.append(go, gm, show);
    left.append(meta1, meta2, acts);
    row.append(left);
    list.append(row);
  });
}

// ---------- Düşük pil: en yakın uygun istasyonu öner ----------

/** Önerilecek istasyonlar: ulaşılabilir olanlar önce, yol üstündekiler hafif öncelikli, kalanı yola göre sıralı. */
function rankNearby() {
  const items = visible().filter((s) => !s.slow);
  const pool = items.length ? items : enrich(all);
  const eng = getState('engine');
  const plan = getState('plan');
  const score = (s) => {
    if (plan.profile && eng.routeKm != null) {
      const p = plan.profile.project(s.lat, s.lon, eng.routeKm);
      if (p.offKm < 3 && p.km > eng.routeKm) return s.roadKm - 2; // yol üstünde: hafif tercih (düşük pilde en yakın olan yine öncelikli)
    }
    return s.roadKm;
  };
  const premium = proxyHas('occupancy');
  // tamamen arızalı istasyon önerilmez; Premium'da taze doluluk bilgisi "dolu" diyen istasyon da elenir (hepsi doluysa elenenler geri gelir)
  const gone = (s) => { const k = slotKind(s); return k === 'out' || (premium && k === 'full' && isFresh(s)); };
  const live = pool.filter((s) => !gone(s));
  const usablePool = live.length ? live : pool;
  elimCount = live.length ? pool.length - live.length : 0;
  const ok = usablePool.filter((s) => s.reachable);
  const pen = (s) => (slotKind(s) === 'full' ? 10 : 0); // dolu görünen istasyon ~10 km daha uzak sayılır
  return [...(ok.length ? ok : usablePool)].sort((a, b) => score(a) + pen(a) - (score(b) + pen(b)));
}

let alertData = null; // { title, stations, notes } üst panelde gösterilen şarj önerisi
let alertSig = ''; // aynı içerik her 5 sn'de yeniden çizilmesin (açık satır ve odak korunur)
let listOpen = null; // kullanıcı seçimi; null: navigasyonda yalnızca en iyi öneri, navigasyon yokken tüm öneriler
let openRow = null; // ayrıntısı açık istasyon

/** Tek öneri: ad, mesafe, güç ve Git hep görünür; ada dokununca fiyat, varış pili ve doluluk açılır. */
function alertEntry(s) {
  const open = openRow === s.id;
  const entry = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'near-row';
  const info = cell('button', 'near-info', s.name);
  info.type = 'button';
  info.setAttribute('aria-expanded', String(open));
  info.append(cell('small', '', `${fmtKm(s.distKm)} km · ${s.kw} kW` + (s.reachable ? '' : ' ' + t('· yetmeyebilir'))));
  info.addEventListener('click', () => { openRow = open ? null : s.id; paintAlert(); });
  const go = cell('button', 'btn primary sm', 'Git');
  go.type = 'button';
  go.addEventListener('click', () => goTo(s));
  row.append(info, go);
  entry.append(row);
  if (open) {
    const detail = cell('div', 'near-detail near-metrics small', '');
    const metric = (ic, node) => {
      const c = cell('div', 'nm-cell', '');
      c.innerHTML = icon(ic);
      c.append(node);
      detail.append(c);
    };
    const slotNode = slotEl(s, '');
    if (slotNode) metric('plug', slotNode);
    const lp = livePrice(s);
    if (!s.foreign || lp) {
      const price = cell('span', '', s.foreign ? '' : `${s.price.toFixed(2)} TL/kWh`);
      if (lp) price.append(s.foreign ? '' : ' · ', cell('span', '', lp.text));
      metric('tag', price);
    }
    if (s.arrive != null) metric('battery', cell('span', '', t('Varış pili ~%{0}', Math.max(0, s.arrive).toFixed(0))));
    entry.append(detail);
  }
  return entry;
}

function paintAlert() {
  const { title, stations, notes } = alertData;
  const open = listOpen ?? !getState('nav').active;
  const sig = JSON.stringify([title, notes, open, openRow, stations.map((s) => [s.id, fmtKm(s.distKm), s.kw, s.price, s.arrive == null ? null : Math.round(s.arrive), s.reachable, slotEl(s)?.textContent, livePrice(s)?.text])]);
  if (sig === alertSig) return;
  alertSig = sig;
  $('near-alert-title').textContent = title;
  const toggle = $('near-alert-toggle');
  toggle.classList.toggle('hidden', !stations.length && !notes.length);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.innerHTML = icon(open ? 'chev-up' : 'chev-down');
  const body = $('near-alert-body');
  body.replaceChildren(...(open ? notes.map((n) => cell('div', 'small muted', n)) : []), ...(open ? stations : stations.slice(0, 1)).map(alertEntry));
  if (open && stations.length) {
    const all3 = cell('button', 'near-more', 'Diğer istasyonlar');
    all3.type = 'button';
    all3.insertAdjacentHTML('beforeend', icon('chev-right'));
    all3.addEventListener('click', () => document.querySelector('.bottomnav [data-tab="stations"]')?.click());
    body.append(all3);
  }
}

/** Üst paneldeki şarj bölümü: başlık + (varsa) en yakın 3 istasyon, her biri için Git düğmesi. */
function showAlert(title, stations = [], notes = []) {
  const bar = $('near-alert');
  if (!title) {
    bar.classList.add('hidden');
    alertData = null; alertSig = ''; listOpen = null; openRow = null;
    syncTopPanel();
    patch('nav', { alert: null });
    return;
  }
  alertData = { title, stations, notes };
  paintAlert();
  bar.classList.remove('hidden');
  syncTopPanel();
  patch('nav', { alert: { text: title, id: stations[0]?.id ?? null } });
}

let dismissedUntil = 0;
let lastAutoVia = 0;

/** Pil eşiğin altında veya plan "ulaşılamıyor" diyorsa sorun var. */
function inTrouble(e, nav) {
  return e.soc != null && (e.soc <= nav.lowSoc || (getState('advisor').level === 'bad' && (e.speed ?? 0) > 5));
}

/** Veri yoksa/eskiyse kendiliğinden ara (45 sn'de bir; başarısız denemeler döngüye girmesin). */
function autoSearch(widen = false) {
  if (busy || Date.now() - meta.at < 45000) return;
  if (widen && radiusSetting !== 'auto' && radius < 50) { radiusSetting = 50; radius = 50; save('nearRadiusMode', radiusSetting); $('near-radius').value = '50'; }
  refreshNearby({ silent: true, force: true });
}

function checkLow() {
  const e = effective();
  const nav = getState('nav');
  if (e.soc == null) return;
  if (e.lat == null) { // konum bilinmiyorsa istasyonlar aranamaz: kullanıcıyı uyar
    if (e.soc <= nav.lowSoc && Date.now() >= dismissedUntil) showAlert(`Pil %${Math.round(e.soc)}: yakındaki istasyonları listelemek için konum gerekli. Üstteki 📍 düğmesiyle GPS'i aç.`);
    return;
  }
  if (!inTrouble(e, nav)) {
    troubleSince = 0;
    if (e.soc > nav.lowSoc + 3) { bands.clear(); if (getState('nav').alert) showAlert(null); }
    return;
  }
  if (!troubleSince) troubleSince = Date.now();
  if (Date.now() < dismissedUntil) return;
  refreshOccupancy(); // Premium: kritik pilde aday istasyonların doluluğunu dakikada bir yenile

  const soc = Math.round(e.soc);
  if (!all.length) {
    const why = meta.at ? (meta.errors[0] ? `arama başarısız: ${meta.errors[0]}` : `${radius} km çevrede istasyon bulunamadı`) : 'aranıyor…';
    showAlert(`Pil %${soc}: yakındaki istasyonlar ${why}`);
    autoSearch(meta.at > 0); // önceki arama boş döndüyse yarıçapı 50 km'ye çıkarıp kendiliğinden yeniden dene
    return;
  }
  const ranked = rankNearby();
  const best = ranked[0];
  if (!best) { showAlert(`Pil %${soc}: uygun istasyon bulunamadı`); autoSearch(true); return; }
  const planBroken = getState('advisor').level === 'bad';
  const updated = Date.now() - lastAutoVia < 10 * 60e3;
  const premium = proxyHas('occupancy');
  const notes = [];
  if (premium && occBusy && !occDone) notes.push('Doluluk kontrol ediliyor…');
  if (premium && elimCount > 0) notes.push(`${elimCount} dolu istasyon elendi`);
  if (premium && !elimCount && ranked.length && ranked.every((x) => slotKind(x) === 'full')) notes.push('Hepsi dolu görünüyor; en yakınlar listelendi');
  showAlert(`Pil %${soc} — en yakın şarj istasyonları:` + (updated ? ' (rota otomatik güncellendi)' : ''), ranked.slice(0, 3), notes);
  // Plan sıradaki durağa/varışa ulaşılamıyor diyorsa: navigasyonda rotayı en uygun istasyon üzerinden kendiliğinden güncelle
  if (planBroken && nav.active && getState('route').end && !updated && best.reachable && (best.arrive ?? 99) >= 5
      && getState('plan').stops[0]?.station.id !== best.id && getState('plan').status !== 'loading') {
    lastAutoVia = Date.now();
    goTo(best, { auto: true });
  }

  // Her pil bandında (eşik, 15, 10, 5) bir kez konuş
  const band = [nav.lowSoc, 15, 10, 5].filter((b) => e.soc <= b).sort((a, b) => a - b)[0] ?? nav.lowSoc;
  const waitOcc = premium && !occDone && Date.now() - troubleSince < 15000; // doluluk cevabı gelsin (en çok 15 sn)
  if (!bands.has(band) && !waitOcc) {
    bands.add(band);
    speak(`Pil yüzde ${soc}. En yakın şarj istasyonu ${fmtKm(best.distKm)} kilometre.`, { key: 'low' + band, cooldownMs: 0, interrupt: true }); // liste, fiyat ve doluluk yalnızca üst panelde
  }
}

/** Her 30 sn: sürüyorsak/navigasyon açıksa listeyi eskidiğinde yenile, düşük pili denetle. */
function watch() {
  const e = effective();
  if (e.lat == null) return;
  const nav = getState('nav');
  const moving = nav.active || (e.speed ?? 0) > 5;
  const age = Date.now() - meta.at;
  const moved = meta.lat == null ? Infinity : haversineKm({ lat: meta.lat, lon: meta.lon }, e);
  const lowNow = inTrouble(e, nav);
  const wanted = moving && (all.length || nav.active) || lowNow;
  if (wanted && !busy && (age > (lowNow ? LOW_REFRESH_MS : REFRESH_MS) || moved > REFRESH_KM)) refreshNearby({ silent: true });
  else { if (meta.at) render(); checkLow(); }
  if (all.length && (lowNow || moving)) refreshOccupancy({ every: lowNow ? OCC_EVERY_MS : 2 * 60e3 }); // Premium: sürerken 2 dk, kritik pilde 1 dk
}

export function initNearby() {
  const rad = $('near-radius');
  rad.value = String(radiusSetting);
  rad.addEventListener('change', () => {
    radiusSetting = rad.value === 'auto' ? 'auto' : Number(rad.value);
    radius = radiusSetting === 'auto' ? RADIUS_STEPS[0] : radiusSetting;
    save('nearRadiusMode', radiusSetting);
    refreshNearby({ force: true });
  });
  $('near-more').addEventListener('click', () => { nearOpen = !nearOpen; render(); });
  // İstasyonlar sekmesi açılınca liste yoksa/eskiyse (5 dk) ya da 1 km'den fazla yer değiştirdiysen kendiliğinden ara
  document.addEventListener('tabchange', (ev) => {
    if (ev.detail !== 'stations' || busy) return;
    const e = effective();
    if (e.lat == null) return;
    const moved = meta.lat == null ? Infinity : haversineKm({ lat: meta.lat, lon: meta.lon }, e);
    if (!meta.at || Date.now() - meta.at > 5 * 60e3 || moved > 1) refreshNearby({ silent: true });
  });
  const ac = $('near-ac');
  ac.checked = showAc;
  ac.addEventListener('change', () => { showAc = ac.checked; save('nearAc', showAc); render(); });
  $('near-refresh').addEventListener('click', () => refreshNearby({ force: true }));
  let brandSig = (PLANNER.brands || []).join(',');
  subscribe('route', () => { const b = (PLANNER.brands || []).join(','); if (b !== brandSig) { brandSig = b; render(); } }); // marka tercihi değişince liste yenilenir
  $('near-alert-close').addEventListener('click', () => { dismissedUntil = Date.now() + 10 * 60e3; showAlert(null); });
  $('near-alert-toggle').addEventListener('click', () => {
    if (!alertData) return;
    listOpen = !(listOpen ?? !getState('nav').active);
    paintAlert();
  });
  render();
  setInterval(watch, 30000);
  setInterval(() => { if (!busy) checkLow(); }, 5000); // sorun varsa 30 sn beklemeden öner/ara
}
