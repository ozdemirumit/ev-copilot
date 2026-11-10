// Haritada bir istasyon iğnesine dokununca açılan kart: ad, operatör, güç, tahmini ve canlı/bildirilen fiyat, canlı doluluk (Premium), topluluk durumu,
// Git / Haritalar düğmeleri, fiyat bildirimi ve topluluk bilgisi: 1-5 puan, çevredeki olanaklar (AVM, tuvalet…) ve fotoğraflar (kameradan ya da galeriden).
// Canlı bilgi tek istasyon için sunucudan istenir (/v1/occupancy; Hollanda'da NDW, Türkiye'de topluluk).
import { measuredSoc } from '../physics/socEstimate.js';
import { effective, getState } from '../state.js';
import { progressKm } from '../routing/progress.js';
import { openSwap, removeFromRoute } from './stopSwap.js';
import { addStop } from '../routing/controller.js';
import { mapApi } from './mapView.js';
import { toast } from './toast.js';
import { tr, t } from '../i18n/index.js';
import { fetchAvailability } from '../routing/occupancyClient.js';
import { slotEl, livePrice } from '../routing/slots.js';
import { getSession, proxyFetch, proxyHas } from '../net/proxy.js';
import { fetchInfo, ratePoint, markFacility, shrinkPhoto, uploadPhoto, photoUrl, deletePhoto, reportPhoto, FACILITIES } from '../account/stationInfo.js';
import { goToStation } from '../nav/nearby.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text ?? '' });
let current = null;
let token = 0; // eski yanıt yeni karta yazılmasın
let urls = []; // fotoğraf küçük resimlerinin blob adresleri (kart kapanınca serbest bırakılır)

function freeUrls() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
}

function close() {
  current = null;
  token++;
  freeUrls();
  $('station-card')?.classList.add('hidden');
}

function btn(text, fn, cls = 'btn ghost sm') {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function paintLive(box, s, state) {
  box.replaceChildren();
  box.classList.remove('hidden');
  const note = (t) => box.append(el('div', 'small muted', t));
  if (state === 'loading') return note('Canlı bilgi alınıyor…');
  if (state === 'login') return note('Canlı doluluk için hesapla giriş yap');
  if (state === 'none') return box.classList.add('hidden');
  if (state === 'locked') return note('Canlı doluluk ve kWh fiyatı Premium üyelere özeldir.');
  if (s.slots?.src === 'google') return note('Google doluluk verisi harita ekranında gösterilemez; İstasyonlar listesinde görünür'); // Places kuralı: Google verisi Google Maps dışındaki haritada gösterilmez
  const node = slotEl(s, '');
  const lp = livePrice(s);
  if (node) { const d = el('div', 'live-slots'); d.append(node); box.append(d); }
  if (lp) box.append(el('div', 'live-price', lp.text));
  if (lp?.extra) box.append(el('div', 'small muted', 'Ek ücret var (oturum başı ya da süre)'));
  if (!node && !lp) box.classList.add('hidden'); // veri gelmeyen istasyonda canlı doluluk bölümü hiç gösterilmez
}

async function load(s, box) {
  const my = ++token;
  if (!getSession()) return paintLive(box, s, 'login');
  if (proxyHas('occupancyLocked')) return paintLive(box, s, 'locked');
  if (!proxyHas('occupancy')) return paintLive(box, s, 'none');
  paintLive(box, s, 'loading');
  const res = await fetchAvailability([s], 1, measuredSoc(effective()));
  if (my !== token) return;
  if (res.has(s.id)) s.slots = res.get(s.id);
  paintLive(box, s, 'done');
}

/** Fotoğrafı tam ekran göster; kendi fotoğrafıysa silinebilir (bildirilmişse not görünür), başkasınınsa bildirilebilir (bildirilen herkesten gizlenir). */
function viewPhoto(src, id, mine, hidden, onGone) {
  const ov = el('div', 'photo-view');
  const img = el('img');
  img.src = src;
  img.alt = '';
  ov.append(img, btn('✕', () => ov.remove(), 'sheet-x'));
  if (mine) {
    if (hidden) ov.append(el('div', 'photo-note', 'Bildirildi, inceleme bekliyor'));
    ov.append(btn('🗑 Sil', async () => { if (await deletePhoto(id)) { ov.remove(); toast('Fotoğraf silindi'); onGone(); } else toast('Kaydedilemedi'); }, 'btn sm del'));
  } else {
    ov.append(btn('🚩 Bildir', async () => {
      if (!confirm('Bu fotoğraf bildirilsin mi? Bildirilen fotoğraf herkesten gizlenir ve incelenir.')) return;
      if (await reportPhoto(id)) { ov.remove(); toast('Fotoğraf bildirildi ve gizlendi. İnceleyeceğiz.'); onGone(); } else toast('Bildirilemedi');
    }, 'btn sm del'));
  }
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  document.body.append(ov);
}

/** Puan, olanaklar ve fotoğraflar bölümü (hesapla giriş gerekir). */
async function loadInfo(s, box) {
  const my = token;
  if (!getSession()) { box.replaceChildren(el('div', 'small muted', 'Puan, fotoğraf ve olanaklar için hesapla giriş yap')); return; }
  const info = await fetchInfo(s);
  if (my !== token || !info) return;
  freeUrls();
  const again = () => loadInfo(s, box);
  const r = info.rating;
  const rate = el('div', 'row sc-rate');
  rate.append(el('span', 'small muted', 'Puanın:'));
  for (let i = 1; i <= 5; i++) {
    const b = btn(i <= (r.mine || 0) ? '★' : '☆', async () => { if (await ratePoint(s, r.mine === i ? 0 : i)) again(); else toast('Kaydedilemedi'); }, 'star');
    b.setAttribute('aria-label', String(i));
    rate.append(b);
  }
  rate.append(el('span', 'small muted', r.n ? t('Ortalama {0} ({1} oy)', r.avg.toFixed(1), r.n) : 'Henüz puan yok'));

  const fac = el('div', 'stack');
  fac.append(el('div', 'small muted', 'Olanaklar (dokunarak işaretle)'));
  const chips = el('div', 'chips');
  FACILITIES.forEach((f) => {
    const v = info.facilities[f.id] || { yes: 0, no: 0, mine: null };
    const b = btn(`${f.icon} ${tr(f.name)}${v.yes ? ' · ' + v.yes : ''}`, async () => { if (await markFacility(s, f.id, v.mine === true ? null : true)) again(); else toast('Kaydedilemedi'); }, 'btn sm' + (v.yes > v.no ? ' sel' : ''));
    b.setAttribute('aria-pressed', String(v.mine === true));
    chips.append(b);
  });
  fac.append(chips);

  const ph = el('div', 'stack');
  ph.append(el('div', 'small muted', 'Fotoğraflar'));
  if (info.photos.length) {
    const row = el('div', 'photo-row');
    info.photos.forEach((p) => {
      const th = el('button', 'photo-th' + (p.mine ? ' mine' : '') + (p.hidden ? ' flagged' : ''));
      th.type = 'button';
      if (p.hidden) th.title = tr('Bildirildi, inceleme bekliyor');
      row.append(th);
      photoUrl(p.id).then((u) => {
        if (!u) return th.remove();
        if (my !== token) return URL.revokeObjectURL(u);
        urls.push(u);
        th.style.backgroundImage = `url("${u}")`;
        th.addEventListener('click', () => viewPhoto(u, p.id, p.mine, !!p.hidden, again));
      });
    });
    ph.append(row);
  }
  const add = (capture) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (capture) inp.capture = 'environment';
    inp.addEventListener('change', async () => {
      const file = inp.files?.[0];
      if (!file) return;
      toast('Fotoğraf yükleniyor…');
      try {
        const blob = await shrinkPhoto(file);
        const res = blob ? await uploadPhoto(s, blob) : { ok: false };
        toast(res.ok ? 'Fotoğraf eklendi' : 'Fotoğraf yüklenemedi');
        if (res.ok) again();
      } catch { toast('Fotoğraf yüklenemedi'); }
    });
    inp.click();
  };
  const acts = el('div', 'row wrap');
  acts.append(btn('📷 Fotoğraf çek', () => add(true)), btn('🖼️ Galeriden seç', () => add(false)));
  ph.append(acts, el('div', 'small muted', 'Fotoğrafta kişi ve plaka görünmesin.'));
  if (info.photos.some((p) => p.mine)) ph.append(el('div', 'small muted', 'Yeşil çerçeveli fotoğraflar senin: açıp silebilirsin.'));
  box.replaceChildren(rate, fac, ph);
}

function open(s) {
  current = s;
  freeUrls();
  const card = $('station-card');
  const head = el('div', 'row between');
  head.append(el('b', 'sc-title', s.name));
  head.append(btn('✕', close, 'sheet-x'));
  const meta = el('div', 'small muted');
  meta.append(el('span', '', s.opName || ''), ' · ', el('span', '', `${s.slow ? tr('AC/yavaş') + ' ' : ''}${s.kw} kW${s.uncertain ? '*' : ''}`));
  const price = el('div', 'sc-price', s.foreign ? 'Fiyat bilgisi yok (liste fiyatı yalnızca Türkiye için)' : s.price != null ? `${s.price.toFixed(2)} TL/kWh (tahmini)` : '');
  const live = el('div', 'stack sc-live');
  const acts = el('div', 'row wrap');
  acts.append(btn('🧭 Git', () => { close(); goToStation(s); }, 'btn primary sm'));
  const a = el('a', 'btn ghost sm', '↗ Haritalar');
  a.href = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`;
  a.target = '_blank';
  a.rel = 'noopener';
  acts.append(a);
  if (getSession()) {
    if (!s.foreign) acts.append(btn('💳 Fiyat bildir', async () => { // TL fiyat bildirimi yalnızca Türkiye'de
      const v = prompt(tr('Bu istasyonun kWh fiyatı (TL)?'));
      if (v == null) return;
      const p = Number(String(v).replace(',', '.'));
      if (!(p > 0.05 && p < 100)) return toast('Geçerli bir fiyat gir');
      try {
        const r = await proxyFetch('/v1/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: s.lat, lon: s.lon, kwh: p, currency: 'TRY' }), signal: AbortSignal.timeout(15000) });
        toast(r.ok ? 'Teşekkürler: fiyat kaydedildi' : 'Fiyat gönderilemedi');
      } catch { toast('Fiyat gönderilemedi'); }
    }));
  }
  // Bu istasyon rotadaki bir şarj durağıysa: 5 km çevresindeki uygun istasyonlardan biriyle değiştirilebilir (Fiyat bildir'in sağında)
  const stop = getState('plan').stops?.find((x) => x.station.id === s.id && x.km > progressKm() - 0.3);
  if (stop) acts.append(btn('🔁 Değiştir', () => { close(); openSwap(stop, progressKm()); }), btn('🗑️ Kaldır', () => { close(); removeFromRoute(stop); }));
  else if (getState('plan').status === 'ready' && getState('plan').stations?.some((x) => x.id === s.id && x.km > progressKm() + 0.5)) {
    // Rotadaki ama planda olmayan istasyon: burada şarj et → plana girer, gerekmeyen otomatik durak çıkar
    acts.append(btn('⚡ Şarj et', () => {
      const r = addStop(s.id);
      close();
      if (!r.ok) return toast(t('Bu istasyonla plan kurulamadı: {0}', tr(r.reason || 'Plan kurulamadı')), 8000);
      toast(r.dropped.length ? t('Şarj durağı eklendi: {0}. Gerekmeyen durak çıkarıldı: {1}', s.name, r.dropped.join(', ')) : t('Şarj durağı eklendi: {0}', s.name), 7000);
    }, 'btn primary sm'));
  }
  const info = el('div', 'stack sc-info');
  card.replaceChildren(head, meta, price, live, acts, info);
  card.classList.remove('hidden');
  load(s, live);
  loadInfo(s, info);
}

export function initStationCard() {
  mapApi.onStation = open; // harita iğneleri dokununca çağırır (ui/mapView.js)
  document.addEventListener('tabchange', (e) => { if (e.detail !== 'map') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
